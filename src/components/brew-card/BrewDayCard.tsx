import { Check, ChefHat, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { BrewDay } from "@/hooks/use-brew-day";

export function BrewDayCard({ day, hasAlbumArtBackground, isTvMode }: { day: BrewDay; hasAlbumArtBackground?: boolean; isTvMode?: boolean }) {
  const nextId = day.items.find((i) => !i.checked)?.id;
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
          <div className={`${isTvMode ? "text-4xl" : "text-2xl"} font-semibold truncate`}>{day.step_title ?? "—"}</div>
        </div>
        {day.target_temp_c != null && (
          <div className={`shrink-0 rounded-xl border border-white/10 bg-muted/40 ${isTvMode ? "px-5 py-2.5" : "px-3 py-2"} text-right`}>
            <div className={`${isTvMode ? "text-xs" : "text-[10px]"} uppercase tracking-wider text-muted-foreground`}>Mål</div>
            <div className={`${isTvMode ? "text-3xl" : "text-lg"} font-semibold tabular-nums text-primary`}>{day.target_temp_c.toFixed(1)}°</div>
          </div>
        )}
      </div>
      <ul className={`flex-1 min-h-0 overflow-hidden grid content-start ${isTvMode ? "gap-3" : "gap-2"}`}>
        {day.items.map((i) => {
          const isNext = i.id === nextId;
          return (
            <li
              key={i.id}
              className={`flex items-center gap-4 rounded-lg ${isTvMode ? "px-4 py-3" : "px-3 py-2"} ${
                isNext
                  ? "bg-primary/15 border border-primary/50 shadow-[0_0_16px_hsl(var(--primary)/0.25)]"
                  : i.checked
                    ? "bg-muted/20 opacity-45"
                    : "bg-muted/30"
              }`}
            >
              <span className={`${isTvMode ? "h-6 w-6" : "h-5 w-5"} rounded-full border flex items-center justify-center shrink-0 ${
                i.checked
                  ? "bg-primary border-primary"
                  : isNext
                    ? "border-primary"
                    : "border-muted-foreground/50"
              }`}>
                {i.checked
                  ? <Check className={`${isTvMode ? "h-4 w-4" : "h-3.5 w-3.5"} text-primary-foreground`} />
                  : isNext
                    ? <span className={`${isTvMode ? "h-2 w-2" : "h-1.5 w-1.5"} rounded-full bg-primary`} />
                    : null}
              </span>
              <span className={`flex-1 truncate ${isTvMode ? "text-xl" : "text-base"} ${i.checked ? "line-through" : ""} ${isNext ? "font-semibold" : ""}`}>{i.name}</span>
              <span className="flex items-center gap-4 shrink-0">
                {i.amount != null && (
                  <span className={`${isTvMode ? "text-2xl" : "text-lg"} font-bold ${isNext ? "text-primary" : "text-foreground"} tabular-nums whitespace-nowrap`}>
                    {i.amount} {i.unit ?? ""}
                  </span>
                )}
                {i.at_min != null && (
                  <span className={`${isTvMode ? "text-lg" : "text-sm"} font-medium tabular-nums whitespace-nowrap ${isNext ? "text-primary" : "text-muted-foreground"}`}>
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
