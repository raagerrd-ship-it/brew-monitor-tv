import { useTvRefreshListener } from "@/hooks/use-tv-refresh-listener";

/**
 * Component wrapper for the TV refresh listener hook.
 * This must be placed inside TvModeProvider to access TV mode context.
 */
export const TvRefreshListener = () => {
  useTvRefreshListener();
  return null;
};
