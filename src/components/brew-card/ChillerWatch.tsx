import { fmtEta, watchScaleMax, watchStartText, type ChillerWatch as Watch } from "@/lib/chiller-session";

const LINES = [
  { key: "M", label: "normalt", cls: "border-foreground/40" },
  { key: "weak", label: "varning, 3 körningar", cls: "border-amber-400/70" },
  { key: "one", label: "varning, 1 körning", cls: "border-destructive/80" },
] as const;

/** "Kylaren nu": vaktens senaste starter som statiska staplar med nivålinjer. */
export function ChillerWatch({ w }: { w: Watch }) {
  const max = watchScaleMax(w);
  const pct = (v: number) => `${(v / max) * 100}%`;
  const last = w.starts.length - 1;
  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2" data-chiller-watch>
      <div className="text-base font-semibold">Starter (% av normal kylning)</div>
      <div className="relative flex-1 min-h-[120px] mr-[11rem]">
        {LINES.map(({ key, label, cls }) => (
          <div key={key} className={`absolute inset-x-0 border-t border-dashed ${cls}`} style={{ bottom: pct(w.levels[key]) }}>
            <span className="absolute left-full ml-2 -translate-y-1/2 whitespace-nowrap text-sm text-muted-foreground">{label} {Math.round(w.levels[key])} %</span>
          </div>
        ))}
        <div className="absolute inset-0 flex items-end gap-2">
          {w.starts.map((p, i) => (
            <div key={p[0]} className="relative flex-1 h-full flex items-end">
              {p[1] != null && (
                <div className={`w-full rounded-t-md ${i === last ? "bg-primary" : "bg-foreground/30"}`} style={{ height: pct(p[1]) }}>
                  {i === last && <span className="absolute inset-x-0 -translate-y-full pb-0.5 text-center text-base font-bold tabular-nums text-foreground">{Math.round(p[1])}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-2 mr-[11rem] text-sm tabular-nums text-muted-foreground">
        {w.starts.map((p, i) => <span key={p[0]} className={`flex-1 text-center ${i === last ? "font-bold text-foreground" : ""}`}>{fmtEta(p[0])}</span>)}
      </div>
      <div className="text-base font-semibold tabular-nums">{watchStartText(w.starts[last])}</div>
    </div>
  );
}
