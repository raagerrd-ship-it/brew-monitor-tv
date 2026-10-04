import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listControllersTool from "./tools/list-controllers";
import getLiveStateTool from "./tools/get-live-state";
import getBrewStatusTool from "./tools/get-brew-status";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "brew-monitor-tv",
  title: "brew-monitor-tv",
  version: "0.1.0",
  instructions:
    "Read-only access to the Brew Monitor dashboard. The Raspberry Pi controls all regulation; these tools only read tank temperatures and the Pi's live state.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listControllersTool, getLiveStateTool, getBrewStatusTool],
});
