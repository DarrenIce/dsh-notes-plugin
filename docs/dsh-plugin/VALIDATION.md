# DSH 插件运行验证记录

日期：2026-10-28。产品需求见 [PRD](./PRD.md)，实现边界见 [IMPLEMENT](./IMPLEMENT.md)，提交与任务见 [TODO](./TODO.md)。

## 1. 环境与证据分层

- Fedora Linux，本机 Node `v24.18.0`，DSH `0.2.1-rc.2`，Cordis `4.0.5`。
- 现有 GUI：`http://192.168.31.248:3080`，实际 Web profile；未启动替代 Web 服务器，未修改 DSH 宿主。
- 浏览器：Playwright 驱动本机已安装的 Chrome，使用临时独立浏览器状态。
- 实施分支：`feat/dsh-plugin`，原规划基线 `8219543`。
- 设计和任务拆分沿用上一轮已复核文档；本轮最终验收由用户指定的 GPT-6.1-Sol Xhigh 子代理执行，不调用 codex 验收工具。

本记录区分三类证据：纯核心/组件回归；使用真实安装版 DSH 模块的进程内集成；当前运行 Web profile 和物理浏览器连接。进程内集成中的 session、workspace 和 connection 替身不冒充真实 GUI。

## 2. 可复现命令

```sh
npm ci
npm test
npm run build:plugin
npm pack --dry-run
npx tsx scripts/benchmark-plugin.ts 1000
```

`npm test` 串行执行类型检查、核心、服务端、客户端、真实宿主模块集成及独立 Skill 安装检查。测试依赖均在本项目开发依赖和 lockfile 中，不依赖另一仓库的 React、jsdom 或临时 NODE_PATH。真实宿主集成要求已经安装目标 DSH `0.2.1-rc.2`；`npm ci` 不会安装完整宿主。可设置 `DSH_ROOT` 指定实际安装目录，未设置时从 `npm root -g` 查找全局 DSH，缺失时明确报错；不再写死开发机器目录。普通核心与 UI 测试不依赖 DSH。

## 3. 自动化验证

| 项目 | 结果与范围 |
| --- | --- |
| TypeScript | `npm run typecheck` 通过 |
| 核心 | 1 个测试文件通过；内部覆盖多 root、完整双语 id、解析共享、symlink/路径逃逸、只读空态、CLI 参数/退出码、真实 Git 基线和显式镜像基线、归档跨进程锁及遗留死锁恢复 |
| 服务端 | 20 项通过；工作区/子会话配置与缓存、目录生命周期、归因、权限/配置变更、读取竞态、项目根身份固定、Git 空仓库和子目录基线 |
| 客户端 | 11 项通过；React 组件交互、安全链接与 HTML、精确关联、会话独立状态、loading→ready 阅读和滚动恢复、迟到响应、草稿守卫 |
| 真实 DSH 模块集成 | 1 项集成场景通过；实际 Cordis、Typert、RemoteAccess、Gateway、SkillRegistry、SystemPrompt、ToolRuntime 和 ClientRemoteService；受限 principal、撤权、流取消/重开、scope inject、覆盖、complete prompt、卸载与非源码路径加载 |
| 独立 Skill 安装 | copy 和 symlink 两条真实安装路径均通过；覆盖 Codex/Claude 安装位置、校验、初始化/打包看板与归档 |

安全竞态测试实际在路径检查后执行目录 rename 和外部 symlink 替换，验证快照不返回外部正文；另覆盖 A/B 会话根切换、停用期间迟到请求和最新校验时间，不只是静态路径字符串测试。

Git 子目录工作区测试同时放置根目录和子目录不同的 manifest，确保使用子项目的真实 Git 路径。独立验收还在中文目录和中文 locale 中复测归档正文修改与重封，准确得到 append-only 基线问题。

## 4. 当前 GUI 的实际验证

通过 CLI 临时接入已提交的本地插件，刷新同一个运行实例。认证使用宿主公开 `connection.authenticatedUrl` 的临时辅助插件，将地址写入权限为 `0600` 的临时文件；没有把 token、cookie 或认证地址提交到项目或写进交付文档。临时接入的最终清理见第 8 节。

