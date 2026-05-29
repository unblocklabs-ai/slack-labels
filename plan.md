# slack-labels implementation goal

## /goal

/goal Build the initial `slack-labels` OpenClaw plugin so Slack user messages persisted into agent session history are labeled with sender identity, verified by focused plugin tests plus build/typecheck/inspector checks, while preserving OpenClaw's existing Slack inbound filtering, non-Slack behavior, and transcript persistence semantics. Use only this plugin repo, the local `/Users/bek/Desktop/openclaw` checkout as reference/runtime source, and the established OpenClaw plugin SDK and inspector patterns. Between iterations, inspect the failing evidence, make the smallest defensible change, and rerun the narrowest check that proves or disproves the change before broadening validation. If the plugin cannot be implemented without OpenClaw core changes, or if the required hook correlation is not defensible under current SDK behavior, stop with the attempted paths, source evidence, blocker, and the exact OpenClaw change or missing API that would unlock progress.

## Outcome

Create a Slack-only OpenClaw plugin in this repo that prepends a compact plain-text sender label to persisted Slack user-turn transcript messages before those messages become future model history.

Target persisted message shape:

```text
From: Alice (U123)
<original message>
```

All Slack chat surfaces should be eligible: direct DMs, channels, groups, and threads. Non-Slack channels must remain unchanged.

## Verification Surface

The work is complete when these are true:

- The plugin has a normal OpenClaw plugin package shape: `package.json`, `openclaw.plugin.json`, source files, tests, and inspector config.
- Focused tests prove:
  - Slack group/channel user messages get labeled.
  - Slack DM user messages get labeled.
  - Non-Slack user messages are unchanged.
  - Already-labeled user messages are unchanged.
  - Missing sender metadata does not produce a misleading label.
  - Bot-originated Slack messages are labeled if they reach the hook path.
  - Cache expiry avoids stale labels.
- Build/typecheck passes for the plugin.
- OpenClaw plugin inspector passes at least static compatibility checks; run runtime inspection too if the plugin scaffold supports it without credentials.
- The final report names the commands run, the evidence they produced, and any checks not run.

## Constraints

- Do not modify `/Users/bek/Desktop/openclaw` unless explicitly asked. It is reference material for this goal.
- Do not add plugin-specific bot filtering. Respect OpenClaw's Slack inbound behavior: if `allowBots` lets a bot message reach the agent path, label it; if OpenClaw filters it out, there is nothing for this plugin to label.
- Do not call Slack or perform async work from `before_message_write`; that hook is synchronous.
- Keep the label compact and prompt-visible as ordinary text. Use the fixed v1 format `From: Alice (U123)`.
- Make the rewrite idempotent so retries, fallback persistence, or repeated hook invocation cannot double-label a message.
- Preserve user message metadata such as media fields, provenance, timestamps, and idempotency keys.
- Keep scope narrow. Do not implement general message attribution, prompt-hook context injection, config UI, or OpenClaw core changes unless the plugin route is proven impossible.

## Boundaries

Allowed inputs and references:

- This plugin repo: `/Users/bek/Desktop/openclaw-plugins/slack-labels`.
- Local OpenClaw reference checkout: `/Users/bek/Desktop/openclaw`.
- Existing owned plugin examples under `/Users/bek/Desktop/openclaw-plugins`, especially `keep-going` if a package/inspector pattern is needed.
- OpenClaw plugin docs and SDK docs, preferably local docs in `/Users/bek/Desktop/openclaw/docs/plugins` unless current online docs are explicitly needed.

Expected implementation seam:

- Register `message_received` to synchronously capture Slack sender metadata for the inbound turn.
- Register `before_message_write` to synchronously rewrite the matching persisted `role: "user"` message.
- Use an in-memory bounded cache. Prefer correlation by `runId`, then `messageId`, then `sessionKey`. Because `before_message_write` currently exposes only `message`, `agentId`, and `sessionKey`, the session-key fallback is expected in v1.

Do not use:

- Network calls in tests unless explicitly needed and approved.
- Slack credentials or live Slack workspace state.
- Broad OpenClaw test suites unless focused plugin checks pass and broader validation is warranted.

## Source Evidence

Initial scoping against `/Users/bek/Desktop/openclaw` found:

- Slack resolves sender name/id in `extensions/slack/src/monitor/message-handler/prepare.ts`.
- Slack user-name lookup in `extensions/slack/src/monitor/context.ts` prefers display name, then real name, then Slack username.
- `buildChannelInboundEventContext(...)` maps those values to `SenderName` and `SenderId`.
- `message_received` receives sender metadata plus session/message correlation fields.
- `before_message_write` can return a replacement `AgentMessage`.
- User-turn transcript persistence calls `before_message_write` before appending the session transcript.

Why this is a plugin, not a prompt hook:

- `before_prompt_build` and `agent_turn_prepare` can add current-turn context, but they do not rewrite historical session messages.
- `before_agent_run` sees final prompt/history, but it can only pass or block.
- Rewriting the persisted user message makes identity durable across later inference turns.

## Decisions

- Label all Slack messages that reach the agent path, including direct DMs.
- Use OpenClaw's resolved `senderName` and Slack `senderId`.
- Use a plain-text label: `From: Alice (U123)`.
- Separate the label from the original message with one newline unless implementation evidence shows two newlines is materially clearer.
- Keep label format fixed for v1; no config surface unless implementation discovers a real need.
- For non-string/multipart message content, preserve all metadata and label text content only when it can be done without damaging the message shape. If the SDK type surface makes this ambiguous, skip non-string content and document the limitation instead of guessing.
- Do not add plugin-specific bot filtering; respect OpenClaw Slack inbound filtering and `allowBots`.

## Iteration Policy

1. Start by reading the local plugin examples and the OpenClaw SDK hook types needed for `message_received` and `before_message_write`.
2. Scaffold the smallest valid plugin package.
3. Implement pure helper functions first: Slack event detection, label formatting, idempotency detection, cache insertion/lookup/expiry, and message rewriting.
4. Add focused unit tests around helpers and hook flow before relying on inspector/runtime checks.
5. After each failed check, identify whether the failure is package shape, type surface, hook semantics, cache correlation, or test fixture mismatch. Fix only that class of issue, then rerun the narrowest relevant check.
6. Once focused checks pass, run build/typecheck and plugin inspector.

## Blocked Stop Condition

Stop and report instead of forcing a weak implementation if any of these are true:

- The SDK does not expose `message_received` or `before_message_write` to external plugins in a usable way.
- `before_message_write` cannot reliably identify the current Slack turn even with session-key fallback.
- OpenClaw drops the necessary sender metadata before plugin hooks can observe it.
- Passing validation would require modifying OpenClaw core, installing credentials, or using live Slack state.
- Tests can only pass by asserting implementation details that do not prove persisted transcript labeling.

The blocked report must include:

- What was attempted.
- The exact local source evidence or command output that blocked progress.
- Whether the blocker is plugin-package, SDK, hook-correlation, validation, or runtime behavior.
- The smallest OpenClaw change, SDK addition, fixture, credential, or user decision that would unlock progress.

## Final Deliverable

End with:

- Files changed.
- The implemented behavior.
- Commands run and pass/fail status.
- Any remaining limitations, especially around correlation fallback or non-string user message content.
