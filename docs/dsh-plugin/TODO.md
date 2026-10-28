# DSH 决策笔记插件：TODO 与开发入口

- 日期：2026-10-28。
- 规划分支：`docs/dsh-plugin-plan`。
- 当前阶段：方案已收敛，仅交付文档；所有功能开发任务未开始。
- 需求与验收：[PRD](./PRD.md)。架构与接口：[IMPLEMENT](./IMPLEMENT.md)。

## 1. 本轮文档交付

- [x] 通过七轮交互确定入口、skill 生效、维护授权、存放路径、看板操作、校验策略和外观。
- [x] 静态核对本机 DSH `0.2.1-rc.2` 的原生页签、skill provider、提示词、文件变化流和草稿接口。
- [x] 咨询 Codex 完成设计复核与任务拆分。
- [x] 从干净工作树创建独立规划分支。
- [x] 整理 [PRD](./PRD.md)、[IMPLEMENT](./IMPLEMENT.md) 和本任务清单。

未开始功能开发、安装、部署或推送。后续获准开发时，从 T-01 开始；本轮文档完成不等于任何 T 任务完成。

## 2. 固定范围

- Web profile 一次启用，覆盖该 profile 下的兼容工作区会话。
- 在【对话】【轨迹】旁新增原生【决策看板】；沿用宿主空白会话隐藏规则，无需宿主改动。
- 简短全局规则加按需 skill，笔记维护跟随任务授权，机械性小改跳过。
- 默认 `.agents/notes/`，按工作区覆盖目录；Markdown 仍在项目中。
- 只读看板保留现有核心展示，适配 DSH 主题；引用可加入本会话草稿，由用户发送。
- 实时更新与自动校验；本次引入、历史和来源不确定的问题分别处理。
- 保留通用 skill、独立看板、CLI、复制及符号链接安装的独立可用性。

