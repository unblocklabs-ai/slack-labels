import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { AgentMessage } from "openclaw/plugin-sdk/agent-harness-runtime";

export type { AgentMessage };

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_PENDING_LABELS = 512;
export const LABEL_PREFIX_PATTERN = /^From: .+ \([^)]+\)\n/u;

type HookApi = Pick<OpenClawPluginApi, "on">;

type RuntimeMessageReceivedEvent = {
  senderId?: string;
  sessionKey?: string;
  metadata?: Record<string, unknown>;
};

type RuntimeMessageReceivedContext = {
  channelId?: string;
  senderId?: string;
  sessionKey?: string;
};

type RuntimeBeforeMessageWriteContext = {
  sessionKey?: string;
};

export type SlackSenderLabel = {
  senderId: string;
  senderName: string;
};

export type SlackLabelAgentMessage = {
  role?: unknown;
  content?: unknown;
};

type PendingLabel = SlackSenderLabel & {
  expiresAt: number;
  sessionKey: string;
  insertedAt: number;
};

type SlackLabelRuntimeOptions = {
  now?: () => number;
};

type TextContentPart = {
  type?: unknown;
  text?: unknown;
  [key: string]: unknown;
};

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeChannelId(value: unknown): string | undefined {
  return normalizeOptionalString(value)?.toLowerCase();
}

function readMetadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  return normalizeOptionalString(metadata?.[key]);
}

