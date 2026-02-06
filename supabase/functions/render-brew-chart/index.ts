import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Chart dimensions - viewBox for scalability
const WIDTH = 600;
const HEIGHT_FULL = 300;    // No fermentation session visible
const HEIGHT_COMPACT = 220; // With fermentation session (less vertical space)
const MARGIN = { top: 20, right: 15, bottom: 30, left: 50 };

// Colors matching desktop chartConfig.ts (CSS variables resolved)
// --beer-amber: 38 90% 60% → #e8a225
// --temp-blue: 200 70% 50% → #268bd2
const COLORS = {
  sgLine: '#e8a225',         // beer-amber
  sgGlow: '#e8a22599',       // beer-amber glow
  controllerArea: '#268bd214', // temp-blue 0.08
  controllerLine: '#268bd2',   // temp-blue
  targetLine: '#268bd280',     // temp-blue 0.5
  pillTempLine: '#268bd24d',   // temp-blue 0.3
  grid: '#3a3d4e',
  axisText: '#6b7280',
};

interface SgDataPoint {
  date: string;
  value: number;
  temp?: number;
}

interface TempHistoryPoint {
  recorded_at: string;
  current_temp: number;
  target_temp: number;
}

// Downsample array to max N points
function downsample<T>(data: T[], maxPoints: number, getX: (d: T) => number, getY: (d: T) => number): T[] {
  if (data.length <= maxPoints) return data;
  
  const sampled: T[] = [data[0]];
  const bucketSize = (data.length - 2) / (maxPoints - 2);
  
  for (let i = 0; i < maxPoints - 2; i++) {
    const start = Math.floor(i * bucketSize) + 1;
    const end = Math.min(Math.floor((i + 1) * bucketSize) + 1, data.length - 1);
    const mid = Math.floor((start + end) / 2);
    sampled.push(data[mid]);
  }
  
  sampled.push(data[data.length - 1]);
  return sampled;
}

// Moving average smoothing (matches desktop getOptimalWindowSize + calculateMovingAverage)
function smoothData(values: number[], windowSize: number): number[] {
  if (windowSize < 2) return values;
  const halfWindow = Math.floor(windowSize / 2);
  const result: number[] = new Array(values.length);
  
  let sum = 0;
  const firstEnd = Math.min(values.length, halfWindow + 1);
  for (let j = 0; j < firstEnd; j++) sum += values[j];
  
  for (let i = 0; i < values.length; i++) {
    if (i > 0) {
      const newIdx = i + halfWindow;
      if (newIdx < values.length) sum += values[newIdx];
      const oldIdx = i - halfWindow - 1;
      if (oldIdx >= 0) sum -= values[oldIdx];
    }
    const windowStart = Math.max(0, i - halfWindow);
    const windowEnd = Math.min(values.length, i + halfWindow + 1);
    result[i] = sum / (windowEnd - windowStart);
  }
  return result;
}

// scaleX and scaleY are defined inside generateChartSvg to close over dynamic PLOT_W/PLOT_H

