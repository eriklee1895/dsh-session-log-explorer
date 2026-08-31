# DSH Session Log Explorer

[中文](README.zh.md)

An offline, browser-based explorer for exported [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) session logs. It turns JSONL artifacts into a readable execution narrative, an inspectable event stream, and a time-aware agent trajectory without sending session content to a server.

> This is an independent, unofficial project. It is not affiliated with, endorsed by, or supported by DeepSeek.

## Quick start

Run the offline explorer without cloning the repository:

```sh
npx @eriklee1895/dsh-session-log-explorer
```

The command serves the included static files on `127.0.0.1` and opens the browser. Use `--no-open` for a headless terminal or `--port 4179` to pick a local port. If your npm default points to another registry, add `--registry=https://registry.npmjs.org` before the package name.

![Trajectory view: decisions, active work, waits, and tool calls](docs/screenshots/trajectory.png)

## What it helps you learn

- Reconstruct turns and steps from recorded agent decisions instead of reading raw chunk events.
- Follow tool calls, reasoning, assistant responses, errors, and the matching raw event in one workspace.
- Compare execution order, active recorded work, and wall-clock time with waits preserved.
- Inspect event data as a collapsible JSON tree or copy the original JSON record.
- Open exported session directories, JSONL, Zstandard-compressed JSONL, and DSH ZIP archives locally.

## Screenshots

### Import locally

![Import a DSH session log from a file or directory](docs/screenshots/import.png)

### Review the session at a glance

![Overview of turns, steps, tool calls, duration, and tokens](docs/screenshots/overview.png)

### Read the execution narrative

![Expanded execution step with reasoning, tools, and assistant response](docs/screenshots/execution.png)

### Study the agent trajectory

![Timeline with sequence, active time, and wall-clock views](docs/screenshots/trajectory.png)

## Privacy

Files are parsed in a browser Worker and remain in the current browser tab. The application has no server endpoint, cloud synchronization, analytics, session editing, or persistence after a page refresh.

## Supported inputs

- `session.jsonl`
- `session.jsonl.zstd`
- A session directory, including `subagents/` and `media/`
- DSH session export ZIP archives

The parser supports session format version `0` and expands packed text, reasoning, and tool-call chunk rows into logical events.

## Develop locally

Requires Node.js 20+ and pnpm.

```sh
pnpm install
pnpm dev
```

Open the local URL printed by Vite. For a production build and tests:

```sh
pnpm build
pnpm test
```

## Scope

The explorer is a local learning and debugging tool for exported logs. It does not connect to a running DSH Agent, mutate a session, provide a live tail, or merge independent subagent logs into a fabricated global causal sequence.

## License and notices

The project code is released under the [MIT License](LICENSE). See [NOTICE.md](NOTICE.md) for the DeepSeek Harness favicon attribution and the independent-project notice.
