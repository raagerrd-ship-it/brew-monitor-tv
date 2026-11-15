import { useId } from "react";
import { bathChartDomains, chartClock, chartLines, chartPath, chartScale, chartTicks, fmtC, fmtTarget, liftChartDomains, showLiftChart, type ChillerSession } from "@/lib/chiller-session";

const LEFT = 36, RIGHT = 350, TOP = 12, BOTTOM = 88;
const COLORS = { 1: "hsl(var(--chiller-bath))", 2: "hsl(var(--chiller-evaporator))", 3: "hsl(var(--chiller-suction))" };
const NAMES = { 1: "Badet", 2: "Förångaren", 3: "Sug" };
const TEST = "hsl(var(--chiller-test))", BASE = "hsl(var(--chiller-baseline))";

export function ChillerCharts({ s, compact }: { s: ChillerSession; compact?: boolean }) {
  const clip = useId();
  const chart = s.chart;
  if (!chart) return null;
  const showBath = chart.series.length >= 2;
  const showLift = showLiftChart(s, compact);
  if (!showBath && !showLift) return null;
  const bath = bathChartDomains(chart, s.stop_c);
  const lift = liftChartDomains(chart, s.bath_from_c);
  const x = (v: number) => chartScale(v, bath.time, LEFT, RIGHT);
  const y = (v: number) => chartScale(v, bath.temperature, BOTTOM, TOP);
  const lx = (v: number) => chartScale(v, lift.degrees, LEFT, RIGHT);
  const ly = (v: number) => chartScale(v, lift.heat, BOTTOM, TOP);
  const lines = chartLines(chart);
  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2" data-chiller-charts>
      {showBath && <section className="flex flex-1 min-h-[110px] flex-col" aria-label="Badet">
        <div className="flex flex-wrap items-center justify-between gap-x-2 text-xs">
          <span className="font-semibold">Badet</span>
          <span className="flex gap-2">{lines.map((i) => <span key={i}><span style={{ color: COLORS[i] }}>●</span> {NAMES[i]}</span>)}</span>
        </div>
        <svg className="w-full flex-1 min-h-0 text-muted-foreground" viewBox="0 0 360 110" preserveAspectRatio="none" role="img" aria-label="Temperatur över tid">
          <defs><clipPath id={`${clip}-bath`}><rect x={LEFT} y={TOP} width={RIGHT - LEFT} height={BOTTOM - TOP} /></clipPath></defs>
          <g clipPath={`url(#${clip}-bath)`}>
            {chart.runs.map(([from, to], i) => <rect key={i} x={x(from)} y={TOP} width={Math.max(0, x(to) - x(from))} height={BOTTOM - TOP} fill="hsl(var(--chiller-run))" />)}
          </g>
          {chartTicks(bath.temperature).map((v) => <g key={v}><line x1={LEFT} x2={RIGHT} y1={y(v)} y2={y(v)} stroke="currentColor" opacity={0.15} /><text x={LEFT - 5} y={y(v) + 3} textAnchor="end" fontSize={10} fill="currentColor">{fmtC(v)}</text></g>)}
          {s.stop_c != null && <g><line x1={LEFT} x2={RIGHT} y1={y(s.stop_c)} y2={y(s.stop_c)} stroke="currentColor" strokeDasharray="4 4" /><text x={RIGHT} y={y(s.stop_c) - 3} textAnchor="end" fontSize={10} fill="currentColor">{fmtTarget(s.stop_c)}°</text></g>}
          <g clipPath={`url(#${clip}-bath)`}>{lines.map((i) => <path key={i} d={chartPath(chart.series.map((p) => [p[0], p[i]]), x, y)} fill="none" stroke={COLORS[i]} strokeWidth={i === 1 ? 2.8 : 1.3} vectorEffect="non-scaling-stroke" />)}</g>
          {s.started_at && chartTicks(bath.time).map((v, i) => <text key={v} x={x(v)} y={105} textAnchor={i === 0 ? "start" : i === 3 ? "end" : "middle"} fontSize={10} fill="currentColor">{chartClock(s.started_at as string, v)}</text>)}
        </svg>
      </section>}
      {showLift && <section className="flex flex-1 min-h-[110px] flex-col" aria-label="Kylarens värme mot baslinjen">
        <div className="text-xs font-semibold">Kylarens värme mot baslinjen</div>
        <div className="flex gap-3 text-xs">
          {!!chart.lift_base?.length && <span><span style={{ color: BASE }}>– –</span> baslinjen</span>}
          {!!chart.lift?.length && <span><span style={{ color: TEST }}>●</span> det här testet</span>}
        </div>
        <svg className="w-full flex-1 min-h-0 text-muted-foreground" viewBox="0 0 360 110" preserveAspectRatio="none" role="img" aria-label="Värme i K mot badtemperatur">
          <defs><clipPath id={`${clip}-lift`}><rect x={LEFT} y={TOP} width={RIGHT - LEFT} height={BOTTOM - TOP} /></clipPath></defs>
          {chartTicks(lift.heat, 2).map((v) => <g key={v}><line x1={LEFT} x2={RIGHT} y1={ly(v)} y2={ly(v)} stroke="currentColor" opacity={0.15} /><text x={LEFT - 5} y={ly(v) + 3} textAnchor="end" fontSize={10} fill="currentColor">{Math.round(v)} K</text></g>)}
          <g clipPath={`url(#${clip}-lift)`}>
            {!!chart.lift_base?.length && <path d={chartPath(chart.lift_base, lx, ly)} fill="none" stroke={BASE} strokeWidth={1.4} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />}
            {!!chart.lift?.length && <><path d={chartPath(chart.lift, lx, ly)} fill="none" stroke={TEST} strokeWidth={2} vectorEffect="non-scaling-stroke" />{chart.lift.map(([a, b], i) => <circle key={i} cx={lx(a)} cy={ly(b)} r={2.5} fill={TEST} />)}</>}
            {s.active && s.bath_c != null && <g><line x1={lx(s.bath_c)} x2={lx(s.bath_c)} y1={TOP} y2={BOTTOM} stroke="currentColor" strokeDasharray="1 3" /><text x={lx(s.bath_c)} y={TOP + 9} textAnchor="middle" fontSize={10} fill="currentColor">nu</text></g>}
          </g>
          {s.active && !chart.lift?.length && <text x={(LEFT + RIGHT) / 2} y={(TOP + BOTTOM) / 2} textAnchor="middle" fontSize={12} fill="currentColor">Läses från minut 20</text>}
          {lift.ticks.map((v) => <text key={v} x={lx(v)} y={105} textAnchor={v === 0 ? "end" : v === lift.degrees[0] ? "start" : "middle"} fontSize={10} fill="currentColor">{v}°</text>)}
        </svg>
      </section>}
    </div>
  );
}