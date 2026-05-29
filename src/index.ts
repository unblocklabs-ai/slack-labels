import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { registerSlackLabelsPlugin } from "./slack-labels.js";

export { registerSlackLabelsPlugin } from "./slack-labels.js";
export type { AgentMessage, SlackLabelAgentMessage, SlackSenderLabel } from "./slack-labels.js";

export default definePluginEntry({
  id: "slack-labels",
  name: "Slack Labels",
  description: "Labels persisted Slack user messages with sender identity.",
  register(api) {
    registerSlackLabelsPlugin(api);
  },
});
