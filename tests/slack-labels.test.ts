import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import {
  createSlackLabelsRuntime,
  formatSlackLabel,
  isSlackInboundEvent,
  prependSlackLabelToMessage,
  registerSlackLabelsPlugin,
  resolveSlackSenderLabel,
} from "../src/slack-labels.js";

const CHANNEL_SESSION = "agent:main:slack:channel:C123";

type Runtime = ReturnType<typeof createSlackLabelsRuntime>;
type MessageReceivedEvent = Parameters<Runtime["onMessageReceived"]>[0];
type MessageReceivedContext = Parameters<Runtime["onMessageReceived"]>[1];

function createTimedRuntime(startNow = 1000): {
  runtime: Runtime;
  advance(ms: number): void;
} {
  let currentNow = startNow;
  return {
    runtime: createSlackLabelsRuntime({ now: () => currentNow }),
    advance(ms: number) {
      currentNow += ms;
    },
  };
}

function receiveSlackMessage(
  runtime: Runtime,
  {
    event,
    ctx,
  }: {
    event?: Partial<MessageReceivedEvent>;
    ctx?: Partial<MessageReceivedContext>;
  } = {},
): void {
  runtime.onMessageReceived(
    {
      senderId: "U123",
      sessionKey: CHANNEL_SESSION,
      metadata: {
        senderName: "Alice",
        provider: "slack",
      },
      ...event,
    },
    {
      channelId: "slack",
      ...ctx,
    },
  );
}

function writeUserMessage(
  runtime: Runtime,
  content = "hello",
  sessionKey = CHANNEL_SESSION,
) {
  return runtime.onBeforeMessageWrite(
    { message: { role: "user", content } },
    { sessionKey },
  );
}

describe("slack-labels helpers", () => {
  it("formats the fixed plain-text label", () => {
    assert.equal(formatSlackLabel({ senderName: "Alice", senderId: "U123" }), "From: Alice (U123)");
  });

  it("detects Slack from channel context or metadata", () => {
    assert.equal(isSlackInboundEvent({ metadata: {} }, { channelId: "slack" }), true);
    assert.equal(
      isSlackInboundEvent({ metadata: { originatingChannel: "Slack" } }, { channelId: "webchat" }),
      true,
    );
    assert.equal(isSlackInboundEvent({ metadata: { provider: "telegram" } }, { channelId: "telegram" }), false);
  });

  it("uses resolved senderName and senderId from hook metadata", () => {
    assert.deepEqual(
      resolveSlackSenderLabel(
        {
          senderId: "U123",
          metadata: {
            senderName: "Alice",
          },
        },
        {},
      ),
      { senderName: "Alice", senderId: "U123" },
    );
  });

  it("falls back to id as name when no sender name exists", () => {
    assert.deepEqual(resolveSlackSenderLabel({ senderId: "U123" }, {}), {
      senderName: "U123",
      senderId: "U123",
    });
  });

  it("does not create a misleading label without sender id", () => {
    assert.equal(
      resolveSlackSenderLabel({ metadata: { senderName: "Alice" } }, {}),
      undefined,
    );
  });

  it("prepends a label while preserving user message metadata", () => {
    const message = {
      role: "user",
      content: "please review",
      timestamp: 123,
      idempotencyKey: "turn-1",
      MediaPath: "/tmp/a.png",
      provenance: { source: "slack" },
    };

    assert.deepEqual(
      prependSlackLabelToMessage(message, { senderName: "Alice", senderId: "U123" }),
      {
        ...message,
        content: "From: Alice (U123)\nplease review",
      },
    );
  });

  it("does not double-label an already-labeled message", () => {
    assert.equal(
      prependSlackLabelToMessage(
        { role: "user", content: "From: Alice (U123)\nplease review" },
        { senderName: "Alice", senderId: "U123" },
      ),
      undefined,
    );
  });

  it("labels text parts in multipart user content without dropping other parts", () => {
    const imagePart = { type: "image", mediaId: "img-1" };
    assert.deepEqual(
      prependSlackLabelToMessage(
        {
          role: "user",
          content: [
            imagePart,
            { type: "text", text: "caption" },
          ],
        },
        { senderName: "Alice", senderId: "U123" },
      ),
      {
        role: "user",
        content: [
          imagePart,
          { type: "text", text: "From: Alice (U123)\ncaption" },
        ],
      },
    );
  });

  it("does not let later labeled text parts suppress the target text part", () => {
    assert.deepEqual(
      prependSlackLabelToMessage(
        {
          role: "user",
          content: [
            { type: "text", text: "caption" },
            { type: "text", text: "From: Previous (U000)\nquoted" },
          ],
        },
        { senderName: "Alice", senderId: "U123" },
      ),
      {
        role: "user",
        content: [
          { type: "text", text: "From: Alice (U123)\ncaption" },
          { type: "text", text: "From: Previous (U000)\nquoted" },
        ],
      },
    );
  });

  it("skips ambiguous non-string content rather than damaging the message shape", () => {
    assert.equal(
      prependSlackLabelToMessage(
        { role: "user", content: [{ type: "image", mediaId: "img-1" }] },
        { senderName: "Alice", senderId: "U123" },
      ),
      undefined,
    );
  });
});

