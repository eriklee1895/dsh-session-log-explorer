# DSH compatibility checks

The explorer reads recorded artifacts offline; it does not resume sessions, migrate files, or reproduce installed plugin projections. Execution and conversation views retain the recorded history, including records subsequently replaced on the model-visible surface. Request-context snapshots fold recorded surface replacements to find the system messages active at each header.

## Verified upstream baseline

Rechecked on 2026-11-07 against [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) master [`fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`](https://github.com/deepseek-ai/deepseek-harness/tree/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159). Its package version is `0.2.2-rc.1`. The latest GitHub release and npm `latest`/`next` point to `dsh-v0.2.2-rc.1`; this is a prerelease, not a stable release. The release tag resolves to `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`, before its merge to master. GitHub's non-prerelease `releases/latest` endpoint returned 404; no stable product release was established by this check.

The writer's format number is **4**, independently of the product version. The [official status record](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/docs/session-format-status.md) identifies `dsh-v0.2.0-rc.2` as publication evidence for V4.

| Format | Read behavior |
| --- | --- |
| V0–V1 | Expand top-level packed text, reasoning and tool-call rows; retain each row's original raw JSON and logical event sequence. |
| V2 | Read compact timed streams inside `assistant/message` and diagnostic `assistant/attempt`; retain settlement-event sequence positions. |
| V3 | Obtain system prompts from `system/message`; fold append/replace/clear, and retain `series` and `startsSeries` request metadata. |
| V4 | Read direct tool-role results, `toolCallId`, and `isError` independently of structured error identity; retain developer messages and subagent catalogs. |

The parser validates framing, dense event sequence positions, references and compact-stream records. It retains opaque ignorable payloads and unknown object-valued events for inspection. It is not the upstream full schema, lifecycle or plugin validator. An unsupported future version fails explicitly.

## Files and directories

- Single JSONL and concatenated-frame JSONL.ZSTD are supported.
- Directories and ZIPs accept `session.jsonl`, `session.vN.jsonl`, and compressed equivalents, plus `subagents/<id>/` logs, `media/` images and `files/` attachments. A selected folder's leading directory and Windows separators are normalized.
- Each session uses its numerically highest generation; an unsupported or damaged higher generation fails instead of silently falling back. Plaintext wins when the same generation also has a compressed copy. A canonical filename must agree with its header generation.
- Ordinary seeded forks retain their recorded source metadata without being labeled subagents. Explicit subagent origin and recorded catalogs establish child relationships; cycles and duplicate entries fail explicitly.
- Native parallel tool results match calls by id and remain in call order. Call and result keep separate raw links; pending, empty, error and orphan outcomes remain distinguishable. Nested PTC dispatches keep parent identities and actual output, and appear as separate PTC entries. The summary's tool-call/result counts count native lifecycle events, not their nested PTC dispatches again.
- Images remain local. Generic file attachments can be downloaded from the local attachment panel; arbitrary attachments are not executed or rendered as HTML.

## Reproducible verification

```sh
pnpm install --frozen-lockfile
pnpm check
git diff --check
```

Five pinned public upstream fixtures and synthetic schema-based cases run in the normal suite. To also check every public session snapshot in an upstream checkout:

```sh
DSH_SOURCE_DIR=/path/to/deepseek-harness pnpm exec vitest run tests/upstream-corpus.spec.ts
```

At the baseline above this checks **649 snapshots and 17,255 logical events across V0–V4**. Official golden snapshots omit event `seq`/`time` and packed-row anchors. Only the test adapter restores these coordinates; the production parser rejects missing coordinates. Snapshot payloads and their retained references are left unchanged. This checks payload reading and projection, not the original wall-clock timing or a live agent run.

Local verification used Linux, Node 24.19.0 and Chromium at 1440×1000: V0–V4 single-file imports, four workspace views, ZIP and browser directory imports with a child session, and attachment downloads. The smoke observed no console errors or requests outside the loopback server. The CLI tests cover real HTTP GET/HEAD, nested JS/Worker/CSS MIME types, SPA routes, missing assets, malformed paths, symlink escapes on POSIX, and POSIX/Windows drive-root/UNC path rules. GitHub CI runs `pnpm check` on Ubuntu, Windows and macOS; inspect the PR checks for native-platform results.

No DeepSeek API call is needed for these checks. Real model calls, native browser file-dialog interaction, upstream migration execution and arbitrary third-party plugin semantics are outside this verification. User-provided private logs must remain outside the repository; do not commit their contents or quote them in public issue replies.

## Debugger semantics

The current navigation milestone reads extensible message sources and recorded turn-end reasons from the pinned source. Human input is not replaced by subsequent runtime/agent notices; unknown sources and reasons keep their literal kind. `assistant/attempt` is diagnostic evidence, outside the settled conversation. The error metric counts physical error-bearing events, not unique incidents or failed turns; an error result, propagated agent error and turn failure can each count. Full-event search scans the Worker records independently of previews and follows source IDs into the matching session/page. See [Debugger navigation](debugger-navigation.md).

Four additional private samples were requested for this milestone. All four remain **unread and untested**: the object-storage host is absent from this cloud task’s enforced outbound allowlist, and its first request failed with proxy `CONNECT 403`. No bypass or public copy was made. Public source fixtures and synthetic tests do not replace that missing real-sample coverage.
