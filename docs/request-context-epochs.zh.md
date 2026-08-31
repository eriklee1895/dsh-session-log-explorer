# DSH 的请求上下文 Epoch

Explorer 中的 `EPOCH 01` 不是第二段对话、Turn 或 system prompt，而是一份带版本号的、模型可见请求上下文快照。

DSH 将持久化值命名为 `EpochHeader`。每条 `request/header` 事件保存消息历史之外、一次模型请求还需要的完整状态：

- 模型调用配置：provider、model、reasoning effort 及相关标量；
- 最终渲染出的 system prompt 文本；若本次请求没有则缺省；
- 组装后的工具 schema；若本次请求没有工具则缺省。

最新 header 就是下一次模型请求生效的上下文，直到新的 header 取代它。消息历史则从追加式 Session log 独立重建。

## 为什么一份日志会有多个 Epoch

DSH 记录的是完整快照，而不是只记录 prompt 的 diff 链。每个 header 出现的原因有三种：

| 原因 | 含义 | 是否证明 system prompt 改了？ |
| --- | --- | --- |
| `initial` | 新 Session log 的第一个 header。 | 还没有可比较的旧值。 |
| `resume` | 新 Agent loop 在已有 header 的 log 上发起首次请求，例如恢复或 fork seed。 | 不证明，快照可以完全相同。 |
| `change` | 同一个 live loop 后续请求使用了不同的 header。 | 只有 `system` 字段不同才说明 prompt 改了。 |

例如：

| Epoch | System prompt | Tools | Explorer 标签 |
| --- | --- | --- | --- |
| Epoch 01 | A | 25 | Initial request context |
| Epoch 02 | A | 25 | Session resumed · context unchanged |
| Epoch 03 | A | 26 | Tools updated · system prompt unchanged |
| Epoch 04 | B | 26 | System prompt updated |

第三行最容易让人误解：虽然 system prompt 原样又出现在日志中，但只是 tools 变了；DSH 仍会写整份 request header 快照。

## DSH 为什么这样设计

精确的模型输入不只是可见聊天记录。回放、恢复或 fork 还需要当时的模型路由、最终 system prompt 和工具 schema。完整快照能让 DSH 直接恢复最近一次已知请求上下文，无需重放 diff 链，也不依赖仍然在线的运行时配置。

其他 Agent harness 往往也有等价状态，只是叫作 request options、model-call configuration、checkpoint 或 run snapshot。很多系统不会把它与每份持久化 transcript 一同保存，因此没有用户可见的 `EpochHeader` 术语。`Epoch` 是 DSH 为持久化和回放选用的术语，不是通用 Agent 概念。

## Explorer 如何呈现

Explorer 将区块命名为 **Model Request Context**，避免把每张卡误读成一份新的 system prompt。

- **EPOCH 01**：首个完整快照。
- 未变化的 resume：紧凑显示，不重复整段 prompt。
- system、model 或 tools 改变：准确点明变化字段。
- 展开卡片：查看 rendered system prompt、模型配置和工具列表；system prompt 改变时显示行级 diff。
- 每个 Step：显示生效的 context epoch，并能跳到原始 `request/header` 事件。

Explorer 能展示最终渲染后的 prompt 字符串，但无法可靠还原生成它的原始 plugin section。请把这些记录视作敏感内容：其中可能包含仓库指令、路径、工具描述和部署专属规则。

## 源码依据

本文依据 DSH 的 [`EpochHeader`](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/session/src/types.ts)、request-header folding 工具，以及 Agent loop 写入 `initial`、`resume`、`change` 快照的逻辑。这里描述的是 Explorer 当前支持的导出 Session 格式，而不是对未来 DSH 版本的兼容性承诺。
