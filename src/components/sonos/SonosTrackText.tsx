import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useTvEventAnimation } from "@/hooks/use-tv-event-animation";
import { isLocked } from "@/lib/motion-lock";

export function SonosTrackText({ identity, children, enabled }: { identity: string; children: ReactNode; enabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef({ identity, children });
  const old = previous.current.identity !== identity ? previous.current.children : null;
  useTvEventAnimation(ref, identity, 'tv-track-enter', enabled);
  useLayoutEffect(() => { previous.current = { identity, children }; }, [identity, children]);
  return <div className="relative overflow-hidden">
    {enabled && !isLocked() && old && <div aria-hidden="true" className="tv-track-exit absolute inset-0 pointer-events-none">{old}</div>}
    <div ref={ref}>{children}</div>
  </div>;
}