describe("slack-labels hook flow", () => {
  it("labels Slack group/channel user messages", () => {
    const { runtime } = createTimedRuntime();
    receiveSlackMessage(runtime);

    assert.deepEqual(writeUserMessage(runtime), {
      message: {
        role: "user",
        content: "From: Alice (U123)\nhello",
      },
    });
  });

  it("labels Slack DM user messages", () => {
    const { runtime } = createTimedRuntime();
    receiveSlackMessage(runtime, {
      event: {
        senderId: "U456",
        sessionKey: "agent:main:slack:direct:U456",
        metadata: {
          senderName: "Bob",
          originatingChannel: "slack",
        },
      },
    });

    assert.equal(
      writeUserMessage(runtime, "dm text", "agent:main:slack:direct:U456")?.message.content,
      "From: Bob (U456)\ndm text",
    );
  });

  it("leaves non-Slack user messages unchanged", () => {
    const { runtime } = createTimedRuntime();
    receiveSlackMessage(runtime, {
      event: {
        senderId: "123",
        sessionKey: "agent:main:telegram:direct:123",
        metadata: {
          senderName: "Alice",
          provider: "telegram",
        },
      },
      ctx: { channelId: "telegram" },
    });

    assert.equal(
      writeUserMessage(runtime, "hello", "agent:main:telegram:direct:123"),
      undefined,
    );
  });

  it("does not label when sender metadata is missing", () => {
    const { runtime } = createTimedRuntime();
    receiveSlackMessage(runtime, {
      event: {
        senderId: undefined,
        metadata: {
          senderName: "Alice",
          provider: "slack",
        },
      },
    });

    assert.equal(writeUserMessage(runtime), undefined);
  });

  it("labels bot-originated Slack messages if they reach the hook path", () => {
    const { runtime } = createTimedRuntime();
    receiveSlackMessage(runtime, {
      event: {
        senderId: "B123",
        metadata: {
          senderName: "Build Bot",
          provider: "slack",
        },
      },
    });

    assert.equal(
      writeUserMessage(runtime, "deploy finished")?.message.content,
      "From: Build Bot (B123)\ndeploy finished",
    );
  });

  it("expires cached labels to avoid stale attribution", () => {
    const { runtime, advance } = createTimedRuntime();
    receiveSlackMessage(runtime);

    advance(5 * 60 * 1000 + 1);

    assert.equal(writeUserMessage(runtime, "late write"), undefined);
  });

  it("consumes a pending label after one user write", () => {
    const { runtime } = createTimedRuntime();
    receiveSlackMessage(runtime);

    assert.equal(writeUserMessage(runtime, "first")?.message.content, "From: Alice (U123)\nfirst");
    assert.equal(writeUserMessage(runtime, "second"), undefined);
  });

  it("fails closed when multiple same-session labels are pending", () => {
    const { runtime } = createTimedRuntime();
    receiveSlackMessage(runtime, {
      event: { senderId: "U123", metadata: { senderName: "Alice", provider: "slack" } },
    });
    receiveSlackMessage(runtime, {
      event: { senderId: "U456", metadata: { senderName: "Bob", provider: "slack" } },
    });

    assert.equal(writeUserMessage(runtime, "ambiguous"), undefined);
  });

  it("registers the expected OpenClaw hooks", () => {
    const registrations: string[] = [];
    const api: Pick<OpenClawPluginApi, "on"> = {
      on(hookName: string) {
        registrations.push(hookName);
      },
    };
    registerSlackLabelsPlugin(api);

    assert.deepEqual(registrations, ["message_received", "before_message_write"]);
  });
});
