# Debugger Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement the first agreed debugger milestone and UI foundation as reviewable commits.

**Architecture:** Extend factual projections and Worker references, then consume bounded search/inspection responses in React. Keep full logs in the Worker and preserve their original event identities.

**Tech Stack:** Existing TypeScript, React 18, Vitest, Vite and browser Worker; no new product dependencies.

**Spec:** `docs/superpowers/specs/2026-11-07-debugger-foundations-design.md`

## Global Constraints

- Preserve V0–V4 and original raw sequence IDs.
- Do not merge, bump the package version or publish.
- No uploads, telemetry, browser storage or execution of recorded commands.
- Four private samples stay outside the checkout and public evidence.
- Preserve bounded execution/conversation transfers and accessible cancellation.

## Review Focus

- Injected and unknown-source user-role messages preserve human prompt identity.
- Parallel/reversed/pending/orphan tool results retain distinct raw links.
- Errors with no entered step are navigable; unclosed turns remain unrecorded.
- Long/Unicode/off-page/child-session matches survive preview and result pagination.
- Stale Worker replies, replacement and theme changes do not corrupt selection or disclose data.

## Task 1: Factual projection and inspection metadata

Files: `src/model/projection.ts`, `src/model/event-facts.ts`, `src/worker/session-store.ts`, `src/worker/protocol.ts`, `src/worker/session.worker.ts`, related model/store tests.

Interfaces: message source facts, optional turn outcome/diagnostics, `ExecutionTool` call/result IDs; store exposes linked tool inspection for either endpoint.

- [x] Write and run failing tests for source preservation, outcomes, diagnostic attempts, error navigation and tool links.
- [x] Implement minimal source/outcome metadata and preserve paired call/result event IDs.
- [x] Pass targeted tests and public upstream corpus; commit factual model changes.

## Task 2: Full-session search and navigation

Files: new `src/worker/search.ts`, Worker/store/protocol, `src/useSessionLoader.ts`, new `src/ui/SessionSearch.tsx`, search/loading tests.

Interfaces: typed request ID, literal query/scope/tool/source/error filters; bounded result pages with session/event IDs and snippets. Navigation selects the matching session/event independently of execution page.

- [x] Write failing tests for text after character 190 and outside the first 40 execution entries, scope, filters, Unicode, pagination and stale responses.
- [x] Implement value traversal with no retained serialized-log index and at most 50 result records per reply.
- [x] Wire accessible search controls, explicit counts and source navigation; pass targeted tests.

## Task 3: Workbench UI and evidence links

Files: `src/App.tsx`, extracted inspector component, `src/ui/ExplorerWorkspace.tsx`, trajectory adapter, theme/style files and UI tests.

Interfaces: linked tool metadata and raw-event callbacks, outcome/source badges, error-search callback, in-memory light/dark appearance.

- [x] Add focused tests for linked input/output/raw navigation, pending results, error actions and theme controls.
- [x] Refine header/tree/toolbar/details hierarchy, source/outcome display, error/diagnostic timeline groups and both themes.
- [x] Keep local timeline filtering labeled as a page-preview filter; full search is separate and explicit.
- [x] Verify at 1440px and narrow widths in a real browser, including keyboard/reduced-motion behavior.

## Task 4: Validation and review handoff

- [x] Check every available private sample locally; record only aggregate results or the precise access blocker.
- [x] Run `DSH_SOURCE_DIR=/workspace/deepseek-harness pnpm check`, `git diff --check`, browser smoke and large synthetic responsiveness checks.
- [x] Align README translations and source/compatibility evidence; capture screenshots using synthetic content only.
- [x] Push separate model/navigation and UI commits in a draft PR; inspect exact-HEAD three-platform CI.
- [x] Report completed milestone, remaining roadmap, risks and private-sample coverage accurately.
