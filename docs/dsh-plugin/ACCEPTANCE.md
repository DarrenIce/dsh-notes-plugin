# 独立验收：DSH 决策笔记插件

日期：2026-10-28。验收模型：GPT-6.1-Sol，Xhigh；独立子会话 `90840bf6-8d7b-48b5-9443-5ed15430a558`。按用户要求未调用任何 codex 验收工具。

## 结论

**PASS**，目标范围为 Linux、Node 24、DSH `0.2.1-rc.2` Web profile。最终实现复核基准 `822a327`，后续 `11ec9c7` 仅同步已实现的架构与运行文档。没有未关闭的功能或安全 finding。

以下为验收子代理明确返回的机器语义结论，由 leader 落盘：`verdict=PASS; open findings=[]`。这不是 leader 从报告关键词推断的结果。

## 独立检查

独立执行 `npm test && npm run build:plugin && npm pack --dry-run --json`，均 exit 0。类型检查、核心测试文件、20 项服务端、11 项客户端、1 项真实宿主模块集成及 copy/symlink 独立 Skill 安装检查通过。发布清单 35 项，含服务端/客户端入口与完整 Skill 资源。

验收亲自调用真实 spawn 会话中的 skill、notes_context、notes_search 和检查工具，确认集中 provider、资源、短规则和实际项目笔记可用；亲阅现有 GUI 的明暗主题截图，并复核 leader 的浏览器证据。GUI 的物理断线重连、草稿原文字与 TXT 附件、独立撤销、无自动发送、增删改和阅读恢复由 leader 执行，未被表述为验收代理亲自操作。

## 发现与关闭

| Severity | 问题 | 修复与独立复核 |
| --- | --- | --- |
| P1 | 项目根被外部 symlink 替换后，子会话可以重新绑定并读取外部笔记 | `89eb195`；原始复现中父会话、已访问及首次访问子会话全部拒绝重定向 |
| P2 | 子目录工作区遗漏 Git manifest 基线路径前缀 | `041141c`；中文目录、中文 locale 下有效基线通过，改归档正文并重封正确报告 append-only 违规 |
| P2 | loading→ready 被误判为配置改变，清空阅读状态 | `3978555`；React 回归和现有 GUI 页签切回证据通过 |
| P3 | 真实宿主测试默认写死开发机器安装目录 | `822a327`；显式 DSH_ROOT 或全局安装定位，文档说明完整宿主前提 |

GUI 动态 namespace 注入和阅读遮罩问题另由 `0444170`、`460ab78` 修复，有对应宿主/浏览器复测。

## 保留边界

普通文件工具没有可信作者证据时，新问题报告来源不确定；introduced 证据接口有纯分类器测试，不宣称任意文件修改均能自动归责。真实宿主模块集成中的 Session、Workspace、Connection 替身与现有 GUI 证据明确分层。验收代理未修改源码或 profile。

最终临时接入清理、真实 tarball 安装观察和交付文件由 leader 核实，详见 [运行记录](./VALIDATION.md)。这些收尾元数据不属于未关闭实现缺陷。
