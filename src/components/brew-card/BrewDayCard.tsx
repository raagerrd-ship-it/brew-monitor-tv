import { Check, ChefHat } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { BrewDay } from "@/hooks/use-brew-day";

export function BrewDayCard({ day, hasAlbumArtBackground, isTvMode }: { day: BrewDay; hasAlbumArtBackground?: boolean; isTvMode?: boolean }) {
  const nextId = day.items.find((i) => !i.checked)?.id;
  return (
    <Card
      className={`relative border-white/15 h-full w-full overflow-hidden flex flex-col ${isTvMode ? "p-5 gap-3" : "p-5 gap-4"}`}
      style={{
        background: hasAlbumArtBackground ? 'hsl(222 18% 15% / 0.75)' : 'hsl(222 18% 15%)',
        boxShadow: '0 8px 24px hsl(222 30% 3% / 0.7), 0 20px 40px hsl(222 30% 2% / 0.5)',
      }}
    >
      <div className="flex items-start gap-4">
        <div className={`shrink-0 flex items-center justify-center rounded-xl bg-foreground/10 ${isTvMode ? "h-11 w-11" : "h-9 w-9"}`}>
          <ChefHat className={`${isTvMode ? "h-6 w-6" : "h-5 w-5"} text-foreground/70`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className={`${isTvMode ? "text-lg" : "text-xs"} font-bold uppercase tracking-[0.2em] text-muted-foreground`}>Bryggdag</div>
          <div className={`${isTvMode ? "text-3xl" : "text-sm"} font-semibold text-foreground/80 truncate mt-0.5`}>{day.recipe_name ?? "—"}</div>
          <div className={`${isTvMode ? "text-6xl" : "text-2xl"} font-bold tracking-tight truncate mt-1`}>{day.step_title ?? "—"}</div>
        </div>
        {day.target_temp_c != null && (
          <div className={`shrink-0 rounded-2xl border border-primary/30 bg-primary/15 ${isTvMode ? "px-5 py-2" : "px-3 py-2"} text-right`}>
            <div className={`${isTvMode ? "text-[11px]" : "text-[10px]"} font-bold uppercase tracking-widest text-primary/80`}>Mål</div>
            <div className={`${isTvMode ? "text-5xl" : "text-lg"} font-bold tabular-nums text-primary leading-tight`}>{day.target_temp_c.toFixed(1)}°</div>
          </div>
        )}
      </div>
      <ul className={`flex-1 min-h-0 overflow-hidden flex flex-col justify-center ${isTvMode ? "gap-2.5" : "gap-2"}`}>
        {day.items.map((i) => {
          const isNext = i.id === nextId;
          return (
            <li
              key={i.id}
              className={`flex items-center ${isTvMode ? "gap-3" : "gap-4"} ${isTvMode ? "px-4" : "px-3"} ${
                isNext
                  ? `bg-primary/10 border border-primary/40 shadow-[0_0_32px_-8px_hsl(var(--primary)/0.3)] rounded-2xl ${isTvMode ? "py-2.5" : "py-2.5"}`
                  : i.checked
                    ? "opacity-30"
                    : "opacity-60"
              }`}
            >
              <span className={`${isTvMode ? "h-7 w-7" : "h-5 w-5"} rounded-full border-2 flex items-center justify-center shrink-0 ${
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
              <span className={`flex-1 truncate ${isTvMode ? (isNext ? "text-5xl" : "text-4xl") : "text-base"} font-medium ${i.checked ? "line-through" : ""} ${isNext ? "font-semibold text-foreground" : i.checked ? "text-muted-foreground" : "text-foreground/90"}`}>{i.name}</span>
              <span className="flex items-center gap-4 shrink-0">
                {i.amount != null && !i.checked && (
                  <span className={`${isTvMode ? (isNext ? "text-5xl" : "text-4xl") : "text-xl"} font-bold ${isNext ? "text-primary" : "text-foreground"} tabular-nums whitespace-nowrap`}>
                    {i.amount} {i.unit ?? ""}
                  </span>
                )}
                {i.at_min != null && (
                  <span className={`${isTvMode ? (isNext ? "text-5xl" : i.checked ? "text-3xl" : "text-4xl") : i.checked ? "text-sm" : "text-base"} font-medium tabular-nums whitespace-nowrap ${isNext ? "text-foreground" : "text-muted-foreground"}`}>
                    {i.at_min} min
                  </span>
                )}
              </span>
            </li>
          );
        })}
        {day.items.length === 0 && <li className="text-sm text-muted-foreground">Inget att tillsätta i det här steget</li>}
      </ul>
      <div className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 h-px w-2/3 bg-primary/20 blur-[2px]" aria-hidden />
    </Card>
  );
}
