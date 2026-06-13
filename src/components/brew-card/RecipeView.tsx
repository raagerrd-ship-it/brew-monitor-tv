import type { RecipeData } from "@/components/RecipeEditor";

interface Props {
  recipe: RecipeData | null | undefined;
  onClose: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">{title}</div>
      <div className="text-xs text-foreground/90">{children}</div>
    </div>
  );
}

export function RecipeView({ recipe, onClose }: Props) {
  const r = recipe;
  const hasAny =
    r && (
      r.ingredients?.length ||
      r.mash_steps?.length ||
      r.boil_additions?.length ||
      r.water_adjustments?.length ||
      r.boil_minutes ||
      r.mash_water_liters ||
      r.sparge_water_liters ||
      r.notes
    );

  return (
    <div
      className="w-full h-full overflow-auto rounded-lg bg-black/30 border border-white/10 p-3 cursor-pointer"
      onClick={onClose}
    >
      {!hasAny ? (
        <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
          Inget recept sparat
        </div>
      ) : (
        <div className="grid gap-3" onClick={(e) => e.stopPropagation()}>
          {r!.ingredients?.length > 0 && (
            <Section title="Ingredienser">
              <ul className="grid gap-0.5">
                {r!.ingredients.map((i, idx) => (
                  <li key={idx} className="flex justify-between gap-2">
                    <span className="truncate">{i.name || "—"} <span className="text-muted-foreground/60">({i.type})</span></span>
                    <span className="text-muted-foreground tabular-nums">{i.amount} {i.unit}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {r!.mash_steps?.length > 0 && (
            <Section title="Mäsk">
              <ul className="grid gap-0.5">
                {r!.mash_steps.map((s, idx) => (
                  <li key={idx} className="flex justify-between gap-2">
                    <span className="truncate">{s.note || `Steg ${idx + 1}`}</span>
                    <span className="text-muted-foreground tabular-nums">{s.temp}°C · {s.minutes} min</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {(r!.boil_minutes || r!.boil_additions?.length > 0) && (
            <Section title={`Kok${r!.boil_minutes ? ` · ${r!.boil_minutes} min` : ""}`}>
              <ul className="grid gap-0.5">
                {r!.boil_additions?.map((a, idx) => (
                  <li key={idx} className="flex justify-between gap-2">
                    <span className="truncate">{a.name || "—"}</span>
                    <span className="text-muted-foreground tabular-nums">{a.amount} {a.unit} @ {a.minutes} min</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {(r!.mash_water_liters || r!.sparge_water_liters || r!.water_adjustments?.length > 0) && (
            <Section title="Vatten">
              <div className="flex gap-4">
                {r!.mash_water_liters && <span>Mäsk: <span className="tabular-nums">{r!.mash_water_liters} L</span></span>}
                {r!.sparge_water_liters && <span>Lak: <span className="tabular-nums">{r!.sparge_water_liters} L</span></span>}
              </div>
              {r!.water_adjustments?.length > 0 && (
                <ul className="grid gap-0.5 mt-1">
                  {r!.water_adjustments.map((a, idx) => (
                    <li key={idx} className="flex justify-between gap-2">
                      <span className="truncate">{a.name || "—"} <span className="text-muted-foreground/60">({a.target})</span></span>
                      <span className="text-muted-foreground tabular-nums">{a.amount} {a.unit}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}
          {r!.notes && (
            <Section title="Anteckningar">
              <p className="whitespace-pre-wrap">{r!.notes}</p>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}