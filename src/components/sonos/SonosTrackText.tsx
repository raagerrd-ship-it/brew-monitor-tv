import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useTvEventAnimation } from "@/hooks/use-tv-event-animation";
import { isLocked } from "@/lib/motion-lock";

export function SonosTrackText({ identity, children, enabled }: { identity: string; children: ReactNode; enabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef({ identity, html: '' });
  const old = previous.current.identity !== identity ? previous.current.html : null;
  useTvEventAnimation(ref, identity, 'tv-track-enter', enabled);
  useLayoutEffect(() => { previous.current = { identity, html: ref.current?.innerHTML ?? '' }; }, [identity, children]);
  return <div className="relative overflow-hidden">
    {enabled && !isLocked() && old && <div aria-hidden="true" className="tv-track-exit absolute inset-0 pointer-events-none" dangerouslySetInnerHTML={{ __html: old }} />}
    <div ref={ref}>{children}</div>
  </div>;
}