// Build smooth SVG path using monotone cubic interpolation (matches Recharts monotoneX)
function buildSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  if (points.length === 2) return `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)} L${points[1].x.toFixed(1)},${points[1].y.toFixed(1)}`;
  
  // Monotone cubic Hermite spline (Fritsch-Carlson)
  const n = points.length;
  const dx: number[] = [];
  const dy: number[] = [];
  const m: number[] = [];
  
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1].x - points[i].x);
    dy.push(points[i + 1].y - points[i].y);
    m.push(dx[i] === 0 ? 0 : dy[i] / dx[i]);
  }
  
  // Compute tangents
  const tangents: number[] = new Array(n);
  tangents[0] = m[0];
  tangents[n - 1] = m[n - 2];
  
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) {
      tangents[i] = 0;
    } else {
      tangents[i] = (m[i - 1] + m[i]) / 2;
    }
  }
  
  // Fritsch-Carlson monotonicity
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(m[i]) < 1e-10) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
    } else {
      const alpha = tangents[i] / m[i];
      const beta = tangents[i + 1] / m[i];
      const s = alpha * alpha + beta * beta;
      if (s > 9) {
        const tau = 3 / Math.sqrt(s);
        tangents[i] = tau * alpha * m[i];
        tangents[i + 1] = tau * beta * m[i];
      }
    }
  }
  
  // Build cubic bezier path
  let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const seg = dx[i] / 3;
    const cp1x = points[i].x + seg;
    const cp1y = points[i].y + tangents[i] * seg;
    const cp2x = points[i + 1].x - seg;
    const cp2y = points[i + 1].y - tangents[i + 1] * seg;
    d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${points[i + 1].x.toFixed(1)},${points[i + 1].y.toFixed(1)}`;
  }
  return d;
}

// Build straight-line SVG path
function buildPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

// Build step-after path (for target temp)
function buildStepPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` H${points[i].x.toFixed(1)} V${points[i].y.toFixed(1)}`;
  }
  return d;
}

// Format day label
function formatDay(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function generateChartSvg(
  sgData: SgDataPoint[],
  og: number,
  fg: number,
  tempHistory: TempHistoryPoint[] | null,
  compact: boolean = false,
): string {
  const HEIGHT = compact ? HEIGHT_COMPACT : HEIGHT_FULL;
  const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
  const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;

  // Scale helpers (close over dynamic PLOT_W/PLOT_H)
  const scaleX = (val: number, min: number, max: number): number => {
    if (max === min) return MARGIN.left;
    return MARGIN.left + ((val - min) / (max - min)) * PLOT_W;
  };
  const scaleY = (val: number, min: number, max: number): number => {
    if (max === min) return MARGIN.top + PLOT_H / 2;
    return MARGIN.top + PLOT_H - ((val - min) / (max - min)) * PLOT_H;
  };

  // Parse SG timestamps
  const sgParsed = sgData.map(p => ({
    t: new Date(p.date).getTime(),
    sg: p.value,
    temp: p.temp,
  }));

  if (sgParsed.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="100%" height="100%">
      <text x="${WIDTH/2}" y="${HEIGHT/2}" fill="${COLORS.axisText}" text-anchor="middle" font-size="14" font-family="sans-serif">Ingen data</text>
    </svg>`;
  }

  // Time range from SG data
  const tMin = sgParsed[0].t;
  const tMax = sgParsed[sgParsed.length - 1].t;

  // SG range with padding (matches desktop: fg - 0.001, og + 0.001)
  const sgValues = sgParsed.map(p => p.sg);
  const sgMin = Math.min(...sgValues, fg) - 0.001;
  const sgMax = Math.max(...sgValues, og) + 0.001;

  // Downsample SG, then apply moving average smoothing (matches desktop)
  const sgDown = downsample(sgParsed, 200, p => p.t, p => p.sg);
  const windowSize = Math.max(3, Math.floor(sgDown.length * 0.08));
  const smoothedSgValues = smoothData(sgDown.map(p => p.sg), windowSize);
  const sgPoints = sgDown.map((p, i) => ({
    x: scaleX(p.t, tMin, tMax),
    y: scaleY(smoothedSgValues[i], sgMin, sgMax),
  }));

  // Temperature range (from controller data if available)
  let tempSvgParts = '';
  if (tempHistory && tempHistory.length > 0) {
    const tempParsed = tempHistory.map(p => ({
      t: new Date(p.recorded_at).getTime(),
      current: p.current_temp,
      target: p.target_temp,
    })).filter(p => p.t >= tMin && p.t <= tMax);

    if (tempParsed.length > 0) {
      const tempDown = downsample(tempParsed, 200, p => p.t, p => p.current);
      // Include pill temp values from SG data in temp range calculation
      const pillTemps = sgParsed
        .filter(p => p.temp !== undefined && p.temp !== null)
        .map(p => p.temp!);
      const allTemps = [
        ...tempDown.flatMap(p => [p.current, p.target]),
        ...pillTemps,
      ];
      const tempMin = Math.min(...allTemps) - 0.5;
      const tempMax = Math.max(...allTemps) + 0.5;

      // Right Y-axis for temp
      const tempScaleY = (v: number) => {
        if (tempMax === tempMin) return MARGIN.top + PLOT_H / 2;
        return MARGIN.top + PLOT_H - ((v - tempMin) / (tempMax - tempMin)) * PLOT_H;
      };

      // Controller temp - smooth with moving average, then smooth curves
      const ctrlSmoothed = smoothData(tempDown.map(p => p.current), Math.max(3, Math.floor(tempDown.length * 0.08)));
      const ctrlPoints = tempDown.map((p, i) => ({
        x: scaleX(p.t, tMin, tMax),
        y: tempScaleY(ctrlSmoothed[i]),
      }));
      const baseY = MARGIN.top + PLOT_H;
      const ctrlSmoothD = buildSmoothPath(ctrlPoints);
      const areaPath = ctrlSmoothD + 
        ` L${ctrlPoints[ctrlPoints.length - 1].x.toFixed(1)},${baseY} L${ctrlPoints[0].x.toFixed(1)},${baseY} Z`;
      
      tempSvgParts += `<path d="${areaPath}" fill="${COLORS.controllerArea}" stroke="none"/>`;
      tempSvgParts += `<path d="${ctrlSmoothD}" fill="none" stroke="${COLORS.controllerLine}" stroke-width="1.5"/>`;

      // Target temp (step-after)
      const targetPoints = tempDown.map(p => ({
        x: scaleX(p.t, tMin, tMax),
        y: tempScaleY(p.target),
      }));
      tempSvgParts += `<path d="${buildStepPath(targetPoints)}" fill="none" stroke="${COLORS.targetLine}" stroke-width="1.5" stroke-dasharray="4 4"/>`;

      // Right axis labels (temp)
      const tempTicks = 4;
      for (let i = 0; i <= tempTicks; i++) {
        const v = tempMin + (i / tempTicks) * (tempMax - tempMin);
        const y = tempScaleY(v);
        tempSvgParts += `<text x="${WIDTH - MARGIN.right + 5}" y="${y + 3}" fill="${COLORS.controllerLine}" font-size="9" font-family="sans-serif" text-anchor="start">${v.toFixed(0)}°</text>`;
      }
    }
  }

  // Pill temp from SG data (if available)
  const pillTempPoints = sgDown
    .filter(p => p.temp !== undefined && p.temp !== null)
    .map(p => ({
      x: scaleX(p.t, tMin, tMax),
      y: (() => {
        // Use same temp scale as controller if available, else create own
        if (tempHistory && tempHistory.length > 0) {
          const tempParsed = tempHistory.map(tp => ({
            current: tp.current_temp,
            target: tp.target_temp,
          }));
          const pillTemps = sgParsed.filter(sp => sp.temp !== undefined).map(sp => sp.temp!);
          const allTemps = [...tempParsed.flatMap(tp => [tp.current, tp.target]), ...pillTemps];
          const tempMin = Math.min(...allTemps) - 0.5;
          const tempMax = Math.max(...allTemps) + 0.5;
          return MARGIN.top + PLOT_H - ((p.temp! - tempMin) / (tempMax - tempMin)) * PLOT_H;
        }
        return 0; // Skip if no temp scale
      })(),
    }));

  let pillTempSvg = '';
  if (pillTempPoints.length > 0 && tempHistory && tempHistory.length > 0) {
    pillTempSvg = `<path d="${buildSmoothPath(pillTempPoints)}" fill="none" stroke="${COLORS.pillTempLine}" stroke-width="1"/>`;
  }

  // Grid lines
  let gridSvg = '';
  const gridLines = 4;
  for (let i = 0; i <= gridLines; i++) {
    const y = MARGIN.top + (i / gridLines) * PLOT_H;
    gridSvg += `<line x1="${MARGIN.left}" y1="${y}" x2="${WIDTH - MARGIN.right}" y2="${y}" stroke="${COLORS.grid}" stroke-width="0.5"/>`;
  }

  // X-axis day labels
  let xAxisSvg = '';
  const dayMs = 86400000;
  const firstDay = new Date(tMin);
  firstDay.setHours(0, 0, 0, 0);
  let dayT = firstDay.getTime() + dayMs;
  const dayLabels: string[] = [];
  
  while (dayT < tMax) {
    const x = scaleX(dayT, tMin, tMax);
    if (x > MARGIN.left + 20 && x < WIDTH - MARGIN.right - 20) {
      xAxisSvg += `<line x1="${x}" y1="${MARGIN.top}" x2="${x}" y2="${MARGIN.top + PLOT_H}" stroke="${COLORS.grid}" stroke-width="0.5" stroke-dasharray="2 4"/>`;
      const label = formatDay(new Date(dayT).toISOString());
      if (!dayLabels.includes(label)) {
        xAxisSvg += `<text x="${x}" y="${HEIGHT - 8}" fill="${COLORS.axisText}" font-size="9" font-family="sans-serif" text-anchor="middle">${label}</text>`;
        dayLabels.push(label);
      }
    }
    dayT += dayMs;
  }

  // Y-axis SG labels
  let yAxisSvg = '';
  const sgTicks = 4;
  for (let i = 0; i <= sgTicks; i++) {
    const v = sgMin + (i / sgTicks) * (sgMax - sgMin);
    const y = scaleY(v, sgMin, sgMax);
    yAxisSvg += `<text x="${MARGIN.left - 5}" y="${y + 3}" fill="${COLORS.axisText}" font-size="9" font-family="sans-serif" text-anchor="end">${v.toFixed(3)}</text>`;
  }

  // OG/FG reference lines removed for cleaner TV display

  // SG line with glow effect
  const sgPathD = buildSmoothPath(sgPoints);
  const sgLineSvg = `
    <path d="${sgPathD}" fill="none" stroke="${COLORS.sgGlow}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${sgPathD}" fill="none" stroke="${COLORS.sgLine}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  `;

  // Current SG value label removed - shown in stat cards instead

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none" width="100%" height="100%">
    ${gridSvg}
    ${xAxisSvg}
    ${yAxisSvg}
    ${tempSvgParts}
    ${pillTempSvg}
    ${sgLineSvg}
  </svg>`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const { brewId, compact } = await req.json();
    if (!brewId) {
      return new Response(
        JSON.stringify({ error: 'brewId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch brew data
    const { data: brew, error: brewError } = await supabase
      .from('brew_readings')
      .select('id, sg_data, original_gravity, final_gravity, linked_controller_id, fermentation_start')
      .eq('id', brewId)
      .single();

    if (brewError || !brew) {
      console.error('[RenderChart] Brew not found:', brewError);
      return new Response(
        JSON.stringify({ error: 'Brew not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const sgData = (brew.sg_data || []) as SgDataPoint[];

    // Fetch controller temp history if linked
    let tempHistory: TempHistoryPoint[] | null = null;
    if (brew.linked_controller_id && sgData.length > 0) {
      const startTime = brew.fermentation_start || sgData[0].date;
      const endTime = sgData[sgData.length - 1].date;
      
      const { data: tempData } = await supabase.rpc('get_temp_history_sampled', {
        p_controller_id: brew.linked_controller_id,
        p_start_time: startTime,
        p_end_time: endTime,
        p_sample_interval_minutes: 15,
      });

      if (tempData && tempData.length > 0) {
        tempHistory = tempData as TempHistoryPoint[];
      }
    }

    // Generate SVG
    const svg = generateChartSvg(sgData, brew.original_gravity, brew.final_gravity, tempHistory, !!compact);

    // Upload SVG directly to chart-images bucket (static SVG in <img> is rasterized once, no GPU overhead)
    const svgBytes = new TextEncoder().encode(svg);
    const fileName = `chart_${brewId}${compact ? '_compact' : ''}.svg`;
    const { error: uploadError } = await supabase.storage
      .from('chart-images')
      .upload(fileName, svgBytes, {
        contentType: 'image/svg+xml',
        upsert: true,
      });

    if (uploadError) {
      console.error('[RenderChart] Upload error:', uploadError);
      return new Response(
        JSON.stringify({ error: 'Failed to upload chart image' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/chart-images/${fileName}`;
    console.log(`[RenderChart] Generated chart for ${brewId} in ${Date.now() - startTime}ms (${svgBytes.length} bytes)`);

    return new Response(
      JSON.stringify({ chartUrl: publicUrl }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[RenderChart] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
