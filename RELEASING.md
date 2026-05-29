# Releasing

Publishing is intentionally tied to a published GitHub Release. Pushing commits, opening pull requests, and pushing raw tags do not publish this package.

## One-time setup

1. To publish to npm from the release workflow, create a granular npm automation token with publish access to `@unblocklabs/slack-labels` and add it as the GitHub repository secret `NPM_TOKEN`.

2. If `NPM_TOKEN` is not configured, the workflow skips npm publishing after ClawHub publishing succeeds.

3. Create or confirm the ClawHub publisher owner `@unblocklabs`.

4. Give the ClawHub account used by CI publisher access to `@unblocklabs`.

5. Create a ClawHub token for that account and add it as the GitHub repository secret `CLAWHUB_TOKEN`.

## Release checklist

1. Update `package.json` and `openclaw.plugin.json` to the same `X.Y.Z` version.

2. Run the local checks:

   ```bash
   npm ci
   npm run preflight
   npm pack --dry-run
   ```

3. Create and publish a GitHub Release for tag `vX.Y.Z`.

The release workflow checks that the tag, `package.json`, and `openclaw.plugin.json` versions match before publishing. It also checks that the npm version does not already exist, runs `npm run preflight`, packs the npm artifact, uploads that artifact to ClawHub, then publishes the same artifact to npm only when `NPM_TOKEN` is configured.

ClawHub may keep new releases hidden from public install surfaces while automated security review runs. The workflow reports moderation status when public inspection is not available immediately.
