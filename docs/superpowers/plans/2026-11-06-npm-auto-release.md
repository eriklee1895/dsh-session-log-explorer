# Automatic stable npm releases

The approved scope is a separate draft PR: an explicit stable version bump merged
to main may publish after Windows, macOS and Linux validate that exact commit.
This infrastructure change keeps package.json at 0.1.2 and does not publish.

## Design and choices

- Keep publish.yml as the directly triggered OIDC publisher, without an
  environment or workflow_call. Add main pushes alongside the existing v* tag
  fallback. Put the three-platform matrix in this workflow and gate publishing
  with needs; ci.yml continues checking PRs. This avoids cross-run SHA lookups,
  GITHUB_TOKEN-created tag triggers and changes to the trusted calling identity.
- Require a canonical stable X.Y.Z version increase over the push's before
  commit. Unchanged versions skip before querying npm. Stable tags must match
  package.json and point to a commit on main; prereleases/build metadata skip.
- Serialize publish jobs without canceling a publish. Check current main's
  version and uncached npm metadata immediately before upload. Existing versions
  skip without retagging; older versions cannot replace a newer latest.
- Retry bounded read operations, fail closed on network/metadata errors. Attempt
  npm publish once; on failure reconcile package integrity by reading npm. Never
  blindly repeat a mutation with an uncertain outcome.
- Build, pack once outside the checkout, validate an explicit file allowlist and
  required runtime assets, then upload that exact tarball with provenance/latest.
  Do not add tokens or modify npm/GitHub access configuration.

## Implementation and verification

1. Add focused Vitest tests for release intent, registry failures/retries,
   monotonic latest, immutable versions, pack validation and uncertain upload
   outcomes; observe failures before implementing the release helper.
2. Implement .github/scripts/release.mjs and wire the matrix/publish workflow.
3. Update AGENTS.md and both README release sections, including safe reruns and
   the exact OIDC identity and configuration limits.
4. Run pnpm check, git diff --check, workflow validation and a real local npm
   pack/validation smoke with no publish. Review the final diff, commit on the
   independent branch and create a draft PR; leave PR #4 unchanged.

## References

- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/): exact
  workflow filename, optional environment, calling-workflow validation,
  Node >=22.14/npm >=11.5.1, GitHub-hosted runners and id-token: write.
- [GitHub concurrency](https://docs.github.com/actions/using-jobs/using-concurrency):
  serialization alone does not imply commit order; guard registry latest too.
