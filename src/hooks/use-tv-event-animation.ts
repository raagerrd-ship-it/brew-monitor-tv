import { useLayoutEffect, useRef, type RefObject } from "react";
import { isLocked, onMotionLockChange } from "@/lib/motion-lock";

export function useTvEventAnimation<T extends HTMLElement>(ref: RefObject<T>, value: unknown, className: string, enabled: boolean) {
  const previous = useRef(value);
  const hadElement = useRef(false);
  useLayoutEffect(() => {
    const changed = previous.current !== value;
    const hadValue = previous.current != null;
    previous.current = value;
    const el = ref.current;
    const mounted = hadElement.current;
    hadElement.current = !!el;
    if (!el || !mounted || !hadValue || !changed || !enabled || isLocked() || el.closest('.cleaning-transition-active') || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    el.classList.remove(className);
    const frame = requestAnimationFrame(() => {
      if (!isLocked() && !el.closest('.cleaning-transition-active')) el.classList.add(className);
    });
    const finish = (event: AnimationEvent) => { if (event.target === el) el.classList.remove(className); };
    el.addEventListener('animationend', finish);
    const unsubscribe = onMotionLockChange(locked => { if (locked) el.classList.remove(className); });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('animationend', finish);
      el.classList.remove(className);
      unsubscribe();
    };
  }, [value, enabled, className, ref]);
}