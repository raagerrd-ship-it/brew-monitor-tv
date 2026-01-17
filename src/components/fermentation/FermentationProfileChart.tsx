import { useMemo } from "react";
import {
  Area,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import { FermentationProfileStep, STEP_TYPE_LABELS } from "@/types/fermentation";
import { Activity, Clock, Thermometer } from "lucide-react";

interface FermentationProfileChartProps {
  steps: FermentationProfileStep[];
  compact?: boolean;
}

interface ChartDataPoint {
  hour: number;
  temp: number;
  stepIndex: number;
  stepType: string;
  isWaiting: boolean;
  stepName: string;
}

interface StepAnnotation {
  startHour: number;
  endHour: number;
  stepIndex: number;
  stepType: string;
  label: string;
  temp: number | null;
}

export function FermentationProfileChart({ steps, compact = false }: FermentationProfileChartProps) {
  const { chartData, annotations, totalHours, tempDomain } = useMemo(() => {
    if (!steps || steps.length === 0) {
      return { chartData: [], annotations: [], totalHours: 0, tempDomain: [0, 30] as [number, number] };
    }

    const data: ChartDataPoint[] = [];
    const annots: StepAnnotation[] = [];
    let currentHour = 0;
    let currentTemp = steps[0]?.target_temp ?? 20;
    let minTemp = currentTemp;
    let maxTemp = currentTemp;

    steps.forEach((step, index) => {
      const startHour = currentHour;
      const isWaitingStep = ['wait_for_gravity_stable', 'wait_for_sg', 'wait_for_temp'].includes(step.step_type);
      
      // Estimate duration for waiting steps (for visualization)
      let stepDuration = step.duration_hours ?? 0;
      if (isWaitingStep) {
        if (step.step_type === 'wait_for_gravity_stable') {
          stepDuration = (step.gravity_stable_days ?? 2) * 24;
        } else if (step.step_type === 'wait_for_temp') {
          stepDuration = 2; // Estimate 2 hours to reach temp
        } else if (step.step_type === 'wait_for_sg') {
          stepDuration = 48; // Estimate 48 hours for SG target
        }
      }

      // Ensure minimum duration for visibility
      stepDuration = Math.max(stepDuration, 2);

      const targetTemp = step.target_temp ?? currentTemp;
      
      if (step.step_type === 'ramp') {
        // Ramp: linear temperature change
        const startTemp = currentTemp;
        const endTemp = targetTemp;
        
        // Add start point
        data.push({
          hour: currentHour,
          temp: startTemp,
          stepIndex: index,
          stepType: step.step_type,
          isWaiting: false,
          stepName: STEP_TYPE_LABELS[step.step_type] || step.step_type,
        });

        // Add intermediate points for smooth curve
        const numPoints = Math.max(2, Math.floor(stepDuration / 2));
        for (let i = 1; i <= numPoints; i++) {
          const progress = i / numPoints;
          data.push({
            hour: currentHour + stepDuration * progress,
            temp: startTemp + (endTemp - startTemp) * progress,
            stepIndex: index,
            stepType: step.step_type,
            isWaiting: false,
            stepName: STEP_TYPE_LABELS[step.step_type] || step.step_type,
          });
        }

        currentTemp = endTemp;
        minTemp = Math.min(minTemp, startTemp, endTemp);
        maxTemp = Math.max(maxTemp, startTemp, endTemp);
      } else if (step.step_type === 'hold') {
        // Hold: flat temperature line
        currentTemp = targetTemp;
        
        data.push({
          hour: currentHour,
          temp: currentTemp,
          stepIndex: index,
          stepType: step.step_type,
          isWaiting: false,
          stepName: STEP_TYPE_LABELS[step.step_type] || step.step_type,
        });
        data.push({
          hour: currentHour + stepDuration,
          temp: currentTemp,
          stepIndex: index,
          stepType: step.step_type,
          isWaiting: false,
          stepName: STEP_TYPE_LABELS[step.step_type] || step.step_type,
        });

        minTemp = Math.min(minTemp, currentTemp);
        maxTemp = Math.max(maxTemp, currentTemp);
      } else {
        // Waiting steps: show as dashed/different style
        const tempToUse = targetTemp || currentTemp;
        
        data.push({
          hour: currentHour,
          temp: tempToUse,
          stepIndex: index,
          stepType: step.step_type,
          isWaiting: true,
          stepName: STEP_TYPE_LABELS[step.step_type] || step.step_type,
        });
        data.push({
          hour: currentHour + stepDuration,
          temp: tempToUse,
          stepIndex: index,
          stepType: step.step_type,
          isWaiting: true,
          stepName: STEP_TYPE_LABELS[step.step_type] || step.step_type,
        });

        currentTemp = tempToUse;
        minTemp = Math.min(minTemp, tempToUse);
        maxTemp = Math.max(maxTemp, tempToUse);
      }

      // Add annotation
      annots.push({
        startHour,
        endHour: currentHour + stepDuration,
        stepIndex: index,
        stepType: step.step_type,
        label: step.notes || STEP_TYPE_LABELS[step.step_type] || step.step_type,
        temp: step.target_temp,
      });

      currentHour += stepDuration;
    });

    // Add padding to temp domain
    const tempPadding = Math.max(2, (maxTemp - minTemp) * 0.1);
    
    return {
      chartData: data,
      annotations: annots,
      totalHours: currentHour,
      tempDomain: [Math.floor(minTemp - tempPadding), Math.ceil(maxTemp + tempPadding)] as [number, number],
    };
  }, [steps]);

  if (!steps || steps.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <p>Lägg till steg för att se profilen</p>
      </div>
    );
  }

  const formatHour = (hour: number) => {
    if (hour < 24) return `${Math.round(hour)}h`;
    const days = Math.floor(hour / 24);
    const hours = Math.round(hour % 24);
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  };

  const getStepColor = (stepType: string) => {
    switch (stepType) {
      case 'ramp': return 'hsl(38 92% 50%)'; // amber
      case 'hold': return 'hsl(var(--primary))';
      case 'wait_for_gravity_stable': return 'hsl(142 71% 45%)'; // green
      case 'wait_for_sg': return 'hsl(142 71% 45%)';
      case 'wait_for_temp': return 'hsl(217 91% 60%)'; // blue
      default: return 'hsl(var(--muted-foreground))';
    }
  };

  const chartHeight = compact ? 120 : 200;

  return (
    <div className="w-full flex flex-col">
      <div style={{ height: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 5 }}>
            {/* Background areas for each step */}
            {annotations.map((annot, idx) => (
              <ReferenceArea
                key={`area-${idx}`}
                x1={annot.startHour}
                x2={annot.endHour}
                fill={getStepColor(annot.stepType)}
                fillOpacity={0.08}
                stroke="none"
              />
            ))}

            {/* Step separator lines */}
            {annotations.slice(1).map((annot, idx) => (
              <ReferenceLine
                key={`sep-${idx}`}
                x={annot.startHour}
                stroke="hsl(var(--border))"
                strokeDasharray="3 3"
                strokeOpacity={0.5}
              />
            ))}

            <XAxis
              dataKey="hour"
              type="number"
              domain={[0, totalHours]}
              stroke="hsl(var(--muted-foreground))"
              style={{ fontSize: compact ? "9px" : "10px" }}
              tick={{ fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={formatHour}
              tickCount={compact ? 4 : 6}
            />

            <YAxis
              domain={tempDomain}
              stroke="hsl(var(--temp-blue))"
              style={{ fontSize: compact ? "9px" : "10px" }}
              tick={{ fill: "hsl(var(--temp-blue))" }}
              tickFormatter={(value) => `${value}°`}
              tickCount={compact ? 3 : 5}
            />

            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
                color: "hsl(var(--foreground))",
                padding: "8px 12px",
                boxShadow: "0 4px 12px hsl(0 0% 0% / 0.2)",
              }}
              labelFormatter={(hour) => formatHour(Number(hour))}
              formatter={(value: number, name: string, props: any) => {
                const point = props.payload as ChartDataPoint;
                return [
                  <div key="tooltip" className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Thermometer className="w-3 h-3" style={{ color: getStepColor(point.stepType) }} />
                      <span className="font-medium">{value.toFixed(1)}°C</span>
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      {point.isWaiting ? <Activity className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                      {point.stepName}
                    </div>
                  </div>,
                  ''
                ];
              }}
            />

            {/* Temperature area fill */}
            <Area
              type="monotone"
              dataKey="temp"
              stroke="none"
              fill="hsl(var(--temp-blue) / 0.15)"
              activeDot={false}
            />

            {/* Temperature line */}
            <Line
              type="monotone"
              dataKey="temp"
              stroke="hsl(var(--temp-blue))"
              strokeWidth={2.5}
              dot={false}
              activeDot={{
                r: 5,
                fill: "hsl(var(--temp-blue))",
                stroke: "hsl(var(--background))",
                strokeWidth: 2,
              }}
              style={{
                filter: "drop-shadow(0 0 4px hsl(var(--temp-blue) / 0.4))"
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Step legend - scrollable on mobile */}
      {!compact && (
        <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-3 px-1 max-h-24 overflow-y-auto">
          {annotations.map((annot, idx) => (
            <div
              key={`legend-${idx}`}
              className="flex items-center gap-1 sm:gap-1.5 text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-md shrink-0"
              style={{
                background: `${getStepColor(annot.stepType)}15`,
                border: `1px solid ${getStepColor(annot.stepType)}30`,
              }}
            >
              <span
                className="w-1.5 sm:w-2 h-1.5 sm:h-2 rounded-full shrink-0"
                style={{ background: getStepColor(annot.stepType) }}
              />
              <span className="font-medium shrink-0" style={{ color: getStepColor(annot.stepType) }}>
                {idx + 1}.
              </span>
              <span className="text-muted-foreground truncate max-w-[60px] sm:max-w-[120px]">
                {annot.label}
              </span>
              {annot.temp !== null && (
                <span className="text-muted-foreground/70 shrink-0">
                  ({annot.temp}°)
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}