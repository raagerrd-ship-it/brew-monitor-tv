import { Check, ChefHat } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { BrewDay } from "@/hooks/use-brew-day";
import { useSharedExternalTimer } from "@/hooks/use-external-timer";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function BrewDayCard({ day, hasAlbumArtBackground, isTvMode }: { day: BrewDay; hasAlbumArtBackground?: boolean; isTvMode?: boolean }) {
  const timer = useSharedExternalTimer();
  const active = timer?.isActive ? timer : null;
  const isDone = !!active && active.totalSeconds > 0 && active.remainingSeconds === 0;
  // Same row as the footer's next milestone; otherwise first unchecked.
  const nm = active?.nextMilestone;
  const matchedId = nm ? day.items.find((i) => i.at_min != null && i.at_min * 60 === nm.time)?.id : undefined;
  const nextId = matchedId ?? day.items.find((i) => !i.checked)?.id;
  const countdown = matchedId && active?.timeToNextMilestone != null ? active.timeToNextMilestone : null;
  return (
    <Card
      className={`brew-day-card relative border-white/15 shadow-deep h-full w-full overflow-hidden flex flex-col ${isTvMode ? "p-5 gap-3" : "p-5 gap-4"}`}
      style={{
        background: hasAlbumArtBackground
          ? 'hsl(222 18% 15% / 0.75)'
          : 'hsl(222 18% 15%)',
        boxShadow: '0 8px 24px hsl(222 30% 3% / 0.7), 0 20px 40px hsl(222 30% 2% / 0.5)',
      }}
    >
      <div className="flex items-start gap-4">
        <div className={`shrink-0 flex items-center justify-center rounded-xl bg-foreground/10 ${isTvMode ? "h-11 w-11" : "h-11 w-11"}`}>
          <ChefHat className={`${isTvMode ? "h-6 w-6" : "h-6 w-6"} text-foreground/70`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className={`${isTvMode ? "text-base" : "text-base"} font-bold uppercase tracking-[0.2em] text-muted-foreground`}>Bryggdag{day.step_index != null && day.step_count != null ? ` · Steg ${day.step_index + 1} av ${day.step_count}` : ""}</div>
          <div className={`${isTvMode ? "text-2xl" : "text-2xl"} font-semibold text-foreground/80 truncate mt-0.5`}>{day.recipe_name ?? "—"}</div>
          <div className={`${isTvMode ? "text-3xl" : "text-3xl"} font-bold tracking-tight break-words mt-1`}>{day.step_title ?? "—"}</div>
          {isDone && <div className="text-base font-semibold text-green-300 mt-1">Tryck Klar i appen</div>}
        </div>
        {isDone ? (
          <div className={`shrink-0 rounded-2xl border border-green-400/40 bg-green-500/20 ${isTvMode ? "px-5 py-2" : "px-3 py-2"}`}>
            <div className="text-4xl font-bold text-green-300 leading-tight tracking-wider">KLART</div>
          </div>
        ) : day.target_temp_c != null && (
          <div className={`shrink-0 rounded-2xl border border-primary/30 bg-primary/15 ${isTvMode ? "px-5 py-2" : "px-3 py-2"} text-right`}>
            <div className={`${isTvMode ? "text-4xl" : "text-4xl"} font-bold tabular-nums text-primary leading-tight`}>{Number(day.target_temp_c.toFixed(1))}°</div>
          </div>
        )}
      </div>
      <div
        className="shrink-0 h-px bg-border/60 pointer-events-none"
        aria-hidden
      />
      <ul className={`flex-1 min-h-0 overflow-hidden flex flex-col justify-start ${isTvMode ? "gap-2.5" : "gap-2"}`}>
        {day.items.map((i) => {
          const isNext = i.id === nextId;
          return (
            <li
              key={i.id}
              className={`flex shrink-0 items-center ${isTvMode ? "gap-3" : "gap-4"} ${isTvMode ? "px-3" : "px-3"} ${
                isNext
                  ? `bg-primary/10 border border-primary/40 rounded-2xl ${isTvMode ? "" : "shadow-[0_0_32px_-8px_hsl(var(--primary)/0.3)]"} py-2.5`
                  : i.checked
                    ? "opacity-30"
                    : "opacity-60"
              }`}
            >
              <span className={`${isTvMode ? "h-7 w-7" : "h-6 w-6"} rounded-full border-2 flex items-center justify-center shrink-0 ${
                i.checked
                  ? "border-muted-foreground/50"
                  : isNext
                    ? "border-primary"
                    : "border-muted-foreground/40"
              }`}>
                {i.checked
                  ? <Check className={`${isTvMode ? "h-4.5 w-4.5" : "h-3.5 w-3.5"} text-foreground`} strokeWidth={3} />
                  : isNext
                    ? <span className={`${isTvMode ? "h-2.5 w-2.5" : "h-1.5 w-1.5"} rounded-full bg-primary`} />
                    : null}
              </span>
              <span className={`flex-1 truncate ${isTvMode ? (isNext ? "text-2xl" : "text-xl") : (isNext ? "text-2xl" : "text-xl")} font-medium ${i.checked ? "line-through" : ""} ${isNext ? "font-semibold text-foreground" : i.checked ? "text-muted-foreground" : "text-foreground/90"}`}>{i.name}</span>
              <span className={`flex items-center ${isTvMode ? "gap-3" : "gap-4"} shrink-0`}>
                {i.amount != null && (
                  <span className={`flex items-baseline shrink-0 ${isTvMode ? (isNext ? "text-3xl" : "text-2xl") : (isNext ? "text-3xl" : "text-2xl")} font-bold ${isNext ? "text-primary" : "text-foreground"} tabular-nums whitespace-nowrap`}>
                    <span className="w-16 text-right">{i.amount}</span>
                    <span className="w-8 text-left text-[0.6em] font-semibold text-muted-foreground ml-1">{i.unit ?? ""}</span>
                  </span>
                )}
                {i.amount != null && i.at_min != null && (
                  <span className={`w-px self-stretch shrink-0 ${isNext ? "bg-primary/30" : "bg-foreground/15"}`} aria-hidden />
                )}
                {i.at_min != null && (
                  <span className={`flex items-baseline shrink-0 ${isTvMode ? (isNext ? "text-3xl" : i.checked ? "text-xl" : "text-2xl") : (isNext ? "text-3xl" : i.checked ? "text-xl" : "text-2xl")} font-medium tabular-nums whitespace-nowrap ${isNext ? "text-foreground" : "text-muted-foreground"}`}>
                    <span className="w-12 text-right">{i.at_min}</span>
                    <span className="w-10 text-left text-[0.6em] font-semibold ml-1">min</span>
                  </span>
                )}
                {isNext && countdown != null && (
                  <span className={`flex items-baseline shrink-0 ${isTvMode ? "text-3xl" : "text-3xl"} font-medium tabular-nums whitespace-nowrap text-foreground`}>
                    <span className="text-[0.6em] font-semibold mr-1">om</span>{fmt(countdown)}
                  </span>
                )}
              </span>
            </li>
          );
        })}
        {day.items.length === 0 && <li className="text-sm text-muted-foreground">Inget att tillsätta i det här steget</li>}
      </ul>
      {day.next_step_title && (
        <div className="shrink-0 border-t border-border/60 pt-3">
          <div className="text-base font-bold uppercase tracking-[0.2em] text-muted-foreground">Nästa</div>
          <div className="text-xl font-medium text-foreground break-words">
          {day.next_step_title}
          {day.next_step_minutes != null ? ` · ${day.next_step_minutes} min` : ""}
          {day.next_step_items != null && day.next_step_items > 0 ? ` · ${day.next_step_items} ${day.next_step_items === 1 ? "tillsats" : "tillsatser"}` : ""}
          </div>
        </div>
      )}
      {!isTvMode && <div className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 h-px w-2/3 bg-primary/20 blur-[2px]" aria-hidden />}
    </Card>
  );
}