| 场景 | 实际结果 |
| --- | --- |
| 原生入口 | 当前真实会话出现与【对话】【轨迹】并列的【决策看板】 |
| 集中 Skill | 当前主会话实际调用 skill 和 notes_context 成功，winner 为 bundled / dsh-write-notes，资源来自构建后的集中目录，prompt present |
| 工具与只读空态 | 项目初始没有笔记根，浏览未创建目录；实际 notes_begin_review、notes_validate 在空态返回完整零问题 |
| 项目正文与校验 | 写入本次实际架构笔记后，看板自动出现 1 项；同步状态与校验 0 问题，全文可读 |
| 草稿联动 | 在原草稿与待发送 TXT 附件存在时加入引用，原文字、附件和正确项目相对路径均保留；Ctrl+Z 仅撤销这次插入；没有提交消息 |
| 外部变更 | 测试脚本在项目根内独立新增、保存和删除临时笔记，看板均自动更新；删除已选笔记后正文关闭 |
| 延迟 | 同一真实浏览器新增场景三次观察约 822、301、316 毫秒；受本机环境影响，不作为跨设备 SLA |
| 物理断线重连 | Chrome offline 后在磁盘新增文档，online 后重新同步看到该文档；捕获两次 `/api/remote.mux` WebSocket 建立；删除也同步 |
| 页签恢复 | 打开正文后点击宿主【对话】，再回【决策看板】，正文仍在；抽屉遮罩限定看板，不覆盖宿主页签/侧栏/输入区 |
| 主题 | 暗主题看板背景 `rgb(21,21,23)`、文字 `rgb(249,250,251)`；亮主题背景 `rgb(255,255,255)`、文字 `rgb(15,17,21)` |
| 页面运行状态 | 本轮最终端到端脚本 `exit 0`，page errors 为 `[]`，原草稿恢复，测试附件与临时笔记移除 |

2026-10-29 看板视觉重构：原生看板按独立 HTML 看板重排为架构基线 / 演进时间线 / 避坑智库 / 决策清单，并补上搜索浮窗、反向锚点复制与四段式阅读抽屉。验证使用同一份样例数据分别渲染原生组件与独立 HTML 看板做逐视图截图对照（亮/暗/窄屏），并新增组件测试覆盖 KPI 路由、搜索直达、避坑条目与校验提示。本轮未重启运行中的宿主：启动 token 只存在于启动它的终端，未取得新的真实 GUI 认证，因此没有重新截图或重测主题色；上表主题行记录的是重构前的结果。重构后亮色画布改为宿主 token 派生的浅灰纸面，暗色仍以宿主 `bg-base` 为底。

实际 GUI 测试没有用独立 HTML 或另起 Vite 页面替代现有应用。截图作为独立交付附件保留，不把构建产物或临时测试数据提交。

## 5. 真实子 agent 覆盖

- 实际 spawn 的 Sol 审查会话 `90840bf6-8d7b-48b5-9443-5ed15430a558` 调用 skill、notes_context、notes_search 和 notes_begin_review 成功；能够检索主会话新写的架构笔记，winner bundled / dsh-write-notes、skill 工具已注册、prompt present。
- 实际 fork 会话 `66cd45b1-a808-4a5b-bc4f-1798bf22984e` 实际加载全文及调用 notes_context 成功，资源基址、projectRoot 和 notesRoot 正确。
- 探针暴露子会话未登记 workspace 时无法继承目录覆盖，已在 `6bb069c` 修复：可信 header 的 canonical 根唯一匹配登记工作区时共享身份与配置；歧义拒绝，显式错误归属不能回退救活。专项测试验证自定义目录和同根缓存共享。

覆盖结论仅限本轮实际进程内 spawn/fork、当前 Web profile 与使用的 preset。外部 agent 后端、其他 profile、任意定制 preset 均未作普遍承诺。

## 6. 性能观察

命令 `npx tsx scripts/benchmark-plugin.ts 1000`，测试数据 1,000 篇、估算正文 289,000 字节；同机单次结果：

| 指标 | 观测值 |
| --- | --- |
| 冷完整捕获、解析与校验 | 165 ms |
| 强制新扫描 | 137 ms |
| 服务端文件修改→快照 | 187 ms |
| 本次运行 RSS 增量 | 45 MiB |
| 同根服务条目 | 1 |
| 取消后观察器 / 消费者 | 0 / 0 |

