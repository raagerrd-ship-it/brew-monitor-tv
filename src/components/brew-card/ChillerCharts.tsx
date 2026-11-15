import { useEffect, useId, useRef, useState } from "react";
import { bathChartDomains, chartClock, chartLines, chartPath, chartScale, chartTicks, fmtC, fmtTarget, liftChartDomains, showLiftChart, type ChillerSession } from "@/lib/chiller-session";

const LEFT = 42, TOP = 14;
const COLORS = { 1: "hsl(var(--chiller-bath))", 2: "hsl(var(--chiller-evaporator))", 3: "hsl(var(--chiller-suction))" };
const NAMES = { 1: "Badet", 2: "Förångaren", 3: "Sug" };
const TEST = "hsl(var(--chiller-test))", BASE = "hsl(var(--chiller-baseline))";

export function ChillerCharts({ s, compact }: { s: ChillerSession; compact?: boolean }) {
  const clip = useId();
  const container = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState([{ width: 360, height: 110 }, { width: 360, height: 110 }]);
  useEffect(() => {
    const svgs = container.current?.querySelectorAll("svg");
    if (!svgs?.length) return;
    const observer = new ResizeObserver(() => {
      setSizes(Array.from(svgs, (svg) => ({ width: svg.clientWidth, height: svg.clientHeight })));
    });
    svgs.forEach((svg) => observer.observe(svg));
    return () => observer.disconnect();
  }, [s.chart != null, (s.chart?.series.length ?? 0) >= 2, showLiftChart(s, compact)]);
  const chart = s.chart;
  if (!chart) return null;
  const showBath = chart.series.length >= 2;
  const showLift = showLiftChart(s, compact);
  if (!showBath && !showLift) return null;
  const bathSize = sizes[0] ?? { width: 360, height: 110 };
  const liftSize = sizes[showBath ? 1 : 0] ?? bathSize;
  const RIGHT = bathSize.width - 12, BOTTOM = bathSize.height - 22;
  const LRIGHT = liftSize.width - 12, LBOTTOM = liftSize.height - 22;
  const bath = bathChartDomains(chart, s.stop_c);
  const lift = liftChartDomains(chart, s.bath_from_c);
  const x = (v: number) => chartScale(v, bath.time, LEFT, RIGHT);
  const y = (v: number) => chartScale(v, bath.temperature, BOTTOM, TOP);
  const lx = (v: number) => chartScale(v, lift.degrees, LEFT, LRIGHT);
  const ly = (v: number) => chartScale(v, lift.heat, LBOTTOM, TOP);
  const lines = chartLines(chart);
  return (
    <div ref={container} className="flex flex-1 min-h-0 flex-col gap-2" data-chiller-charts>
      {showBath && <section className="flex flex-1 min-h-[110px] flex-col" aria-label="Badet">
        <div className="flex flex-wrap items-center justify-between gap-x-2 text-xs">
          <span className="font-semibold">Badet</span>
          <span className="flex gap-2">{lines.map((i) => <span key={i}><span style={{ color: COLORS[i] }}>●</span> {NAMES[i]}</span>)}</span>
        </div>
        <svg className="w-full flex-1 min-h-0 text-muted-foreground" viewBox={`0 0 ${bathSize.width} ${bathSize.height}`} role="img" aria-label="Temperatur över tid">
          <defs><clipPath id={`${clip}-bath`}><rect x={LEFT} y={TOP} width={RIGHT - LEFT} height={BOTTOM - TOP} /></clipPath></defs>
          <g clipPath={`url(#${clip}-bath)`}>
            {chart.runs.map(([from, to], i) => <rect key={i} x={x(from)} y={TOP} width={Math.max(0, x(to) - x(from))} height={BOTTOM - TOP} fill="hsl(var(--chiller-run))" />)}
          </g>
          {chartTicks(bath.temperature).map((v) => <g key={v}><line x1={LEFT} x2={RIGHT} y1={y(v)} y2={y(v)} stroke="currentColor" opacity={0.15} /><text x={LEFT - 5} y={y(v) + 3} textAnchor="end" fontSize={11} fill="currentColor">{fmtC(v)}</text></g>)}
          {s.stop_c != null && <g><line x1={LEFT} x2={RIGHT} y1={y(s.stop_c)} y2={y(s.stop_c)} stroke="currentColor" strokeDasharray="4 4" /><text x={RIGHT} y={y(s.stop_c) - 3} textAnchor="end" fontSize={11} fill="currentColor">{fmtTarget(s.stop_c)}°</text></g>}
          <g clipPath={`url(#${clip}-bath)`}>{lines.map((i) => <path key={i} d={chartPath(chart.series.map((p) => [p[0], p[i]]), x, y)} fill="none" stroke={COLORS[i]} strokeWidth={i === 1 ? 2.8 : 1.3} vectorEffect="non-scaling-stroke" />)}</g>
          {s.started_at && chartTicks(bath.time).map((v, i) => <text key={v} x={x(v)} y={bathSize.height - 5} textAnchor={i === 0 ? "start" : i === 3 ? "end" : "middle"} fontSize={11} fill="currentColor">{chartClock(s.started_at ?? "", v)}</text>)}
        </svg>
      </section>}
      {showLift && <section className="flex flex-1 min-h-[110px] flex-col" aria-label="Kylarens värme mot baslinjen">
        <div className="text-xs font-semibold">Kylarens värme mot baslinjen</div>
        <div className="flex gap-3 text-xs">
          {!!chart.lift_base?.length && <span><span style={{ color: BASE }}>– –</span> baslinjen</span>}
          {!!chart.lift?.length && <span><span style={{ color: TEST }}>●</span> det här testet</span>}
        </div>
        <svg className="w-full flex-1 min-h-0 text-muted-foreground" viewBox={`0 0 ${liftSize.width} ${liftSize.height}`} role="img" aria-label="Värme i K mot badtemperatur">
          <defs><clipPath id={`${clip}-lift`}><rect x={LEFT} y={TOP} width={LRIGHT - LEFT} height={LBOTTOM - TOP} /></clipPath></defs>
          {chartTicks(lift.heat, 2).map((v) => <g key={v}><line x1={LEFT} x2={LRIGHT} y1={ly(v)} y2={ly(v)} stroke="currentColor" opacity={0.15} /><text x={LEFT - 5} y={ly(v) + 3} textAnchor="end" fontSize={11} fill="currentColor">{Math.round(v)} K</text></g>)}
          <g clipPath={`url(#${clip}-lift)`}>
            {!!chart.lift_base?.length && <path d={chartPath(chart.lift_base, lx, ly)} fill="none" stroke={BASE} strokeWidth={1.4} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />}
            {!!chart.lift?.length && <><path d={chartPath(chart.lift, lx, ly)} fill="none" stroke={TEST} strokeWidth={2} vectorEffect="non-scaling-stroke" />{chart.lift.map(([a, b], i) => <circle key={i} cx={lx(a)} cy={ly(b)} r={2.5} fill={TEST} />)}</>}
            {s.active && s.bath_c != null && <g><line x1={lx(s.bath_c)} x2={lx(s.bath_c)} y1={TOP} y2={LBOTTOM} stroke="currentColor" strokeDasharray="1 3" /><text x={lx(s.bath_c)} y={TOP + 9} textAnchor="middle" fontSize={11} fill="currentColor">nu</text></g>}
          </g>
          {s.active && !chart.lift?.length && <text x={(LEFT + LRIGHT) / 2} y={(TOP + LBOTTOM) / 2} textAnchor="middle" fontSize={12} fill="currentColor">Läses från minut 20</text>}
          {lift.ticks.map((v) => <text key={v} x={lx(v)} y={liftSize.height - 5} textAnchor={v === 0 ? "end" : v === lift.degrees[0] ? "start" : "middle"} fontSize={11} fill="currentColor">{v}°</text>)}
        </svg>
      </section>}
    </div>
  );
}