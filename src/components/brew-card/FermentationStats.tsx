import { memo, useLayoutEffect, useRef } from "react";
import { BrewData, TempController } from "@/types/brew";
import { RollingNumber } from "@/components/RollingNumber";
import { Button } from "@/components/ui/button";
import { DeviceMatch } from "./types";
import { toDutyPct } from "./utils";
import { getDisplayTarget } from "@/lib/temp-display";
import { gravityPanelData, tempScalePosition, tempIsOffTarget } from "./stat-panel-data";

interface Props {
  brew: BrewData;
  devices: DeviceMatch;
  compact?: boolean;
  hideReadyToCrash?: boolean;
  onSyncedDataClick?: () => void;
  onControllerClick?: (controller: TempController) => void;
}

const fmtTemp = (value: number) => `${value.toFixed(1).replace(".", ",")}°`;

function FitValue({ children }: { children: React.ReactNode }) {
  return <span className="stat-panel-value-fit">{children}</span>;
}
const segment = (from: number, to: number) => ({ transform: `translateX(${from}%) scaleX(${Math.max(0, to - from) / 100})` });
const position = (pct: number) => ({ transform: `translateX(${pct}%)` });

function FermentationStatsComponent({ brew, devices, compact = false, hideReadyToCrash, onSyncedDataClick, onControllerClick }: Props) {
  const { controller } = devices;
  const gravity = gravityPanelData(brew, hideReadyToCrash);
  const displayTemp = brew.frozen ? brew.currentTemp : controller?.actual_temp ?? null;
  const probe = controller?.pt100_temp ?? null;
  const pill = controller?.pill_temp ?? null;
  const stale = !controller?.last_update || Date.now() - new Date(controller.last_update).getTime() > 30 * 60 * 1000;
  const profileTarget = controller?.profile_target_temp ?? brew.fermentationSession?.controller_profile_target_temp ?? null;
  const { actualTarget } = getDisplayTarget(profileTarget, controller?.profile_target_temp ?? controller?.target_temp);
  const target = actualTarget ?? controller?.target_temp ?? null;
  const duty = toDutyPct(brew.dutyPct);
  const heating = brew.dutyMode === "heating";
  const sensors = [probe, pill].filter((value): value is number => value !== null);
  const from = target !== null && sensors.length > 0 ? tempScalePosition(Math.min(...sensors), target) : 50;
  const to = target !== null && sensors.length > 0 ? tempScalePosition(Math.max(...sensors), target) : 50;
  const clickable = brew.batch_id.startsWith("custom_") && !!onSyncedDataClick;
  const tempClick = controller && onControllerClick ? () => onControllerClick(controller) : undefined;
  const valueClass = "stat-panel-value";
  const panelRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const values = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(".stat-panel-value-fit") ?? []);
    values.forEach((el) => { el.style.fontSize = ""; });
    let factor = 1;
    for (const el of values) {
      const column = el.closest(".stat-panel-column");
      if (!column) continue;
      const styles = getComputedStyle(column);
      const available = column.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
      if (el.scrollWidth > available && el.scrollWidth > 0) factor = Math.min(factor, available / el.scrollWidth);
    }
    if (factor < 1) values.forEach((el) => { el.style.fontSize = `${Math.floor(factor * 100)}%`; });
  });

  const gravityContent = <>
    <span className="stat-panel-label">Gravity</span>
    <span className={`${valueClass} text-primary`}><FitValue><RollingNumber value={brew.currentSG} decimals={4} mutedLastDigit /></FitValue></span>
    <span className={`stat-panel-detail ${gravity.ready ? "text-temp-blue" : gravity.stalled ? "text-destructive" : "text-muted-foreground/80"}`}>
      {gravity.ready ? "🧊 vid FG" : gravity.prePitch ? "väntar på jäst" : gravity.stalled ? "står still" : gravity.pointsPerDay !== null ? `−${gravity.pointsPerDay} p/dygn` : "\u00a0"}
    </span>
  </>;
  const tempContent = <>
    <span className="stat-panel-label">Temp</span>
    <span className={`${valueClass} ${tempIsOffTarget(displayTemp, target) ? "text-primary" : "text-foreground"}`}>
      <FitValue>{displayTemp === null ? "—" : <RollingNumber value={displayTemp} decimals={1} suffix={<span className="opacity-40">°</span>} />}</FitValue>
    </span>
    <span className="stat-panel-detail flex flex-wrap w-full gap-x-1 text-muted-foreground/80">
      {target !== null && <span className="whitespace-nowrap">mål <span className="text-primary">{fmtTemp(target)}</span></span>}
      {duty > 0 && <span className={`whitespace-nowrap ${heating ? "text-destructive" : "text-temp-blue"}`}>{target !== null && " · "}{heating ? "värme" : "kyla"} {duty} %</span>}
    </span>
  </>;

  return <div className={`fermentation-stats ${compact ? "stat-panel-compact" : ""}`} data-stat-panel ref={panelRef}>
    <div className="stat-panel-columns">
      {clickable ? <Button variant="ghost" className="stat-panel-column stat-panel-control" onClick={onSyncedDataClick} title="Visa synkad data">{gravityContent}</Button> : <div className="stat-panel-column">{gravityContent}</div>}
      <div className="stat-panel-column border-l border-foreground/10">
        <span className="stat-panel-label">ABV</span>
        <span className={`${valueClass} text-primary`}><FitValue><RollingNumber value={brew.abv} decimals={1} suffix={<span className="text-[0.6em] opacity-40">%</span>} /></FitValue></span>
        <span className="stat-panel-detail text-muted-foreground/80"><span className="text-ferment-green font-bold">{Math.round(brew.attenuation)} %</span> utjäst</span>
      </div>
      {tempClick ? <Button variant="ghost" className="stat-panel-column stat-panel-control border-l border-foreground/10" onClick={tempClick}>{tempContent}</Button> : <div className="stat-panel-column border-l border-foreground/10">{tempContent}</div>}
    </div>
    <div className="stat-panel-scale">
      <div className={`stat-panel-track h-[10px] ${gravity.stalled ? "ring-1 ring-destructive" : ""}`}>
        <div className="stat-panel-layer stat-panel-gravity-fill" style={segment(0, gravity.progress)} />
        {gravity.projected > gravity.progress && <div className="stat-panel-layer stat-panel-ghost" style={segment(gravity.progress, gravity.projected)} />}
        <div className="stat-panel-layer" style={position(gravity.progress)}><span className={`stat-panel-dot h-[10px] w-[10px] ${gravity.ready ? "bg-temp-blue" : "bg-primary"}`} /></div>
      </div>
      <div className="stat-panel-detail flex justify-between text-muted-foreground/80"><span>{brew.originalGravity.toFixed(3)}</span><span className={gravity.ready ? "text-temp-blue" : ""}>{brew.finalGravity.toFixed(3)}</span></div>
    </div>
    <div className="stat-panel-scale">
      <div className="stat-panel-track h-[6px] !overflow-visible" style={{ clipPath: "inset(-8px 0 -8px 0)" }}>
        {sensors.length > 0 && target !== null && <div className="stat-panel-layer rounded-full bg-temp-blue/70" style={segment(from, to)} />}
        {displayTemp !== null && target !== null && <div className="stat-panel-layer" style={position(tempScalePosition(displayTemp, target))}><span className="stat-panel-dot h-[10px] w-[10px] bg-foreground" /></div>}
        {target !== null && <div className="stat-panel-layer" style={position(50)}><span className="absolute left-0 top-1/2 h-[16px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary" /></div>}
      </div>
      <div className="stat-panel-sensor-labels stat-panel-detail text-muted-foreground/80" style={{ gridTemplateColumns: `${Math.max(15, Math.min(85, from))}% ${Math.max(0, Math.max(15, Math.min(85, to)) - Math.max(15, Math.min(85, from)))}% ${100 - Math.max(15, Math.min(85, to))}%` }}>
        {probe !== null && <span className="stat-panel-probe">{fmtTemp(probe)}</span>}
        {pill !== null && <span className={`stat-panel-pill ${stale ? "opacity-40" : ""}`}>{fmtTemp(pill)}</span>}
      </div>
    </div>
  </div>;
}

export const FermentationStats = memo(FermentationStatsComponent);