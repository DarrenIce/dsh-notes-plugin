# Read-only Windows capture. Input and output are JSON over stdio; paths are never shell code.
$ErrorActionPreference = 'Stop'
try {
  Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class NotesWindowsCapture {
  [StructLayout(LayoutKind.Sequential)]
  struct Info {
    public uint Attributes;
    public System.Runtime.InteropServices.ComTypes.FILETIME Created, Accessed, Written;
    public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool GetFileInformationByHandle(SafeFileHandle file, out Info info);
  const uint Reparse = 0x400, DirectoryAttribute = 0x10;
  const uint ShareReadWrite = 3, OpenExisting = 3, OpenReparsePoint = 0x200000, BackupSemantics = 0x2000000;
  static string Extended(string path) {
    if (path.StartsWith(@"\\?\")) return path;
    return path.StartsWith(@"\\") ? @"\\?\UNC\" + path.Substring(2) : @"\\?\" + path;
  }
  static Info Inspect(SafeFileHandle handle) {
    Info info;
    if (!GetFileInformationByHandle(handle, out info)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    if ((info.Attributes & Reparse) != 0) throw new IOException("symlink: 笔记路径包含 reparse point（符号链接或 junction）。");
    return info;
  }
  // No write/delete sharing: neither rename nor in-place FSCTL_SET_REPARSE_POINT is allowed.
  // Parents remain pinned until the entire scan finishes.
  static SafeFileHandle Open(string path, bool directory, bool allowMissing) {
    // Metadata-only access (0x80) does not enforce these sharing locks on Windows.
    var handle = CreateFileW(Extended(path), directory ? 0x81u : 0x80000000u, directory ? 1u : ShareReadWrite, IntPtr.Zero, OpenExisting, OpenReparsePoint | BackupSemantics, IntPtr.Zero);
    if (handle.IsInvalid) {
      int error = Marshal.GetLastWin32Error(); handle.Dispose();
      if (allowMissing && (error == 2 || error == 3)) return null;
      throw new System.ComponentModel.Win32Exception(error, "无法固定笔记路径句柄: " + path);
    }
    try {
      var info = Inspect(handle);
      if (((info.Attributes & DirectoryAttribute) != 0) != directory) throw new IOException("unsupported-file: 笔记路径类型不受支持。");
      return handle;
    } catch { handle.Dispose(); throw; }
  }
  public sealed class Entry {
    public string id;
    public string content;
  }
  public sealed class Result {
    public string status = "ready";
    public List<Entry> entries = new List<Entry>();
  }
  sealed class Capture : IDisposable {
    readonly List<SafeFileHandle> directories = new List<SafeFileHandle>();
    readonly Result result = new Result();
    int count;
    long bytes;
    void Pin(string path, bool allowMissing) {
      var handle = Open(path, true, allowMissing);
      if (handle == null) { result.status = "missing"; return; }
      directories.Add(handle);
    }
    public Result Run(string projectRoot, string notesPath) {
      string project = Path.GetFullPath(projectRoot);
      string cursor = Path.GetPathRoot(project);
      Pin(cursor, false);
      foreach (string part in project.Substring(cursor.Length).Split(new char[]{'\\'}, StringSplitOptions.RemoveEmptyEntries)) {
        cursor = Path.Combine(cursor, part); Pin(cursor, false);
      }
      foreach (string part in notesPath.Split('/')) {
        if (part.Length == 0 || part == "." || part == ".." || part.IndexOfAny(new char[]{'\\', ':'}) >= 0) throw new IOException("invalid-path: 无效笔记相对路径。");
        cursor = Path.Combine(cursor, part); Pin(cursor, true);
        if (result.status == "missing") return result;
      }
      Walk(cursor, "", 0);
      return result;
    }
    void Walk(string directory, string relative, int depth) {
      if (depth > 32) throw new IOException("scan-limit: 笔记目录超过最大深度。");
      // Enumerate lazily so the entry budget also bounds directory enumeration.
      foreach (string target in System.IO.Directory.EnumerateFileSystemEntries(Extended(directory))) {
        if (++count > 10000) throw new IOException("scan-limit: 笔记目录条目超过上限。");
        string name = Path.GetFileName(target);
        string id = relative.Length == 0 ? name : relative + "/" + name;
        // Attributes only choose the open mode; the opened handle decides the type and reparse status.
        if ((File.GetAttributes(target) & FileAttributes.Directory) != 0) {
          Pin(target, false);
          result.entries.Add(new Entry { id = id });
          Walk(target, id, depth + 1);
        } else {
          using (var handle = Open(target, false, false)) {
            var before = Inspect(handle);
            long size = ((long)before.SizeHigh << 32) | before.SizeLow;
            bytes += size;
            if (size > 4 * 1024 * 1024 || bytes > 32 * 1024 * 1024) throw new IOException("scan-limit: 笔记文件或目录总量超过读取上限。");
            // Allocate only the bounded, inspected size; never read an unbounded growing file.
            byte[] content = new byte[(int)size];
            using (var stream = new FileStream(handle, FileAccess.Read)) {
              int read = 0;
              while (read < content.Length) {
                int n = stream.Read(content, read, content.Length - read);
                if (n == 0) throw new IOException("unstable-scan: 捕获期间文件发生变化。");
                read += n;
              }
              if (stream.ReadByte() != -1) throw new IOException("unstable-scan: 捕获期间文件发生变化。");
              var after = Inspect(handle);
              if (before.SizeHigh != after.SizeHigh || before.SizeLow != after.SizeLow || before.Written.dwHighDateTime != after.Written.dwHighDateTime || before.Written.dwLowDateTime != after.Written.dwLowDateTime || before.IndexHigh != after.IndexHigh || before.IndexLow != after.IndexLow || before.Links != after.Links) throw new IOException("unstable-scan: 捕获期间文件发生变化。");
            }
            result.entries.Add(new Entry { id = id, content = Convert.ToBase64String(content) });
          }
        }
      }
    }
    public void Dispose() {
      for (int i = directories.Count - 1; i >= 0; i--) directories[i].Dispose();
    }
  }
  public static Result Run(string projectRoot, string notesPath) {
    using (var capture = new Capture()) return capture.Run(projectRoot, notesPath);
  }
}
'@
  [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $result = [NotesWindowsCapture]::Run($request.projectRoot, $request.notesPath)
  [Console]::Out.Write(($result | ConvertTo-Json -Depth 4 -Compress))
} catch {
  [Console]::Error.WriteLine($_.Exception.ToString())
  exit 1
}
