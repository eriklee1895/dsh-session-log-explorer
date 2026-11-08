# Debugger navigation / 调试导航

Ctrl/Cmd K opens full-event search. It searches literal text, case-insensitively, in parsed event values and envelope fields; it does not interpret regular expressions or execute markup. This includes content after preview cutoffs and outside the current execution page. Search covers physical event history, including replaced messages and diagnostic attempts, rather than only the final model-visible surface. A phrase spanning separate JSON values is not a match. The query is limited to 500 characters.

搜索覆盖完整事件历史，而非仅当前页或模型最后可见的 surface。Ctrl/Cmd K 打开搜索；关键词按字面、不区分大小写匹配，跨不同 JSON 字段的连续短语不会匹配。不执行正则、HTML 或日志中的命令。

Choose **当前会话** or **所有已导入会话** explicitly. Source/type/tool/error filters combine with the query; empty text plus a filter lists matching events. Each response has at most 50 hits with 240-character excerpts. Facet selectors show at most 100 distinct values per category. Results follow imported session order and original event sequence; they do not assert a global causal order between agents. Counts represent matching events, not occurrences within a string.

定位结果会切换到对应 Session 和执行页，并选中原始事件。没有足够 Turn/Step 坐标的事件会提示无法精确定位，只展示其已知证据，不虚构所属 Step。“筛选本页摘要”仍只过滤当前时间线摘要，完整搜索是独立入口。

The inspector follows recorded call IDs for parallel and reversed tool results. Input, output and raw call/result links work from either endpoint. Pending means no result was recorded; a returned empty result is different. A result without a known call remains an orphan. Message badges distinguish `user`, `runtime-context`, `agent-message`, `subagent-settled`, `team-message` and other sources; missing or future sources stay explicit. Turn outcomes come from `turn/end`; an open or incomplete log is not reported as successful. Retry attempts appear as diagnostics, not settled assistant text.

错误数字统计带错误事实的原始事件，并不对一次失败的多条传播记录去重。点击错误数字或快捷入口可逐条检查；没有进入 Step 的错误也可定位。输入来源和 Turn 终态均可回到原始记录核实。

## Large content and privacy

Execution pages retain the 40-entry window. Prompt/reasoning/assistant/tool scalar previews are capped at 16,384 characters per field; input-source histories show at most 20 summaries per turn. Full values remain in the Worker for search and explicit raw inspection. Conversation display clips each card at 16,384 characters. These caps are per field, not a hard byte or memory limit on a whole page.

The structured inspector avoids building a tree for values over 131,072 characters: it shows a 32,768-character preview and offers a local download of the complete selected value. Selected raw events still cross to the main thread in full; very large single records, request headers, tool schemas and attachments can consume significant memory. The Worker retains source bytes, parsed events and projections, so memory grows with input size. Replacement temporarily retains two Workers.

所有搜索、主题切换和下载都在本机进行，不新增上传、分析埋点或浏览器存储。主题初始跟随系统，此后仅在当前页面内切换；刷新不会保留会话或主题。会话列表支持上下方向键及 Home/End；Ctrl/Cmd K 聚焦搜索，Escape 收起搜索。减少动态效果偏好仍适用于加载动画。

## Source and next stages

Source reference: DeepSeek Harness master [`fcc0ad4`](https://github.com/deepseek-ai/deepseek-harness/tree/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159), rechecked 2026-11-07; published product `0.2.2-rc.1` is a prerelease, writing format V4. Source declarations and producers define these facts; the Explorer does not recreate arbitrary plugin semantics.

This first milestone delivers factual navigation and a workbench foundation. Rich handoff/context/compaction/retry analysis, deeper PTC trees, per-step attribution, A/B comparison and redacted reproduction exports remain future milestones. Nothing here merges or publishes a release.

Synthetic browser checks can be reproduced after building, with Playwright installed separately:

```sh
CHROMIUM_PATH=/path/to/chromium node benchmarks/debugger-browser.mjs /path/to/playwright/index.mjs /tmp/dsh-debugger-check
```

The harness writes only its own synthetic fixture and screenshots to the supplied directory. It checks linked inspection, complete long-value download, search/reveal, themes, keyboard navigation, narrow layout and absence of external requests or storage writes. Private samples must not be passed to this screenshot harness.
