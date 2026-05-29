# Slack Labels

OpenClaw plugin that labels persisted Slack user messages with sender identity before they become future model history.

## Behavior

For each Slack user message that reaches the OpenClaw agent path, the plugin prepends a compact sender label to the persisted user transcript message:

```text
From: Alice (U123)
please review this thread
```

The plugin is Slack-only and respects OpenClaw's existing Slack inbound filtering, including `allowBots`.

Slack DMs, channels, groups, and threads are all eligible. Non-Slack messages are left unchanged.

The plugin uses OpenClaw's resolved Slack sender metadata:

- display name / resolved sender name for the visible name
- Slack user or bot id for the id in parentheses

## Correlation

OpenClaw currently exposes `sessionKey` to the synchronous `before_message_write` hook, so v1 uses a short-lived pending label queue per session.

The queue is conservative:

- a pending label is consumed after one user message write
- expired labels are ignored
- if more than one label is pending for the same session, the plugin fails closed and does not label that write

That avoids stale or ambiguous attribution when the current SDK cannot prove a stronger per-message match.

## Development

```bash
npm install
npm run preflight
```

`preflight` runs build, typecheck, focused tests, static plugin inspection, runtime plugin inspection, and package dry-run.
