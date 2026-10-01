import { Check, ChefHat } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { BrewDay } from "@/hooks/use-brew-day";

export function BrewDayCard({ day, hasAlbumArtBackground, isTvMode }: { day: BrewDay; hasAlbumArtBackground?: boolean; isTvMode?: boolean }) {
  const nextId = day.items.find((i) => !i.checked)?.id;
  const doneCount = day.items.filter((i) => i.checked).length;
  return (
    <Card
      className="border-white/15 shadow-deep h-full w-full p-5 flex flex-col gap-4 overflow-hidden"
      style={{
        background: hasAlbumArtBackground ? 'hsl(222 18% 15% / 0.75)' : 'hsl(222 18% 15%)',
        boxShadow: '0 8px 24px hsl(222 30% 3% / 0.7), 0 20px 40px hsl(222 30% 2% / 0.5)',
      }}
    >
      <div className="flex items-start gap-3">
        <ChefHat className={`${isTvMode ? "h-9 w-9" : "h-7 w-7"} text-primary shrink-0`} />
        <div className="min-w-0 flex-1">
          <div className={`${isTvMode ? "text-base" : "text-xs"} uppercase tracking-wider text-muted-foreground truncate`}>Bryggdag · {day.recipe_name ?? "—"}</div>
          <div className={`${isTvMode ? "text-4xl" : "text-2xl"} font-semibold truncate`}>{day.step_title ?? "—"}</div>
        </div>
        {day.target_temp_c != null && (
          <div className={`shrink-0 rounded-xl border border-white/10 bg-muted/40 ${isTvMode ? "px-4 py-2.5" : "px-3 py-2"} text-right`}>
            <div className={`${isTvMode ? "text-xs" : "text-[10px]"} uppercase tracking-wider text-muted-foreground`}>Mål</div>
            <div className={`${isTvMode ? "text-2xl" : "text-lg"} font-semibold tabular-nums text-primary`}>{day.target_temp_c.toFixed(1)}°</div>
          </div>
        )}
      </div>
      {day.items.length > 0 && (
        <div className={`${isTvMode ? "text-sm" : "text-xs"} text-muted-foreground tabular-nums`}>
          {doneCount} av {day.items.length} klart
        </div>
      )}
      <ul className={`flex-1 min-h-0 overflow-hidden grid content-start ${isTvMode ? "gap-3" : "gap-2"}`}>
        {day.items.map((i) => {
          const isNext = i.id === nextId;
          return (
            <li
              key={i.id}
              className={`flex items-center gap-3 rounded-lg ${isTvMode ? "px-3 py-3" : "px-3 py-2"} ${
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
              <span className={`${isTvMode ? "text-base" : "text-sm"} text-muted-foreground tabular-nums whitespace-nowrap`}>
                {i.amount != null ? `${i.amount} ${i.unit ?? ""}` : ""}
                {i.at_min != null ? ` · ${i.at_min} min` : ""}
              </span>
              {isNext && (
                <span className={`${isTvMode ? "text-xs px-2 py-0.5" : "text-[10px] px-1.5 py-0.5"} font-semibold uppercase tracking-wider rounded-md bg-primary/20 text-primary border border-primary/30 whitespace-nowrap`}>
                  Nästa
                </span>
              )}
            </li>
          );
        })}
        {day.items.length === 0 && <li className="text-sm text-muted-foreground">Inget att tillsätta i det här steget</li>}
      </ul>
    </Card>
  );
}
