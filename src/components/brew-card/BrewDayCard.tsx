import { memo, useEffect, useRef, useState } from "react";
import { Check, ChefHat, Lock } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { BrewDay, BrewDayItem } from "@/hooks/use-brew-day";
import { useSharedExternalTimer, type ExternalTimerState } from "@/hooks/use-external-timer";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function getBrewDayItemState(item: BrewDayItem, isNext: boolean, countdown: number | null) {
  if (item.checked) return "done";
  if (isNext && (item.at_min == null || (countdown != null && countdown <= 0))) return "now";
  return "waiting";
}

/** Etikettbakgrund med mjuk övertoning: förra bilden tonas ut över den nya. */
function useLabelCrossfade(url: string | null) {
  const [bg, setBg] = useState<{ cur: string | null; prev: string | null; fading: boolean }>({ cur: url, prev: null, fading: false });
  useEffect(() => {
    setBg((b) => (url === b.cur ? b : { cur: url, prev: b.cur, fading: false }));
  }, [url]);
  useEffect(() => {
    if (bg.prev == null || bg.fading) return;
    const raf = requestAnimationFrame(() => setBg((b) => ({ ...b, fading: true })));
    const t = setTimeout(() => setBg((b) => ({ ...b, prev: null })), 1100);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [bg.prev, bg.fading]);
  return bg;
}

type BrewDayCardProps = { day: BrewDay; hasAlbumArtBackground?: boolean; isTvMode?: boolean; transitionActive?: boolean; compact?: boolean };
export function BrewDayCard(props: BrewDayCardProps) {
  const liveTimer = useSharedExternalTimer();
  const frozenTimer = useRef(liveTimer);
  if (!props.transitionActive || (!frozenTimer.current?.isActive && liveTimer?.isActive)) frozenTimer.current = liveTimer;
  return <BrewDayCardContent {...props} timer={frozenTimer.current} />;
}
const BrewDayCardContent = memo(function BrewDayCardContent({ day, hasAlbumArtBackground, isTvMode, compact, timer }: BrewDayCardProps & { timer: ExternalTimerState | null }) {
  const active = timer?.isActive ? timer : null;
  const isDone = !!active && active.totalSeconds > 0 && active.remainingSeconds === 0;
  // Keep the first unchecked item current even when the timer advances to its next milestone.
  const nextItem = day.items.find((i) => !i.checked);
  const nextId = nextItem?.id;
  const countdown = active && nextItem?.at_min != null ? active.remainingSeconds - nextItem.at_min * 60 : null;
  const bg = useLabelCrossfade(day.label_url);
  const compactTv = !!isTvMode && !!compact;
  const checkedCount = day.items.filter(i => i.checked).length;
  const visibleItems = compactTv ? day.items.filter(i => !i.checked) : day.items;
  return (
    <Card
      className={`relative border-white/15 ${isTvMode ? "" : "shadow-deep"} h-full w-full overflow-hidden flex flex-col ${compact ? "p-4" : "p-5"}`}
      style={{
        background: hasAlbumArtBackground
          ? 'hsl(222 18% 15% / 0.75)'
          : 'hsl(222 18% 15%)',
        // On the TV the cards sit close together, so the drop shadow is dropped.
        boxShadow: isTvMode ? 'none' : '0 8px 24px hsl(222 30% 3% / 0.7), 0 20px 40px hsl(222 30% 2% / 0.5)',
      }}
    >
      {(bg.cur || bg.prev) && (
        <div className="absolute inset-0" aria-hidden>
          {bg.prev && (
            <img
              src={bg.prev}
              alt=""
              className={`absolute inset-0 h-full w-full object-cover scale-110 blur-[40px] transition-opacity duration-1000 ${bg.fading ? "opacity-0" : "opacity-100"}`}
            />
          )}
          {bg.cur && (
            <img src={bg.cur} alt="" className="absolute inset-0 h-full w-full object-cover scale-110 blur-[40px]" />
          )}
          <div className="absolute inset-0" style={{ background: 'hsl(0 0% 0% / 0.6)' }} />
        </div>
      )}
      <div className={`relative z-10 flex flex-col flex-1 min-h-0 ${compact ? "gap-2" : isTvMode ? "gap-3" : "gap-4"}`}>
      {compactTv ? (
        <div className="shrink-0 min-w-0 space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold uppercase text-muted-foreground whitespace-nowrap">
            <ChefHat className="h-4 w-4 shrink-0" />
            <span>Bryggdag{day.step_index != null && day.step_count != null ? ` · Steg ${day.step_index + 1}/${day.step_count}` : ""}</span>
          </div>
          {day.step_count != null && day.step_index != null && (
            <div className="flex gap-1 h-1" aria-label={`${day.step_index} av ${day.step_count} steg klara`}>
              {Array.from({ length: day.step_count }, (_, index) => <span key={index} className={`flex-1 rounded-sm ${index < (day.step_index ?? 0) ? "bg-primary" : "bg-foreground/15"}`} />)}
            </div>
          )}
          <div className="flex items-center gap-2 min-w-0">
            {day.label_url && <img src={day.label_url} alt="" className="h-7 w-7 rounded-md object-cover shrink-0 border border-border" />}
            <div className="text-base font-semibold text-foreground/80 line-clamp-2">{day.recipe_name ?? "—"}</div>
          </div>
          <div className="text-3xl leading-tight font-bold whitespace-normal break-normal">{day.step_title ?? "—"}</div>
          {isDone ? <div className="text-base font-semibold text-primary">KLART · Tryck Klar i appen</div> : day.target_temp_c != null && (
            <span className="inline-flex rounded-md border border-primary/30 bg-primary/15 px-2 py-0.5 text-xl font-bold tabular-nums text-primary">{Number(day.target_temp_c.toFixed(1))}°</span>
          )}
        </div>
      ) : <div className={`flex items-start ${compact ? "gap-2.5" : "gap-4"}`}>
        <div className={`shrink-0 flex items-center justify-center rounded-xl bg-foreground/10 ${compact ? "h-9 w-9" : "h-11 w-11"}`}>
          <ChefHat className={`${compact ? "h-5 w-5" : "h-6 w-6"} text-foreground/70`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className={`${compact ? "text-xs tracking-[0.12em] truncate" : "text-base tracking-[0.2em]"} font-bold uppercase text-muted-foreground`}>Bryggdag{day.step_index != null && day.step_count != null ? ` · Steg ${day.step_index + 1} av ${day.step_count}` : ""}</div>
          <div className="flex items-center gap-2 mt-0.5 min-w-0">
            {day.label_url && (
              <img src={day.label_url} alt="" className={`${compact ? "h-7 w-7" : "h-9 w-9"} rounded-md object-cover shrink-0 border border-white/20`} />
            )}
            <div className={`${compact ? "text-lg" : "text-2xl"} font-semibold text-foreground/80 truncate`}>{day.recipe_name ?? "—"}</div>
          </div>
          <div className={`${compact ? "text-2xl leading-tight" : "text-3xl"} font-bold tracking-tight break-words mt-1`}>{day.step_title ?? "—"}</div>
          {isDone && <div className="text-base font-semibold text-green-300 mt-1">Tryck Klar i appen</div>}
        </div>
        {isDone ? (
          <div className={`shrink-0 rounded-2xl border border-green-400/40 bg-green-500/20 ${compact ? "px-2.5 py-1" : isTvMode ? "px-5 py-2" : "px-3 py-2"}`}>
            <div className={`${compact ? "text-3xl" : "text-4xl"} font-bold text-green-300 leading-tight tracking-wider`}>KLART</div>
          </div>
        ) : day.target_temp_c != null && (
          <div className={`shrink-0 rounded-2xl border border-primary/30 bg-primary/15 ${compact ? "px-2.5 py-1" : isTvMode ? "px-5 py-2" : "px-3 py-2"} text-right`}>
            <div className={`${compact ? "text-3xl" : "text-4xl"} font-bold tabular-nums text-primary leading-tight`}>{Number(day.target_temp_c.toFixed(1))}°</div>
          </div>
        )}
      </div>}
      <div
        className="shrink-0 h-px bg-border/60 pointer-events-none"
        aria-hidden
      />
      {compactTv && checkedCount > 0 && (
        <div className="flex shrink-0 items-center gap-2 py-1 text-sm text-muted-foreground">
          <Check className="h-4 w-4 shrink-0" /><span className="whitespace-nowrap">{checkedCount} av {day.items.length} klara</span>
          <div className="ml-auto flex gap-0.5 w-20 h-1" aria-hidden>
            {day.items.map((item) => <span key={item.id} className={`flex-1 rounded-sm ${item.checked ? "bg-primary/70" : "bg-foreground/15"}`} />)}
          </div>
        </div>
      )}
      <ul className={`flex-1 min-h-0 ${compactTv ? "overflow-y-auto" : "overflow-hidden"} flex flex-col justify-start`}>
        {visibleItems.map((i, index) => {
          const isNext = i.id === nextId;
          const itemState = getBrewDayItemState(i, isNext, countdown);
          const isNow = itemState === "now";
          const isExpanded = isNow || (isNext && itemState === "waiting" && countdown != null && countdown > 0);
          const hasMeta = i.amount != null || i.at_min != null || (isNext && itemState === "waiting" && countdown != null && countdown > 0);
          const hasMetaRow = isExpanded && hasMeta;
          const smallSize = compact ? "text-sm" : "text-base";
          const waitingSize = compact ? "text-base" : "text-lg";
          return (
            <li
              key={i.id}
              className={`${hasMetaRow ? "grid grid-cols-[auto_minmax(0,1fr)]" : "flex"} shrink-0 items-start ${index === 0 ? "" : i.checked && day.items[index - 1]?.checked ? "mt-1" : compact ? "mt-2" : isTvMode ? "mt-2.5" : "mt-2"} ${compact ? "gap-2 px-2" : isTvMode ? "gap-3 px-3" : "gap-4 px-3"} ${
                isNow
                  ? `bg-primary/10 border border-primary/40 rounded-2xl ${isTvMode ? "" : "shadow-[0_0_32px_-8px_hsl(var(--primary)/0.3)]"} ${compact ? "py-2" : "py-2.5"}`
                  : i.checked
                    ? "opacity-30 py-0.5"
                    : "text-foreground/70"
              }`}
            >
              <span className={`${i.checked ? "h-5 w-5" : compact ? "h-6 w-6" : isTvMode ? "h-7 w-7" : "h-6 w-6"} rounded-full border-2 flex items-center justify-center shrink-0 ${
                i.checked
                  ? "border-muted-foreground/50"
                  : isNow
                    ? "border-primary"
                    : "border-muted-foreground/40"
              }`}>
                {i.checked
                  ? <Check className="h-3.5 w-3.5 text-foreground" strokeWidth={3} />
                  : isNow
                    ? <span className={`${isTvMode ? "h-2.5 w-2.5" : "h-1.5 w-1.5"} rounded-full bg-primary`} />
                    : <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
              </span>
              <span className={`flex-1 min-w-0 ${hasMetaRow ? "col-start-2 row-start-2" : ""} ${isExpanded ? "break-words" : i.checked ? "truncate" : "line-clamp-2 break-words"} ${i.checked ? smallSize : isExpanded ? compact ? "text-xl" : "text-2xl" : waitingSize} font-medium ${i.checked ? "line-through" : ""} ${isNow ? "font-semibold text-foreground" : i.checked ? "text-muted-foreground" : "text-foreground/70"}`}>{i.name}</span>
              {hasMeta && <span className={`flex items-start ${hasMetaRow ? "col-start-2 row-start-1 min-w-0" : "shrink-0"} ${compact ? "gap-1.5" : isTvMode ? "gap-3" : "gap-4"}`}>
                {i.amount != null && (
                  <span className={`flex items-baseline shrink-0 ${i.checked ? smallSize : !isExpanded ? waitingSize : compact ? (isNow ? "text-2xl" : "text-xl") : isNow ? "text-3xl" : "text-2xl"} font-bold ${isNow ? "text-primary" : "text-foreground/70"} tabular-nums whitespace-nowrap`}>
                    <span className={`${compact || i.checked || isExpanded ? "" : "w-16"} text-right`}>{i.amount}</span>
                    <span className={`${compact || i.checked || isExpanded ? "" : "w-8"} text-left text-[0.6em] font-semibold text-muted-foreground ml-0.5`}>{i.unit ?? ""}</span>
                  </span>
                )}
                {i.amount != null && i.at_min != null && (
                  <span className={`w-px self-stretch shrink-0 ${isNow ? "bg-primary/30" : "bg-foreground/15"}`} aria-hidden />
                )}
                {i.at_min != null && (
                  <span className={`flex items-baseline shrink-0 ${i.checked ? smallSize : !isExpanded ? waitingSize : compact ? (isNow ? "text-2xl" : "text-xl") : isNow ? "text-3xl" : "text-2xl"} font-medium tabular-nums whitespace-nowrap ${isNow ? "text-foreground" : "text-muted-foreground"}`}>
                    <span className={`${compact || i.checked || isExpanded ? "" : "w-12"} text-right`}>{i.at_min}</span>
                    <span className={`${compact || i.checked || isExpanded ? "" : "w-10"} text-left text-[0.6em] font-semibold ml-0.5`}>min</span>
                  </span>
                )}
                {isNext && itemState === "waiting" && countdown != null && countdown > 0 && (
                  <span className={`flex items-baseline shrink-0 ml-auto ${compact ? "text-2xl" : "text-3xl"} font-medium tabular-nums whitespace-nowrap text-foreground`}>
                    <span className="text-[0.6em] font-semibold mr-1"><span className="text-muted-foreground">Låst · </span>om</span>{fmt(countdown)}
                  </span>
                )}
              </span>}
            </li>
          );
        })}
        {day.items.length === 0 && <li className="text-sm text-muted-foreground">Inget att tillsätta i det här steget</li>}
      </ul>
      {day.next_step_title && (
        <div className={`shrink-0 border-t border-border/60 ${compact ? "pt-2" : "pt-3"}`}>
          <div className={`${compactTv ? "text-xs" : compact ? "text-sm tracking-[0.2em]" : "text-base tracking-[0.2em]"} font-bold uppercase text-muted-foreground`}>Nästa</div>
          <div className={`${compactTv ? "text-sm truncate" : compact ? "text-lg leading-snug break-words" : "text-xl break-words"} font-medium text-foreground`}>
          {day.next_step_title}
          {day.next_step_minutes != null ? ` · ${day.next_step_minutes} min` : ""}
          {day.next_step_items != null && day.next_step_items > 0 ? ` · ${day.next_step_items} ${day.next_step_items === 1 ? "tillsats" : "tillsatser"}` : ""}
          </div>
        </div>
      )}
      {!isTvMode && <div className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 h-px w-2/3 bg-primary/20 blur-[2px]" aria-hidden />}
      </div>
    </Card>
  );
});
