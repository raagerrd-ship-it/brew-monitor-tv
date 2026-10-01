import { Check, ChefHat, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { BrewDay } from "@/hooks/use-brew-day";

export function BrewDayCard({ day, hasAlbumArtBackground, isTvMode }: { day: BrewDay; hasAlbumArtBackground?: boolean; isTvMode?: boolean }) {
  const nextId = day.items.find((i) => !i.checked)?.id;
  const doneCount = day.items.filter((i) => i.checked).length;
  return (
    <Card
      className={`border-white/15 shadow-deep h-full w-full overflow-hidden flex flex-col ${isTvMode ? "p-6 gap-5" : "p-5 gap-4"}`}
      style={{
        background: hasAlbumArtBackground ? 'hsl(222 18% 15% / 0.75)' : 'hsl(222 18% 15%)',
        boxShadow: '0 8px 24px hsl(222 30% 3% / 0.7), 0 20px 40px hsl(222 30% 2% / 0.5)',
      }}
    >
      <div className="flex items-start gap-3">
        <ChefHat className={`${isTvMode ? "h-9 w-9" : "h-7 w-7"} text-primary shrink-0`} />
        <div className="min-w-0 flex-1">
          <div className={`${isTvMode ? "text-lg" : "text-xs"} uppercase tracking-wider text-muted-foreground truncate`}>Bryggdag · {day.recipe_name ?? "—"}</div>
          <div className={`${isTvMode ? "text-5xl" : "text-2xl"} font-semibold truncate`}>{day.step_title ?? "—"}</div>
        </div>
        {day.target_temp_c != null && (
          <div className={`shrink-0 rounded-xl border border-white/10 bg-muted/40 ${isTvMode ? "px-5 py-3" : "px-3 py-2"} text-right`}>
            <div className={`${isTvMode ? "text-sm" : "text-[10px]"} uppercase tracking-wider text-muted-foreground`}>Mål</div>
            <div className={`${isTvMode ? "text-3xl" : "text-lg"} font-semibold tabular-nums text-primary`}>{day.target_temp_c.toFixed(1)}°</div>
          </div>
        )}
      </div>
      {day.items.length > 0 && (
        <div className={`flex items-center gap-3 ${isTvMode ? "" : "gap-2"}`}>
          <span className={`${isTvMode ? "text-base" : "text-xs"} text-muted-foreground tabular-nums whitespace-nowrap`}>
            {doneCount} av {day.items.length} klart
          </span>
          <div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(doneCount / day.items.length) * 100}%` }} />
          </div>
        </div>
      )}
      <ul className={`flex-1 min-h-0 overflow-hidden grid content-start ${isTvMode ? "gap-3" : "gap-2"}`}>
        {day.items.map((i) => {
          const isNext = i.id === nextId;
          return (
            <li
              key={i.id}
              className={`flex items-center gap-4 rounded-lg ${isTvMode ? "px-4 py-3.5" : "px-3 py-2"} ${
                isNext
                  ? "bg-primary/15 border border-primary/50 shadow-[0_0_16px_hsl(var(--primary)/0.25)]"
                  : i.checked
                    ? "bg-muted/20 opacity-45"
                    : "bg-muted/30"
              }`}
            >
              <span className={`${isTvMode ? "h-7 w-7" : "h-5 w-5"} rounded-full border flex items-center justify-center shrink-0 ${
                i.checked
                  ? "bg-primary border-primary"
                  : isNext
                    ? "border-primary"
                    : "border-muted-foreground/50"
              }`}>
                {i.checked
                  ? <Check className={`${isTvMode ? "h-5 w-5" : "h-3.5 w-3.5"} text-primary-foreground`} />
                  : isNext
                    ? <span className={`${isTvMode ? "h-2.5 w-2.5" : "h-1.5 w-1.5"} rounded-full bg-primary`} />
                    : null}
              </span>
              <span className={`flex-1 truncate ${isTvMode ? "text-2xl" : "text-base"} ${i.checked ? "line-through" : ""} ${isNext ? "font-semibold" : ""}`}>{i.name}</span>
              <span className="flex items-center gap-3 shrink-0">
                {i.amount != null && (
                  <span className={`${isTvMode ? "text-2xl" : "text-base"} font-semibold text-foreground tabular-nums whitespace-nowrap`}>
                    {i.amount} {i.unit ?? ""}
                  </span>
                )}
                {i.at_min != null && (
                  <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-medium tabular-nums whitespace-nowrap ${isTvMode ? "text-lg px-3 py-1.5" : "text-xs"} ${isNext ? "border-primary/40 bg-primary/10 text-foreground" : "border-white/10 bg-muted/40 text-muted-foreground"}`}>
                    <Clock className={isTvMode ? "h-5 w-5" : "h-3 w-3"} />
                    {i.at_min} min
                  </span>
                )}
              </span>
            </li>
          );
        })}
        {day.items.length === 0 && <li className="text-sm text-muted-foreground">Inget att tillsätta i det här steget</li>}
      </ul>
    </Card>
  );
}
