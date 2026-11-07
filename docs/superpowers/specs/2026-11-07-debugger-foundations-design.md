# Offline debugger foundations

The agreed roadmap moves the Explorer from opening a log to explaining its recorded execution. The first review milestone delivers reliable full-session navigation and an upgraded workbench. Subsequent milestones cover handoffs/context/retry analysis and then richer metrics, PTC trees, comparisons and redacted exports. These are separate deliverables, not features implicitly claimed by this milestone.

## Scope and evidence

- Source baseline: `deepseek-ai/deepseek-harness` master `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`; current published prerelease `dsh-v0.2.2-rc.1`; session format V4. Preserve V0–V4 decoding and raw sequence IDs.
- `packages/core/session/src/types.ts` defines tool call/result identities, turn-end reasons and non-surface assistant attempts. `packages/llm/llm/src/message.ts` and producer modules define extensible message sources.
- A runtime-injected user-role message must not overwrite the recorded human request. Unknown sources remain labeled with their original kind. Missing turn closure means unrecorded status, not inferred success.
- Tool inspection must link call and result independently, including pending calls and orphan results. Errors must remain reachable from summaries and timelines. Diagnostic attempts stay outside the settled conversation.
- Search literal full event text inside the Worker, independently of execution pages and UI previews. Return bounded snippets, stable source references, explicit current/all-session scope and filters; ignore stale requests.

## Approaches

1. Reuse the existing React/TypeScript projections and Worker, add factual navigation metadata, and refine the current shell. This is the implementation choice: it retains offline behavior, bounded views and existing tested semantics.
2. Replace the shell with a component framework and build a duplicate search index of serialized logs. Rejected for this milestone because it adds dependencies, retained log copies and migration risk without improving source fidelity.

## UI direction

Keep the existing blue identity with quieter surfaces, stronger typography and spacing, a clear active-session summary, compact source/status badges, a dedicated event search panel, and linked input/output/raw inspection. Support light/dark appearance using in-memory state and system preference; no browser storage or external fonts. Keep keyboard focus visible, controls named and usable at desktop and narrower widths. Search results and hidden details remain bounded/lazy.

## Privacy and performance

All parsing/search stays in the browser Worker. No network service, analytics or persistence is added. The four user-provided logs are test-only inputs outside the checkout; never commit them, their snippets, identifiers or download references. If environment policy prevents access, report each sample as untested instead of substituting synthetic results.

Search should traverse existing event values without retaining another complete serialized log. Replies are paged to 50 results with short excerpts. Source metadata and call/result links are references to existing records. Never execute commands, URLs or code read from a session.

## Acceptance

- Tests first reproduce injected-prompt overwrite, missing result inspection links, absent turn outcomes/error navigation and preview/page-limited search.
- Unicode, unknown source kinds, V0–V4, out-of-order parallel results, pending/orphan results, empty searches and pagination remain correct.
- Browser checks cover real Workers, cross-session search, linked inspection, page changes, cancellation/replacement, keyboard focus, both themes and narrow layouts.
- Run the public upstream corpus, `pnpm check`, `git diff --check`, representative large synthetic imports and exact-HEAD three-platform PR CI. Private-sample verification is reported separately.
