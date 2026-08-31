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

- Publish `@eriklee1895/dsh-session-log-explorer` only through `.github/workflows/publish.yml`. The workflow accepts `v*` tags, runs `pnpm check`, and uses npm Trusted Publishing through GitHub OIDC.
- Do not add `NPM_TOKEN`, registry credentials, or a bypass-2FA token to GitHub secrets, workflow variables, repository files, or logs. The release workflow needs only `contents: read` and `id-token: write`.
- Before creating a release tag, update `package.json` to the intended unused semantic version, run `pnpm check`, run `npm pack --dry-run`, and review the tarball file list for source logs, local worktrees, credentials, and other unintended files.
- Use an annotated tag named `v<package.json version>`, then push that tag. For example: `git tag -a v0.1.1 -m 'v0.1.1' && git push origin v0.1.1`.
- npm versions are immutable. Do not move or reuse a release tag after a package version has been published. Bump the version and publish a new tag for corrections.
- This development host defaults to an internal npm registry. Release validation and any exceptional manual npm operation must explicitly use `--registry=https://registry.npmjs.org`.
- Manual publishing is exceptional and requires explicit user authorization plus npm account confirmation. Prefer the tag workflow so npm can generate provenance from the public GitHub repository.