需求编号和验收标准以 [PRD 的 R-01 至 R-12](./PRD.md#4-功能需求与验收标准) 为准。

## 3. 任务依赖与覆盖

| 状态 | ID | 任务 | 依赖 | 覆盖需求 |
| --- | --- | --- | --- | --- |
| 未开始 | T-01 | 最小运行探针与接口契约 | 无 | R-01、R-02、R-03、R-07、R-09、R-12 |
| 未开始 | T-02 | 可独立分发的共享核心与 CLI 兼容 | T-01 | R-05、R-09、R-11 |
| 未开始 | T-03 | 插件打包、加载与卸载骨架 | T-01 | R-01、R-12 |
| 未开始 | T-04 | 会话工作区绑定与路径配置 | T-03 | R-05、R-10、R-12 |
| 未开始 | T-05 | 共享快照与递归实时订阅 | T-02、T-04 | R-08、R-10、R-12 |
| 未开始 | T-06 | 全局 skill、授权正文与工具入口 | T-02、T-03、T-04 | R-01、R-03、R-04、R-05、R-11、R-12 |
| 未开始 | T-07 | 自动校验、问题归因与 agent 反馈 | T-01、T-05、T-06 | R-04、R-09、R-10 |
| 未开始 | T-08 | 原生看板与会话浏览状态 | T-05、T-07 | R-02、R-06、R-08、R-10、R-12 |
| 未开始 | T-09 | 笔记引用安全回填草稿 | T-01、T-08 | R-07、R-10 |
| 未开始 | T-10 | 综合验证与使用文档 | T-06、T-07、T-08、T-09 | R-01 至 R-12 |

T-01 后，T-02 和 T-03 可以独立推进。后续需要共享文件时，先约定模块接口，避免并行改动互相覆盖。

## 4. 任务详情

文件分工是建议，不表示文件已存在。新模块名以运行探针确认的构建方式调整，但不能改变产品范围。

### T-01：最小运行探针与接口契约

- [ ] 在目标 DSH 版本上验证 bundle/client 原生加载、页签注册和卸载，不修改宿主。
- [ ] 验证 skill 可见性、真实来源、资源访问、短规则组装及兼容 preset 的行为。
- [ ] 验证现有连接的身份解析、RPC/typedstream 或 workspaceFiles 组合、取消与重连。
- [ ] 验证公开 InputActions 回填草稿、主题变量以及会话切换守卫。
- [ ] 核验校验摘要到 agent 的通道和可靠任务起点；缺少生命周期时明确插件自有检查区间，不编造 DSH task API。
- [ ] 把运行命令、版本、实际结果和边界回填到实现文档。

建议文件：`scripts/probe-dsh-contracts.ts`（新建）、[IMPLEMENT](./IMPLEMENT.md)。

完成标准：关键 API 的实际组合有可复现证据，失败或缺失能力有明确处理方案，尚未验证项不能标为通过。

### T-02：可独立分发的共享核心与 CLI 兼容

- [ ] 统一看板和打包器解析，使用完整根内相对路径作为笔记身份。
- [ ] 目录、格式、链接、归档校验与归档操作接受显式 root 并返回结构化结果。
- [ ] 把共享核心放入通用 skill 的独立分发边界，不让复制安装后的脚本依赖外层插件源码。
- [ ] 导入库不执行命令、不退出进程；宿主不使用 process.chdir 或全局环境切换项目。
- [ ] 保留原 CLI 参数、退出码、无 Git 降级、归档封印和链接报告语义。
- [ ] 验证复制/符号链接安装、初始化和打包单文件看板均独立可用。

建议文件：`skills/write-notes-like-deepseek/scripts/lib/`（新建）、[目录入口](../../skills/write-notes-like-deepseek/scripts/agent-note-tree.ts)、[现有校验器](../../skills/write-notes-like-deepseek/scripts/verify-agent-note-format.ts)、[归档入口](../../skills/write-notes-like-deepseek/scripts/archive-agent-note.ts)、[看板构建入口](../../skills/write-notes-like-deepseek/scripts/build-board.ts)、[独立看板](../../skills/write-notes-like-deepseek/assets/agent-notes-board.html)、[安装检查](../../scripts/test-skill-install.mjs)。其余校验脚本同步适配。

完成标准：核心能够在多 root 下并发运行；独立 skill 的完整安装检查和必要 CLI 回归通过；读取/校验不创建目录或重写封印。

### T-03：插件打包、加载与卸载骨架

- [ ] 确定包名、版本范围、服务端入口、client bundle、manifest 和 bundle patch。
- [ ] 构建包含 DSH 适配正文及全部必要资源的完整发布包。
- [ ] Web profile 一次启用后提供注册项，不向各项目复制 skill 或注入配置文件。
- [ ] 卸载/停用释放服务、规则、provider、页签与订阅。
- [ ] 验证最终打包内容可在非源码路径加载，不依赖开发机器的绝对路径。

建议文件：[包配置](../../package.json)、`cordis.patch.yml`、`tsconfig.json`、`scripts/build-plugin.ts`、`src/index.ts`、`src/client/index.tsx`、`src/contracts/plugin.ts`（其余均新建）。

完成标准：打包产物在目标 Web profile 的最小集成环境中可加载与卸载，独立 skill 分发仍成立；不进行本轮未授权的正式部署或发布。

### T-04：会话工作区绑定与路径配置

- [ ] 宿主按 sessionId 核验所属工作区，解析稳定项目根，不跟随 agent 临时 working_directory。
- [ ] 支持默认目录及工作区覆盖，读取、检索、写入目标和校验共用同一结果。
- [ ] 限制路径遍历、符号链接逃逸和未授权工作区，不信任客户端提交的任意绝对路径。
- [ ] 区分目录不存在、无权限、路径类型错误；读取不创建目录。
- [ ] 配置变化建立新版本，失效旧缓存、基线和订阅，不自动迁移文件。

建议文件：`src/server/workspace-context.ts`、`src/server/config.ts`、`src/contracts/workspace.ts`（新建）。

完成标准：两个工作区使用不同目录配置时互不影响；不同 worktree 不混用；无笔记项目维持只读空态。

### T-05：共享快照与递归实时订阅

- [ ] 实现会话授权的快照、正文和变化订阅接口，数据按工作区与配置版本共享。
- [ ] 管理 depth 0 观察的递归订阅，处理目录首次创建及删除重建。
- [ ] 覆盖外部编辑、增删、归档、checkout 和重连后的全量同步。
- [ ] 响应携带身份、版本和完整性，迟到或失败扫描不覆盖新快照。
- [ ] 最后一个消费者离开且无 agent 需求后释放资源；卸载时完整清理。

建议文件：`src/server/note-service.ts`、`src/server/note-watch.ts`、`src/server/note-transport.ts`、`src/contracts/notes.ts`（新建）。

完成标准：看板和校验看到一致版本；同工作区多会话复用服务，不同工作区隔离；有取消、断线与目录变化的集成证据。

### T-06：全局 skill、授权正文与工具入口

- [ ] 注册全局 provider 和简短 section，正文按需加载，机械改动跳过。
- [ ] DSH 适配正文显式替换普遍确认门，尊重任务授权与项目约束。
- [ ] 工具或已解析资源入口支持实际 notesRoot，不要求项目 npm scripts 或本地 skill 副本。
- [ ] 保留通用正文；构建资源包含 references、templates、scripts 和必要 assets。
- [ ] 识别同名遮蔽、工具不可见、complete prompt 等边界，提供可查看的实际来源和状态。
- [ ] 核验进程内 spawn/fork 的覆盖；不承诺未经验证的外部后端或其他 profile。

建议文件：`src/server/skill-provider.ts`、`src/server/prompt-policy.ts`、`src/server/note-tools.ts`、`src/skills/dsh-write-notes/SKILL.md`（新建）、构建脚本。

完成标准：兼容新会话无需项目安装即可发现并加载 skill；模型读到一致的授权、路径和校验要求；工具写入遵守会话权限。

### T-07：自动校验、问题归因与 agent 反馈

- [ ] 对稳定、完整快照后台校验，结果包含根、配置、规则和快照版本。
- [ ] 区分首次观察状态与具体检查区间的基线；不把对话轮次自动当作开发任务。
- [ ] 使用稳定 issue key，处理重命名、状态迁移与同类错误恶化。
- [ ] 以证据区分本次引入、历史和来源不确定，不能只按修改文件路径归因。
- [ ] 缺基线、并发、重启、checkout、配置/规则变化时保守降级。
- [ ] 看板和 agent 得到各自正确的状态；通过简短上下文或工具查询详情，收尾结果覆盖最后一次相关修改。

建议文件：`src/server/validation-service.ts`、`src/server/issue-baseline.ts`、`src/server/agent-feedback.ts`、`src/contracts/validation.ts`（新建）。

完成标准：有新问题、旧问题、并发来源不确定、扫描失败和过期结果的测试；不自动重写归档封印，不加入系统硬门禁。

### T-08：原生看板与会话浏览状态

- [ ] 原生注册【决策看板】，位置与行为符合 R-02。
- [ ] 保留总览、时间线、避坑清单、目录、搜索/筛选、关联与全文阅读。
- [ ] 适配明暗主题、字体、可用尺寸；正确显示空态、加载、权限、断线和校验状态。
- [ ] 数据按工作区共享，筛选、选中项和必要滚动位置按会话保存。
- [ ] 笔记删除或移动后更新选择；净化正文与链接，避免同名 slug 误跳转。

建议文件：`src/client/decision-board.tsx`、`src/client/board-store.ts`、`src/client/board-components.tsx`、`src/client/note-renderer.tsx`、`src/client/board.css`（新建），客户端入口同步接入。

完成标准：与原看板的主要功能逐项对照，有真实 DSH 页面验证；不加入编辑、新建、归档或删除控件。

### T-09：笔记引用安全回填草稿

- [ ] 使用公开 captureInsertion/insertText，按需插入标题、可定位路径及选中摘录。
- [ ] 保留原文字、芯片、命令与附件；捕获选区折叠为零长度插入点，遵守 draftRev 和提交状态。
- [ ] 异步操作绑定 sessionId、配置和代次，切换/销毁取消，旧响应不写入其他会话。
- [ ] 插入失败提示重试，不通过替换全稿或 DOM 强制写入。
- [ ] 只准备草稿，由用户发送；不调用 submit、followup、steer。

建议文件：`src/client/note-reference.ts`（新建），看板和相关组件同步接入。

完成标准：已有草稿、异步期间继续输入、切换会话、提交中、附件和撤销等场景都有验证。

### T-10：综合验证与使用文档

- [ ] 多工作区并发、同工作区多会话、快速切换和权限边界通过。
- [ ] 目录首次创建、删除重建、外部保存、归档、checkout、重连和资源释放通过。
- [ ] 新增/历史/不确定归因、过期和不完整校验、只读封印检查通过。
- [ ] 通用 skill 安装、CLI、独立看板及最终发布包资源回归通过。
- [ ] 草稿保留、主题、文档关联及 HTML/链接安全通过。
- [ ] 记录真实 DSH 环境、命令、输出和性能观察，补安装、配置、授权语义与故障说明。
- [ ] 根据开发实况更新本清单，经最终验收后再说明部署/发布安排。

建议文件：`tests/core/notes.spec.ts`、`tests/server/workspace-isolation.spec.ts`、`tests/server/note-watch.spec.ts`、`tests/server/issue-baseline.spec.ts`、`tests/client/decision-board.spec.tsx`、`tests/client/note-reference.spec.tsx`、`tests/integration/dsh-plugin.spec.ts`（新建）、[README](../../README.md) 与本组规划文档。

完成标准：R-01 至 R-12 均有证据或明确缺口；没有运行的测试不写成通过，不用独立页面代替现有 DSH GUI 验证。

## 5. 执行与交付规则

- 一个完成且自洽的开发任务对应一个或同主题的一组提交，显式添加相关路径。
- 不提交依赖目录、临时输出、数据库、日志或未规定入库的构建产物。
- 开发方案、任务拆分与最终验收遵循会话的 Codex 协作要求。运行探针导致实质设计变化时记录原因并复核。
- 每项任务更新状态时附测试/运行证据和 commit。未完成不能勾选；被外部条件阻断需写出具体条件。
- 不默认 push；安装、部署和发布须在用户后续授权范围内执行。

## 6. 状态记录模板

以下仅为后续执行模板，当前无功能完成记录：

```text
任务：T-xx
状态：未开始 / 进行中 / 已完成 / 有具体阻碍
实现与范围：
验证环境与命令：
结果与缺口：
提交：
下一依赖：
```
