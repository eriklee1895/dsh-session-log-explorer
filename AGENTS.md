# AGENTS.md

## Project purpose

This is an offline, browser-based learning and debugging tool for exported DeepSeek Harness session logs. It reconstructs recorded turns, steps, events, tool calls, responses, and timing without connecting to a running Agent.

- Keep the raw record inspectable. Projections may group or summarize events, but must not invent a global causal order across independent subagent logs.
- Session logs can contain prompts, paths, command arguments, tool output, and media. Preserve the local-only model: parsing happens in a browser Worker; do not add uploads, analytics, server persistence, or cloud synchronization unless the user explicitly asks for it.
- The product deliberately does not restore a session after page refresh. Do not introduce browser storage as an incidental convenience feature.

## Repository layout

- `src/worker/` owns import, archive decoding, parser, and session-store logic. Keep parsing failures explicit and preserve enough raw data for the inspector.
- `src/model/projection.ts` turns physical records into logical views. Update the related projection or parser tests when its semantics change.
- `src/ui/` owns the execution view, trajectory, and structured JSON inspector. Preserve responsive layout and developer-oriented inspection behavior.
- `tests/` contains Vitest coverage for import, parser, projection, workspace, structured JSON, and trajectory behavior.
- `docs/screenshots/` contains README images. Update screenshots only when the documented product view materially changes.

## Development and verification

```sh
pnpm install --frozen-lockfile
pnpm check
```

- Use strict TypeScript. Add or update a focused Vitest test for parser, projection, UI, or CLI behavior changes before changing production code.
- Run `pnpm check` and `git diff --check` before committing. For user-visible UI changes, verify the built app in a browser at a representative desktop width and check for console errors.
- Keep `README.md` and `README.zh.md` aligned when changing public setup, supported formats, privacy, or product behavior.
- Preserve unrelated local changes. Never reset, discard, stage, or commit files outside the requested scope.

## npm releases

- Publish `@eriklee1895/dsh-session-log-explorer` only through `.github/workflows/publish.yml`. Review and explicitly bump `package.json` to a new canonical stable `X.Y.Z` in the release PR. Merging it to main is the release authorization: the main push checks that exact commit with `pnpm check` on Windows, macOS and Linux, then publishes the unused version to npm `latest`. `ci.yml` checks PRs; main checks live in `publish.yml` so `needs: check` gates the publisher on the complete matrix.
- The main push compares the version with the push event's `before` commit, including multi-commit pushes. Unchanged versions (including documentation-only pushes), prereleases and versions with build metadata skip publishing. A lower version fails. Do not bump a version merely to test release infrastructure.
- Preserve the direct `push` entrypoint, exact filename `publish.yml`, GitHub-hosted publish runner, and existing absence of an `environment`. npm Trusted Publishing validates the configured owner/repository, workflow filename and optional environment; reusable workflows can validate the calling workflow instead. Do not rename/move the publisher, introduce `workflow_call`, add an environment, or edit persistent npm/GitHub access settings without explicit authorization. See [npm's constraints](https://docs.npmjs.com/trusted-publishers/).
- Do not add `NPM_TOKEN`, registry credentials, or a bypass-2FA token to GitHub secrets, workflow variables, repository files, or logs. Only the publish job gets `id-token: write`; all jobs have `contents: read`. Use Node 24 and the pinned OIDC-capable npm CLI (npm >=11.5.1 requires Node >=22.14). Publishing uses `--provenance --access public --tag latest` with the existing OIDC trust; no dist-tag management permission is needed or added.
- Publish jobs share one concurrency group with cancellation disabled and a bounded queue. Within that lock, require the checked commit to remain on main, require main to still target this version, and re-read npm immediately before upload. A newer stable version in npm or a newer version on main makes an old job skip. A later documentation commit with the same version does not invalidate the checked release commit. Existing immutable versions always skip without moving `latest`.
- Network reads retry at most three times with timeouts. npm lookup failures (including 404), malformed metadata and unavailable main history fail closed. The package already exists; a failed lookup is never evidence of an unused version. Force-pushes do not release.
- Build and pack once in the publisher, with the tarball outside the checkout and pack/publish lifecycle scripts disabled. Validate the actual pack manifest's identity, SHA-512, explicit file allowlist, CLI modules, docs, HTML, favicon, JS, CSS and Worker. Publish that exact tarball. Release helpers live under `.github/scripts/`, outside the package's `scripts/` allowlist. Update `tests/release.spec.ts` and the allowlist deliberately when changing runtime assets; never widen it to include logs, credentials, worktrees or repository metadata.
- For a transient read/build/check failure, re-run the original workflow after diagnosing it; the original `before`/SHA and complete matrix gate remain in effect. `npm publish` is attempted once with npm's internal upload retries disabled (`--fetch-retries=0`). If it errors, read npm to reconcile the exact packed integrity, retaining the original npm diagnostic. If the outcome remains unconfirmed, inspect the run and registry first; do not blindly retry an upload. A later rerun skips a version already present and never repairs tags implicitly.
- A matching annotated `v<package.json version>` tag remains an explicit recovery fallback for a stable version on main. It runs the same full matrix and guards, without creating tags from `GITHUB_TOKEN` or relying on such tags to trigger another workflow. Mismatched tags fail; prerelease/build-metadata tags skip and never publish to `latest`. There is no automatic prerelease channel. Never move or reuse a published release tag; corrections require a new version PR.
- Before merging a version-bump PR, run `pnpm check`, `npm pack --dry-run --registry=https://registry.npmjs.org`, and inspect the file list. The automated allowlist complements human review. See the aligned [README release instructions](README.md#npm-releases).
- This development host defaults to an internal npm registry. Release validation and any exceptional manual npm operation must explicitly use `--registry=https://registry.npmjs.org`.
- Manual publishing is exceptional and requires explicit user authorization plus npm account confirmation. The workflow does not change Trusted Publisher settings; an OIDC mismatch must be reported with the exact filename/environment/calling identity before an owner makes any necessary change. Local checks cannot prove access to npm's private Trusted Publisher configuration, and must not test it with a real publish.
