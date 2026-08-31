# DSH request context epochs

`EPOCH 01` in this Explorer is not a second conversation, turn, or system prompt. It is one versioned snapshot of the model-visible request context.

DSH calls the persisted value an `EpochHeader`. Each `request/header` event contains the complete state that is outside the message history:

- model-call configuration: provider, model, reasoning effort, and related scalars;
- rendered system prompt text, when one is present;
- assembled tool schemas, when tools are present.

The latest header is the context in force for the next model request until another header replaces it. The message history is reconstructed separately from the append-only Session log.

## Why a log can have several epochs

DSH records full snapshots rather than a chain of prompt-only diffs. A header is appended for one of three reasons:

| Reason | Meaning | Does it prove the system prompt changed? |
| --- | --- | --- |
| `initial` | The first header in a new Session log. | No comparison exists yet. |
| `resume` | A new Agent loop made its first request over a log that already has a header, such as after recovery or from a fork seed. | No. The snapshot can be identical. |
| `change` | A later request in the same live loop used a different header. | Only if the `system` field differs. |

For example:

| Epoch | System prompt | Tools | Explorer label |
| --- | --- | --- | --- |
| Epoch 01 | A | 25 | Initial request context |
| Epoch 02 | A | 25 | Session resumed · context unchanged |
| Epoch 03 | A | 26 | Tools updated · system prompt unchanged |
| Epoch 04 | B | 26 | System prompt updated |

The third row is a common source of confusion: DSH writes the same system prompt again because the whole request header is a snapshot, even though only the tool catalog changed.

## Why DSH uses this model

The exact model input is more than the visible chat transcript. A replay, recovery, or fork also needs the model route, rendered system prompt, and tool schemas that applied at that time. Full snapshots let DSH recover the latest known request context without replaying a delta chain or depending on live configuration.

Other agent systems often carry equivalent state under names such as request options, model-call configuration, checkpoints, or run snapshots. Many do not persist it alongside every durable transcript, so they do not expose a user-facing term like `EpochHeader`. `Epoch` is a DSH persistence and replay term, not a universal agent-harness primitive.

## How this Explorer presents it

The Explorer calls the section **Model Request Context** to avoid suggesting that each card is a new system prompt.

- **EPOCH 01** is the first full snapshot.
- An unchanged resume is compact and does not repeat the prompt body.
- A system, model, or tool change is called out precisely.
- Expanding a card shows the rendered system prompt, model configuration, and tool list. System prompt changes receive a line diff.
- A Step shows the effective context epoch and links to the raw `request/header` event.

The Explorer can show the rendered prompt string, but it cannot reliably reconstruct the original plugin sections that produced it. Treat these records as sensitive: they can contain repository instructions, paths, tool descriptions, and deployment-specific guidance.

## Source basis

This explanation follows DSH's [`EpochHeader`](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/session/src/types.ts), request-header folding utilities, and the Agent loop that appends `initial`, `resume`, or `change` header snapshots. It describes the exported session format supported by this Explorer, not a compatibility promise for future DSH versions.
