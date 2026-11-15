import { useEffect, useId, useRef, useState } from "react";
import { bathChartDomains, chartClock, chartLines, chartPath, chartScale, chartTicks, fmtTarget, liftChartDomains, showLiftChart, type ChillerSession } from "@/lib/chiller-session";

const LEFT = 64, TOP = 22;
const COLORS = { 1: "hsl(var(--chiller-bath))", 2: "hsl(var(--chiller-evaporator))", 3: "hsl(var(--chiller-suction))" };
const NAMES = { 1: "Badet", 2: "Förångaren", 3: "Sug" };
const TEST = "hsl(var(--chiller-test))", BASE = "hsl(var(--chiller-baseline))";

export function ChillerCharts({ s }: { s: ChillerSession; compact?: boolean }) {
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
  }, [s.chart != null, (s.chart?.series.length ?? 0) >= 2, showLiftChart(s)]);
  const chart = s.chart;
  if (!chart) return null;
  const showBath = chart.series.length >= 2;
  const showLift = showLiftChart(s);
  if (!showBath && !showLift) return null;
  const bathSize = sizes[0] ?? { width: 360, height: 110 };
  const liftSize = sizes[showBath ? 1 : 0] ?? bathSize;
  const RIGHT = bathSize.width - 22, BOTTOM = bathSize.height - 30;
  const LRIGHT = liftSize.width - 22, LBOTTOM = liftSize.height - 30;
  const bath = bathChartDomains(chart, s.stop_c);
  const lift = liftChartDomains(chart);
  const latest = chart.lift_t?.[chart.lift_t.length - 1];
  const x = (v: number) => chartScale(v, bath.time, LEFT, RIGHT);
  const y = (v: number) => chartScale(v, bath.temperature, BOTTOM, TOP);
  const lx = (v: number) => chartScale(v, lift.minutes, LEFT, LRIGHT);
  const ly = (v: number) => chartScale(v, lift.heat, LBOTTOM, TOP);
  const lines = chartLines(chart);
  return (
    <div ref={container} className="flex flex-1 min-h-0 flex-col gap-2" data-chiller-charts>
      {showBath && <section className="flex flex-1 min-h-[110px] flex-col" aria-label="Badet">
        <div className="flex flex-wrap items-center justify-between gap-x-2 text-base">
          <span className="font-semibold">Badet</span>
          <span className="flex gap-2">{lines.map((i) => <span key={i}><span style={{ color: COLORS[i] }}>●</span> {NAMES[i]}</span>)}</span>
        </div>
        <svg className="w-full flex-1 min-h-0 text-muted-foreground" viewBox={`0 0 ${bathSize.width} ${bathSize.height}`} role="img" aria-label="Temperatur över tid">
          <defs><clipPath id={`${clip}-bath`}><rect x={LEFT} y={TOP} width={RIGHT - LEFT} height={BOTTOM - TOP} /></clipPath></defs>
          <g clipPath={`url(#${clip}-bath)`}>
            {chart.runs.map(([from, to], i) => <rect key={i} x={x(from)} y={TOP} width={Math.max(0, x(to) - x(from))} height={BOTTOM - TOP} fill="hsl(var(--chiller-run))" />)}
          </g>
          {bath.ticks.map((v) => <g key={v}><line x1={LEFT} x2={RIGHT} y1={y(v)} y2={y(v)} stroke="currentColor" opacity={0.15} /><text x={LEFT - 5} y={y(v) + 5} textAnchor="end" fontSize={15} fill="currentColor">{fmtTarget(v)}°</text></g>)}
          {s.stop_c != null && <g><line x1={LEFT} x2={RIGHT} y1={y(s.stop_c)} y2={y(s.stop_c)} stroke="currentColor" strokeDasharray="4 4" /><text x={RIGHT} y={y(s.stop_c) - 3} textAnchor="end" fontSize={15} fill="currentColor">{fmtTarget(s.stop_c)}°</text></g>}
          <g clipPath={`url(#${clip}-bath)`}>{lines.map((i) => <path key={i} d={chartPath(chart.series.map((p) => [p[0], p[i]]), x, y)} fill="none" stroke={COLORS[i]} strokeWidth={i === 1 ? 2.8 : 1.3} vectorEffect="non-scaling-stroke" />)}</g>
          {s.started_at && chartTicks(bath.time).map((v, i) => <text key={v} x={x(v)} y={bathSize.height - 5} textAnchor={i === 0 ? "start" : i === 3 ? "end" : "middle"} fontSize={15} fill="currentColor">{chartClock(s.started_at ?? "", v)}</text>)}
        </svg>
      </section>}
      {showLift && <section className="flex flex-1 min-h-[110px] flex-col" aria-label="Utblås − inluft mot förra testet">
        <div className="text-base font-semibold">Utblås − inluft mot förra testet</div>
        <div className="flex gap-3 text-base">
          {!!chart.lift_base_t?.length && <span><span style={{ color: BASE }}>– –</span> förra testet</span>}
          {!!chart.lift_t?.length && <span><span style={{ color: TEST }}>●</span> det här testet</span>}
        </div>
        <svg className="w-full flex-1 min-h-0 text-muted-foreground" viewBox={`0 0 ${liftSize.width} ${liftSize.height}`} role="img" aria-label="Utblås minus inluft i K per minut">
          <defs><clipPath id={`${clip}-lift`}><rect x={LEFT} y={TOP} width={LRIGHT - LEFT} height={LBOTTOM - TOP} /></clipPath></defs>
          {lift.heatTicks.map((v) => <g key={v}><line x1={LEFT} x2={LRIGHT} y1={ly(v)} y2={ly(v)} stroke="currentColor" opacity={0.15} /><text x={LEFT - 5} y={ly(v) + 5} textAnchor="end" fontSize={15} fill="currentColor">{Math.round(v)} K</text></g>)}
          <g clipPath={`url(#${clip}-lift)`}>
            {!!chart.lift_base_t?.length && <path d={chartPath(chart.lift_base_t, lx, ly)} fill="none" stroke={BASE} strokeWidth={1.4} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />}
            {!!chart.lift_t?.length && <path d={chartPath(chart.lift_t, lx, ly)} fill="none" stroke={TEST} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />}
          </g>
          {latest && <circle cx={lx(latest[0])} cy={ly(latest[1])} r={3.5} fill={TEST} />}
          {lift.ticks.map((v, i) => <text key={v} x={lx(v)} y={liftSize.height - 5} textAnchor={i === 0 ? "start" : i === lift.ticks.length - 1 && lx(v) > LRIGHT - 30 ? "end" : "middle"} fontSize={15} fill="currentColor">{i === lift.ticks.length - 1 ? `${v} min` : v}</text>)}
        </svg>
      </section>}
    </div>
  );
}