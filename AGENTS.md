# AGENTS.md

## Commands

```sh
pnpm install --frozen-lockfile
pnpm check
```

## npm releases

- Publish `@eriklee1895/dsh-session-log-explorer` only through `.github/workflows/publish.yml`. The workflow accepts `v*` tags, runs `pnpm check`, and uses npm Trusted Publishing through GitHub OIDC.
- Do not add `NPM_TOKEN`, registry credentials, or a bypass-2FA token to GitHub secrets, workflow variables, repository files, or logs. The release workflow needs only `contents: read` and `id-token: write`.
- Before creating a release tag, update `package.json` to the intended unused semantic version, run `pnpm check`, run `npm pack --dry-run`, and review the tarball file list for source logs, local worktrees, credentials, and other unintended files.
- Use an annotated tag named `v<package.json version>`, then push that tag. For example: `git tag -a v0.1.1 -m 'v0.1.1' && git push origin v0.1.1`.
- npm versions are immutable. Do not move or reuse a release tag after a package version has been published. Bump the version and publish a new tag for corrections.
- This development host defaults to an internal npm registry. Release validation and any exceptional manual npm operation must explicitly use `--registry=https://registry.npmjs.org`.
- Manual publishing is exceptional and requires explicit user authorization plus npm account confirmation. Prefer the tag workflow so npm can generate provenance from the public GitHub repository.
