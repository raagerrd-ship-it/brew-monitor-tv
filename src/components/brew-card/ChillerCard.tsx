import { memo } from "react";
import { AlertTriangle, Snowflake } from "lucide-react";
import { Card } from "@/components/ui/card";
import { RollingNumber } from "@/components/RollingNumber";
import { ChillerCharts } from "./ChillerCharts";
import { chillerTitle, fmtC, fmtEta, fmtTarget, fmtRate, LEVEL_LABEL, type ChillerSession } from "@/lib/chiller-session";

const LEVEL_STYLE: Record<string, string> = {
  fill: "border-green-400/40 bg-green-500/20 text-green-300",
  stop: "border-destructive/50 bg-destructive/20 text-destructive",
};

export const ChillerCard = memo(function ChillerCard({ s, hasAlbumArtBackground, compact }: { s: ChillerSession; hasAlbumArtBackground?: boolean; compact?: boolean }) {
  const level = s.level ? LEVEL_LABEL[s.level] : null;
  const text = s.ended_at ? s.result : null;
  const badge = "shrink-0 rounded-full border px-3 py-1 text-sm font-semibold";
  return (
    <Card
      className={`relative border-white/15 h-full w-full overflow-hidden flex flex-col ${compact ? "p-4 gap-2" : "p-5 gap-3"}`}
      style={{ background: hasAlbumArtBackground ? 'hsl(222 18% 15% / 0.75)' : 'hsl(222 18% 15%)', boxShadow: 'none' }}
    >
      {s.warnings.map((w, i) => (
        <div key={i} className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/15 px-3 py-1.5 text-base font-semibold text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-1" /><span className="line-clamp-3">{w}</span>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <div className={`shrink-0 flex items-center justify-center rounded-xl bg-foreground/10 ${compact ? "h-9 w-9" : "h-11 w-11"}`}>
          <Snowflake className={`${compact ? "h-5 w-5" : "h-6 w-6"} ${s.compressor_on ? "text-accent" : "text-muted-foreground"}`} style={{ opacity: s.compressor_on ? 1 : 0.3 }} aria-label={`Kompressor: ${s.compressor_on ? "PÅ" : "AV"}`} />
        </div>
        <div className={`min-w-0 flex-1 font-bold uppercase text-muted-foreground truncate ${compact ? "text-xs tracking-[0.12em]" : "text-base tracking-[0.2em]"}`}>{chillerTitle(s.kind)}</div>
        {s.chiller_locked && <span className={`${badge} border-destructive/50 bg-destructive/20 text-destructive`}>Spärrad</span>}
        {level && <span className={`${badge} ${LEVEL_STYLE[s.level!] ?? "border-primary/30 bg-primary/15 text-primary"}`}>{level}</span>}
      </div>
      {s.bath_c != null && (
        <div>
          <div className={`${compact ? "text-5xl" : "text-6xl"} font-bold tracking-tight`}><RollingNumber value={s.bath_c} decimals={1} decimalSeparator="," suffix="°" /></div>
          {(s.bath_from_c != null || s.stop_c != null) && (
            <div className="text-lg text-muted-foreground mt-1">från {s.bath_from_c != null ? fmtC(s.bath_from_c) : "—"}° → {s.stop_c != null ? fmtTarget(s.stop_c) : "—"}°</div>
          )}
        </div>
      )}
      {(s.rate_c_min != null || (s.eta_at && s.stop_c != null)) && (
        <div className="flex gap-4 text-lg font-semibold tabular-nums whitespace-nowrap">
          {s.rate_c_min != null && <span>{fmtRate(s.rate_c_min)}</span>}
          {s.eta_at && s.stop_c != null && <span>{fmtTarget(s.stop_c)}° ca {fmtEta(s.eta_at)}</span>}
        </div>
      )}
      {s.kind === "test" && s.after_runs_done != null && (
        <div className="flex items-center gap-2 text-base">
          <span>Efterkörning {Math.min(s.after_runs_done, 2)} av 2</span>
          {[0, 1].map((i) => <span key={i} className={`h-2.5 w-2.5 rounded-full ${i < s.after_runs_done! ? "bg-primary" : "bg-muted-foreground/30"}`} />)}
        </div>
      )}
      {s.lift_pct != null && <div className="text-base text-muted-foreground">Kylarens värme {s.lift_pct} % av baslinjen</div>}
      <ChillerCharts s={s} compact={compact} />
      {text && <div className="text-sm text-muted-foreground line-clamp-3 mt-auto">{text}</div>}
    </Card>
  );
});