该脚本创建独立临时项目并清理，不写用户项目；结果是观测而非性能保证。现有 GUI 的延迟另列于第 4 节，不能和进程内快照延迟混为同一测量。

## 7. 验收发现及修复

| 发现 | 修复与验证 |
| --- | --- |
| realpath 检查后目录替换可越界读取 | `67b0ec3` 逐级目录句柄、安全镜像、响应前身份复核；`833f05d` 确定性竞态测试 |
| 中文 Git 环境和无提交仓库被误报不完整 | `7b08ac3` 稳定语言、明确 no-git/unborn；专项回归 |
| GUI 插件作用域缺少 remote.decisionNotes inject | `0444170` 挂载后以正确依赖作用域消费；真实 scoped Gateway 和当前 GUI 复测 |
| 子目录工作区基线路径错误 | `041141c` Git 前缀；根/子目录不同 manifest 回归和独立验收复测 |
| loading 阶段清除会话阅读状态 | `3978555` 保存真实根身份、ready 后恢复；React 回归及真实页签切回 |
| 阅读遮罩覆盖宿主导航 | `460ab78` 限定包含块；真实 GUI 点击宿主页签通过 |
| 子会话默认根忽略工作区覆盖 | `6bb069c` 唯一 canonical 根复用，歧义拒绝；专项服务端回归 |
| 项目根整体被重定向时 child 可降格到外部 synthetic root | `89eb195` 固定会话与持久 canonical 项目身份，拒绝父会话、已见/未见子会话及未登记根的重定向；独立原复现已关闭 |
| 测试默认路径绑定开发机器 | `822a327` 统一 DSH_ROOT / 全局安装定位，README 明确完整宿主前提 |

归因边界：完整基线中未恶化的问题可以作为历史问题；普通文件工具不提供可信作者证据时，内容变化和潜在并发一律保守降级。当前端到端流程不会自动把此类新问题标成本次引入；introduced 的独立证据接口由纯分类器测试验证。没有系统结束任务或 Git 提交硬门禁。

## 8. 最终验收与清理

独立验收最终 **PASS**，open findings 为 `[]`，报告见 [ACCEPTANCE](./ACCEPTANCE.md)。源码验收基准 `822a327`；交付包使用已提交文档基准 `11ec9c7` 的产物，代码与验收基准一致。最后一轮 `notes_validate` 返回完整、issues `[]`、warnings `[]`，校验覆盖最后一次实际笔记修改。

实际 `npm pack` 得到 35 项、约 97.8 kB 压缩包、312.4 kB 解包内容。将该 tarball 安装进当前 profile 后，磁盘包为 profile 内实体，并以该安装目录为 cwd 执行真实宿主模块集成，exit 0；测试中的产品服务端/Skill 产物来自安装包，测试程序和客户端契约助手仍由仓库测试驱动，Session/Workspace/Connection 替身边界不变。

安装器实际提示 missing Cordis peer；目标 DSH 提供的 Cordis 4.0.5 满足 ~4.0.5，提供宿主依赖的组合已通过集成。普通 Node 脱离 DSH 直接加载时仍需自行满足 peer。

本次从源码 link 切换到 tarball 后，现有 GUI 保持功能正常，但主会话与一个新子会话的实际 `notes_context` 仍报告 repo/assets 来源。因此没有把这一步描述为运行中 Host 已切换至 tarball 注册实例，也没有仅凭磁盘安装或 GUI 页签推断后端来源。现有证据不足以确定是会话作用域、HMR 重组还是运行时映射/缓存；不擅自重启正在工作的宿主。独立非源码目录产物加载已验证，后续正式启用或替换来源时须以实际 provider 路径及宿主应用诊断核实。

临时 `write-notes-like-deepseek` 和认证辅助插件均已移除；已核对 Web profile 的依赖与 bundle 列表恢复原有五个外部插件。现有 GUI 仍可认证访问，实际会话的【决策看板】贡献数恢复 0，Skill 目录随卸载消失。临时认证地址、浏览器 cookie 状态和测试环境目录已删除，测试笔记与附件已清理；仅保留交付包、真实截图，以及项目既有忽略规则下的本次架构笔记。

源码与 Git 提交不包含认证信息、临时浏览器状态、测试 fixture 或构建产物；未修改 DSH 宿主，未发布 npm、未推送远端、未保留长期部署。
