# DSH Session Log Explorer

[English](README.md) | 中文

这是一个在浏览器本地运行的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 会话日志查看器。它把导出的 JSONL 工件还原为可阅读的执行叙事、可检查的事件记录，以及带时间信息的 Agent 轨迹；会话内容不会发送到服务器。

> 本项目独立开发，非 DeepSeek 官方项目，也不代表 DeepSeek 的认可或支持。

## Quick Start

无需克隆仓库，直接启动离线查看器：

```sh
npx @eriklee1895/dsh-session-log-explorer
```

命令只会在 `127.0.0.1` 提供随包附带的静态文件，然后打开浏览器。无图形终端可使用 `--no-open`，也可以用 `--port 4179` 指定本地端口；如果 npm 默认 registry 不是官方源，请在包名之前加入 `--registry=https://registry.npmjs.org`。

![轨迹视图：决策、活跃执行、等待和工具调用](docs/screenshots/trajectory.png)

## 它能帮助你学习什么

- 按 Agent 的已记录决策还原 turn 与 step，无需直接阅读原始 chunk 事件。
- 在同一工作区串联工具调用、推理、模型回复、错误与对应的原始事件。
- 查看每个请求实际生效的 rendered system prompt、模型配置与工具目录；对比有意义的 prompt 或工具变更，不重复展示未变化的恢复快照。
- 阅读 [DSH 请求上下文 Epoch](docs/request-context-epochs.zh.md)，理解这些快照为何出现、如何用于回放与恢复。
- 从 [如何读一份 DSH Session Log](docs/session-semantics.zh.md) 开始，建立 Session、Turn、Step、surface、compaction 与 subagent 的整体心智模型。
- 对比执行顺序、已记录的活跃执行时间，以及保留等待间隔的 wall-clock 时间。
- 以可折叠 JSON 树检查事件数据，或复制原始 JSON 记录。
- 在本地打开导出的会话目录、JSONL、Zstandard 压缩 JSONL 和 DSH ZIP。

## 截图

### 本地导入

![从文件或目录导入 DSH 会话日志](docs/screenshots/import.png)

### 总览会话

![turn、step、工具调用、耗时和 token 总览](docs/screenshots/overview.png)

### 阅读执行叙事

![展开的执行 step，包含推理、工具与模型回复](docs/screenshots/execution.png)

### 学习 Agent 轨迹

![包含 Sequence、Active time 和 Wall clock 的时间线](docs/screenshots/trajectory.png)

## 隐私

文件由浏览器 Worker 解析，只保留在当前浏览器标签页。应用没有服务端接口、云同步、分析埋点、会话编辑，也不会在刷新页面后保留会话内容。

## 支持的输入

- `session.jsonl`（V0）、`session.vN.jsonl`（V1–V4）
- 上述日志对应的 `.jsonl.zstd` 压缩文件
- 会话目录，包括 `subagents/` 与 `media/`
- DSH 会话导出的 ZIP

解析器支持 **V0–V4** 会话格式，包括旧版 packed chunk 和新版内嵌 timed stream。它保留原始事件，处理 V3 系统消息替换和 V4 工具结果，媒体与文件附件始终留在本地。目录和 ZIP 导入会按数值选择每个会话的最高 generation；遇到不支持的新版本会明确报错，不会静默回退。已核验的上游版本、测试覆盖与限制见 [兼容性验证](docs/compatibility.md)。

加载和 Replace Session 会显示阶段状态与取消按钮；替换失败或取消时保留当前会话。长任务的执行、时间线和对话采用分页，详情展开时才渲染。具体测量与内存限制见 [加载性能](docs/loading-performance.md)。

## 本地开发

需要 Node.js 20+ 与 pnpm。

```sh
pnpm install
pnpm dev
```

打开 Vite 输出的本地地址。生产构建与测试：

```sh
pnpm build
pnpm test
```

## npm 发布

发布时，在 PR 中明确把 `package.json` 升到尚未使用的稳定版 `X.Y.Z`，检查包内容，并将审核通过的 PR 合入 `main`。合入前运行 `pnpm check` 和 `npm pack --dry-run --registry=https://registry.npmjs.org`。`publish.yml` 会在 Windows、macOS 和 Linux 上检查同一个合入提交；三者全部通过后，才构建、验证并将该 tarball 连同 provenance 发布到 npm `latest`。纯文档或其他未改版本号的推送不会发布。

发布沿用已有 npm Trusted Publishing / GitHub OIDC，不需要 npm token。必须保留准确的 `publish.yml` 文件名、直接 push 触发方式和目前不使用 GitHub environment 的配置；[npm 还会校验调用方 workflow 和可选 environment](https://docs.npmjs.com/trusted-publishers/)。常规发布不得擅自改动这些身份或持久访问设置。

发布任务串行运行，不会取消正在上传的任务。上传前检查 main 当前的版本，并重新查询 npm 官方源；已存在的版本直接跳过且不移动标签，旧任务不能用较旧稳定版覆盖 `latest`。查询失败会在有限重试后终止，绝不当作“版本不存在”。检查、查询或构建暂时失败时，先诊断，再重跑原 workflow。每次只尝试上传一次；上传报错后查询 npm 核对包的完整性。如果结果仍未确认，必须先检查 npm 和运行记录，再决定是否重试。已发布的标签不得移动，版本号不得复用；修正需通过新版本 PR。

保留指向 main 上提交、且与包版本一致的 annotated `vX.Y.Z` tag，作为显式恢复入口；同样执行三平台检查和发布保护，不需要生成 tag 或触发另一个 workflow。预发布版本/tag（如 `v0.2.0-rc.1`）和带构建元数据的版本会跳过发布，目前没有自动预发布通道。包内容验证和恢复细节见 [AGENTS.md](AGENTS.md#npm-releases)。

## 范围

该工具用于本地学习和调试导出的日志。它不连接运行中的 DSH Agent、不修改会话、不提供实时 tail，也不会把独立子 Agent 日志按时间戳伪造成一条全局因果序列。

## 许可证与声明

项目代码采用 [MIT License](LICENSE)。DeepSeek Harness favicon 的来源说明与独立项目声明见 [NOTICE.md](NOTICE.md)。
