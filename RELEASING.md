# Releasing

Publishing is intentionally tied to a published GitHub Release. Pushing commits, opening pull requests, and pushing raw tags do not publish this package.

## Release checklist

1. Run the local checks:

   ```bash
   npm ci
   npm run preflight
   npm pack --dry-run
   ```

2. Update the release metadata, commit it, and create the release tag:

   ```bash
   npm run release:prepare -- X.Y.Z
   ```

3. Push the release branch you created and the tag:

   ```bash
   git push --set-upstream origin HEAD --follow-tags
   ```

4. Create and publish a GitHub Release for tag `vX.Y.Z`.

The release workflow checks that the tag, `package.json`, and `openclaw.plugin.json` versions match before publishing. It also checks that the npm version does not already exist, runs `npm run preflight`, packs the npm artifact, uploads that artifact to ClawHub, then publishes the same artifact to npm only when `NPM_TOKEN` is configured.