function sanitizeLabelPart(value: string): string {
  return value.replace(/[\r\n]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function resolveSessionKey(
  event: RuntimeMessageReceivedEvent,
  ctx: RuntimeMessageReceivedContext,
): string | undefined {
  return normalizeOptionalString(ctx.sessionKey) ?? normalizeOptionalString(event.sessionKey);
}

function isTextContentPart(part: unknown): part is TextContentPart & { type: "text"; text: string } {
  return (
    typeof part === "object" &&
    part !== null &&
    (part as TextContentPart).type === "text" &&
    typeof (part as TextContentPart).text === "string"
  );
}

function findFirstTextPartIndex(content: unknown[]): number {
  return content.findIndex(isTextContentPart);
}

export function isSlackInboundEvent(
  event: RuntimeMessageReceivedEvent,
  ctx: RuntimeMessageReceivedContext,
): boolean {
  const metadata = event.metadata;
  return [
    ctx.channelId,
    readMetadataString(metadata, "originatingChannel"),
    readMetadataString(metadata, "provider"),
    readMetadataString(metadata, "surface"),
  ].some((value) => normalizeChannelId(value) === "slack");
}

export function resolveSlackSenderLabel(
  event: RuntimeMessageReceivedEvent,
  ctx: RuntimeMessageReceivedContext,
): SlackSenderLabel | undefined {
  const metadata = event.metadata;
  const senderId =
    normalizeOptionalString(event.senderId) ??
    normalizeOptionalString(ctx.senderId) ??
    readMetadataString(metadata, "senderId");
  if (!senderId) {
    return undefined;
  }
  const senderName =
    readMetadataString(metadata, "senderName") ??
    readMetadataString(metadata, "senderUsername") ??
    senderId;
  return {
    senderId: sanitizeLabelPart(senderId),
    senderName: sanitizeLabelPart(senderName),
  };
}

export function formatSlackLabel(label: SlackSenderLabel): string {
  const senderId = sanitizeLabelPart(label.senderId);
  const senderName = sanitizeLabelPart(label.senderName) || senderId;
  return `From: ${senderName} (${senderId})`;
}

export function isAlreadyLabeledContent(content: unknown): boolean {
  if (typeof content === "string") {
    return LABEL_PREFIX_PATTERN.test(content);
  }
  if (!Array.isArray(content)) {
    return false;
  }
  const textIndex = findFirstTextPartIndex(content);
  if (textIndex < 0) {
    return false;
  }
  const textPart = content[textIndex] as TextContentPart & { type: "text"; text: string };
  return LABEL_PREFIX_PATTERN.test(textPart.text);
}

export function prependSlackLabelToMessage<T extends SlackLabelAgentMessage>(
  message: T,
  label: SlackSenderLabel,
): T | undefined {
  if (message.role !== "user") {
    return undefined;
  }
  const labelText = formatSlackLabel(label);
  const content = message.content;
  if (typeof content === "string") {
    if (isAlreadyLabeledContent(content)) {
      return undefined;
    }
    return {
      ...message,
      content: `${labelText}\n${content}`,
    } as T;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  const textIndex = findFirstTextPartIndex(content);
  if (textIndex < 0) {
    return undefined;
  }
  const textPart = content[textIndex] as TextContentPart & { type: "text"; text: string };
  if (LABEL_PREFIX_PATTERN.test(textPart.text)) {
    return undefined;
  }
  const nextContent = [...content];
  nextContent[textIndex] = {
    ...textPart,
    text: `${labelText}\n${textPart.text}`,
  };
  return {
    ...message,
    content: nextContent,
  } as T;
}

class SlackLabelPendingQueue {
  private readonly pendingBySession = new Map<string, PendingLabel[]>();

  enqueue(sessionKey: string, label: SlackSenderLabel, now: number): void {
    this.prune(now);
    const pending = this.pendingBySession.get(sessionKey) ?? [];
    pending.push({
      ...label,
      sessionKey,
      expiresAt: now + DEFAULT_CACHE_TTL_MS,
      insertedAt: now,
    });
    this.pendingBySession.set(sessionKey, pending);
    this.trim();
  }

  peekSingle(sessionKey: string, now: number): SlackSenderLabel | undefined {
    this.prune(now);
    const pending = this.pendingBySession.get(sessionKey);
    if (!pending || pending.length !== 1) {
      return undefined;
    }
    const [entry] = pending;
    return {
      senderId: entry.senderId,
      senderName: entry.senderName,
    };
  }

  consume(sessionKey: string, now: number): void {
    this.prune(now);
    this.pendingBySession.delete(sessionKey);
  }

  size(): number {
    let size = 0;
    for (const pending of this.pendingBySession.values()) {
      size += pending.length;
    }
    return size;
  }

  private prune(now: number): void {
    for (const [sessionKey, pending] of this.pendingBySession) {
      const fresh = pending.filter((entry) => entry.expiresAt >= now);
      if (fresh.length === 0) {
        this.pendingBySession.delete(sessionKey);
      } else if (fresh.length !== pending.length) {
        this.pendingBySession.set(sessionKey, fresh);
      }
    }
  }

  private trim(): void {
    while (this.size() > DEFAULT_MAX_PENDING_LABELS) {
      const oldest = this.findOldestPending();
      if (!oldest) {
        return;
      }
      const pending = this.pendingBySession.get(oldest.sessionKey);
      if (!pending) {
        return;
      }
      const next = pending.filter((entry) => entry !== oldest);
      if (next.length === 0) {
        this.pendingBySession.delete(oldest.sessionKey);
      } else {
        this.pendingBySession.set(oldest.sessionKey, next);
      }
    }
  }

  private findOldestPending(): PendingLabel | undefined {
    let oldest: PendingLabel | undefined;
    for (const pending of this.pendingBySession.values()) {
      for (const entry of pending) {
        if (!oldest || entry.insertedAt < oldest.insertedAt) {
          oldest = entry;
        }
      }
    }
    return oldest;
  }
}

export function createSlackLabelsRuntime(options: SlackLabelRuntimeOptions = {}) {
  const cache = new SlackLabelPendingQueue();
  const now = options.now ?? (() => Date.now());

  return {
    cache,
    onMessageReceived(event: RuntimeMessageReceivedEvent, ctx: RuntimeMessageReceivedContext): void {
      if (!isSlackInboundEvent(event, ctx)) {
        return;
      }
      const label = resolveSlackSenderLabel(event, ctx);
      if (!label) {
        return;
      }
      const sessionKey = resolveSessionKey(event, ctx);
      if (!sessionKey) {
        return;
      }
      cache.enqueue(sessionKey, label, now());
    },
    onBeforeMessageWrite<T extends SlackLabelAgentMessage>(
      event: { message: T },
      ctx: RuntimeBeforeMessageWriteContext,
    ) {
      const sessionKey = normalizeOptionalString(ctx.sessionKey);
      if (!sessionKey) {
        return undefined;
      }
      const currentTime = now();
      const label = cache.peekSingle(sessionKey, currentTime);
      if (!label) {
        return undefined;
      }
      const message = prependSlackLabelToMessage(event.message, label);
      if (event.message.role === "user") {
        cache.consume(sessionKey, currentTime);
      }
      return message ? { message } : undefined;
    },
  };
}

export function registerSlackLabelsPlugin(api: HookApi): void {
  const runtime = createSlackLabelsRuntime();
  api.on("message_received", (event, ctx) => {
    runtime.onMessageReceived(event, ctx);
  });
  api.on("before_message_write", (event, ctx) => runtime.onBeforeMessageWrite(event, ctx));
}
