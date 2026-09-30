import { Check, ChefHat } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { BrewDay } from "@/hooks/use-brew-day";

export function BrewDayCard({ day }: { day: BrewDay }) {
  const nextId = day.items.find((i) => !i.checked)?.id;
  return (
    <Card className="h-full w-full p-5 flex flex-col gap-4 overflow-hidden">
      <div className="flex items-start gap-3">
        <ChefHat className="h-7 w-7 text-primary shrink-0" />
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Bryggdag · {day.recipe_name ?? "—"}</div>
          <div className="text-2xl font-semibold truncate">{day.step_title ?? "—"}</div>
          {day.target_temp_c != null && (
            <div className="text-sm text-muted-foreground tabular-nums">Mål {day.target_temp_c.toFixed(1)} °C</div>
          )}
        </div>
      </div>
      <ul className="flex-1 min-h-0 overflow-hidden grid content-start gap-2">
        {day.items.map((i) => (
          <li
            key={i.id}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 ${i.id === nextId ? "bg-primary/15 border border-primary/40" : "bg-muted/30"} ${i.checked ? "opacity-50" : ""}`}
          >
            <span className={`h-5 w-5 rounded-full border flex items-center justify-center shrink-0 ${i.checked ? "bg-primary border-primary" : "border-muted-foreground/50"}`}>
              {i.checked && <Check className="h-3.5 w-3.5 text-primary-foreground" />}
            </span>
            <span className={`flex-1 truncate ${i.checked ? "line-through" : ""}`}>{i.name}</span>
            <span className="text-sm text-muted-foreground tabular-nums whitespace-nowrap">
              {i.amount != null ? `${i.amount} ${i.unit ?? ""}` : ""}
              {i.at_min != null ? ` · ${i.at_min} min` : ""}
            </span>
          </li>
        ))}
        {day.items.length === 0 && <li className="text-sm text-muted-foreground">Inget att tillsätta i det här steget</li>}
      </ul>
    </Card>
  );
}
