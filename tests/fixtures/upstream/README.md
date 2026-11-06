# Public upstream fixtures

These MIT-licensed payloads come from deepseek-ai/deepseek-harness at `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159` (copyright (c) 2026 DeepSeek):

| Local fixture | Upstream path |
| --- | --- |
| `v0.jsonl` | `snapshots/session/text-turn/session.jsonl` |
| `v1.jsonl` | `snapshots/session/text-turn/session.v1.jsonl` |
| `v2.jsonl` | `snapshots/acp/cancel/session.v2.jsonl` |
| `v3.jsonl` | `snapshots/acp/cancel/session.v3.jsonl` |
| `v4.jsonl` | `snapshots/acp/cancel/session.v4.jsonl` |

Upstream snapshots omit envelope coordinates. These test files restore dense `seq`/`seq0` and synthetic `time`/`time0 = header.createdAt + seq`; packed runs advance the sequence by their member count. Recorded payloads and references remain intact. The fixtures do not represent original wall-clock timing, and production parsing does not synthesize missing coordinates. See `tests/upstream-corpus.spec.ts` for the same adaptation over a complete explicitly selected upstream checkout.

No private user logs are included. The upstream MIT license is retained in `LICENSE.deepseek`.
