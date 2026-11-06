# Loading and large-session measurements

Imports show reading, extraction, parsing, projection and view preparation states. Cancel or Escape terminates the candidate Worker; a replacement keeps the previous Worker and view until the new import succeeds. Duplicate imports are rejected, failed imports remain retryable, and selecting the same file again works. Focus stays on Cancel during loading and returns afterwards; the background is inert and reduced-motion preferences disable the spinner rotation.

The expensive unzip, parse and projection work already ran in a Worker. The main regression was after settlement: transferring complete projections, automatically copying the entire conversation, and rendering every hidden step, tool result and JSON tree on the main thread. Loading animation alone would not fix that work.

This change sends `File` objects to the Worker, transfers an execution window of at most 40 entries, requests conversation windows only when opened, and mounts closed detail bodies only when expanded. Conversation windows are bounded to 100 records or 256 Ki characters, except for an individual oversized record. Execution and timeline controls page through the recorded steps; the overview remains the full-session summary. Full raw events remain inspectable in the Worker. UTF-8 import reads one storage line at a time and decodes its original raw bytes only when requested, avoiding a retained second whole-log text copy.

## Browser comparison

Measured on the same cloud Linux host, Node 24.19.0, system headless Chromium, 1440×1000, production builds. Baseline is commit `8eb215b`; the candidate contains this change. The same input bytes were reused in three alternating baseline/candidate runs. These are synthetic, minimal V4 records, not private user sessions or a live Harness run.

- ZIP: **6,478,854 bytes**; JSONL: **9,125,714 bytes**.
- **5,300 events, 100 turns, 1,000 steps**, including sizeable structured tool outputs.
- ZIP SHA-256: `45b1dc685c3734b1073121ee1654fd262b83d483939e6be7bb89fdb29d79e2f8`. The generator below fixes ZIP timestamps for repeatable future runs; this measured ZIP used its original generation timestamp.

Medians of three runs:

| Measurement | Baseline | Candidate |
| --- | ---: | ---: |
| File change to initial usable view | 2,741 ms | 755 ms |
| Worker ready message to committed view | 2,283 ms | 74 ms |
| Worker send to main-thread receive | 72 ms | 6 ms |
| Largest animation-frame gap per run | 2,367 ms | 83 ms |
| DOM nodes after import | 153,247 | 144 |
| Main-page JS heap after settlement | 156 MiB | 4.3 MiB |

The send/receive measurement includes structured cloning and scheduling. Browser heap observations cover the main page, not a process-wide or Worker memory peak. Results vary with CPU scheduling: the baseline's initial-view times ranged from 2.04–6.71 seconds; candidate times ranged from 0.72–0.84 seconds. Candidate runs still had frame gaps up to approximately 100 ms, so these results do not establish uninterrupted 60 fps.

## Import phases and memory

The isolated Node harness separates reading, extraction, decoding/parsing and projection. For the 9.13 MB JSONL in the ZIP, medians were approximately:

| Phase | Baseline | Candidate |
| --- | ---: | ---: |
| ZIP extraction | 158 ms | 144 ms |
| UTF-8 decoding and parsing | 43 ms | 61 ms |
| Projection | 25 ms | 21 ms |

Extraction and projection algorithms were not changed; their differences include normal runtime variation. Per-line decoding and lazy raw inspection are a memory tradeoff, not a demonstrated parsing CPU speedup. The main proven latency benefit is avoiding large transfers and eager rendering.

A larger **91,431,388-byte JSONL** contains **53,000 events, 1,000 turns and 10,000 steps**, with a **64,785,508-byte ZIP**. In three alternating isolated Node runs, median process peak RSS fell from approximately **490 MiB to 416 MiB**. The Node process includes input, parsed records and projections; this is supporting evidence, not a measured browser Worker peak. Large-file decoding/parsing times were noisy (baseline 0.49–2.10 seconds; candidate 0.48–1.17 seconds), so no consistent parser-throughput improvement is claimed.

Candidate browser stress checks for this larger input completed in 5.42 seconds for JSONL and 4.92 seconds for ZIP, with 144 initial DOM nodes and approximately 4.4 MiB settled main-page heap. Maximum frame gaps were about 133 ms; p95 heartbeat gaps were 25 ms and 18 ms respectively. These two stress runs have no corresponding large-input baseline browser run.

Real browser interaction checks also passed: spinner transform changed while reading a large ZIP; a repeated drop created no second Worker; Cancel dismissed the pending import in about 7 ms; cancel and a malformed replacement preserved the previous session; a subsequent 53,000-event JSONL load and both page controls worked; reduced motion disabled rotation. No page errors were observed. These checks used synthetic input only.

## Reproduce

Use Node 24+ and installed project dependencies. The data generator writes no private content:

```sh
node benchmarks/import.mjs generate /tmp/dsh-small 100
node benchmarks/import.mjs generate /tmp/dsh-long 1000
node benchmarks/import.mjs phases /path/to/baseline /tmp/dsh-long/session.v4.jsonl
node benchmarks/import.mjs phases /path/to/candidate /tmp/dsh-long/session.v4.jsonl
```

For production browser measurements, install Playwright separately if needed, build each checkout, then run alternating baselines/candidates against the same fixture. Set `CHROMIUM_PATH` when the system browser is elsewhere:

```sh
node benchmarks/browser-import.mjs /tmp/dsh-small/session.zip /path/to/baseline/dist /path/to/playwright/index.mjs /tmp/before.json
node benchmarks/browser-import.mjs /tmp/dsh-small/session.zip /path/to/candidate/dist /path/to/playwright/index.mjs /tmp/after.json
```

## Limits

The Worker still retains source bytes, parsed events and full projections; memory remains proportional to the session. ZIP extraction is still synchronous inside the candidate Worker, so cancelling terminates that Worker rather than interrupting the unzip function. During replacement, old and candidate Workers temporarily coexist to preserve rollback. An individual enormous JSONL record, expanded JSON tree or attachment can still be expensive; paging does not cap an individual record. Raw-event sequence positions and contents are preserved. No private user ZIP was available in this cloud workspace for these measurements.
