import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Chart dimensions
const WIDTH = 600;
const HEIGHT = 300;
const MARGIN = { top: 25, right: 15, bottom: 35, left: 50 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;

// Colors (matching chartConfig)
const COLORS = {
  bg: '#1a1d2e',        // hsl(222 20% 12%)
  sgLine: '#3b82f6',     // blue
  sgGlow: '#3b82f680',
  controllerArea: '#f59e0b40', // orange area fill
  controllerLine: '#f59e0b',   // orange
  targetLine: '#f59e0b80',     // orange dashed
  pillTempLine: '#f59e0b4d',   // faint orange
  grid: '#2a2d3e',       // subtle grid
  axisText: '#6b7280',   // muted text
  labelText: '#9ca3af',  // slightly brighter
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

// Downsample array to max N points using largest-triangle-three-bucket
function downsample<T>(data: T[], maxPoints: number, getX: (d: T) => number, getY: (d: T) => number): T[] {
  if (data.length <= maxPoints) return data;
  
  const sampled: T[] = [data[0]];
  const bucketSize = (data.length - 2) / (maxPoints - 2);
  
  for (let i = 0; i < maxPoints - 2; i++) {
    const start = Math.floor(i * bucketSize) + 1;
    const end = Math.min(Math.floor((i + 1) * bucketSize) + 1, data.length - 1);
    
    // Pick point with max area (simplified: just pick middle)
    const mid = Math.floor((start + end) / 2);
    sampled.push(data[mid]);
  }
  
  sampled.push(data[data.length - 1]);
  return sampled;
}

// Scale value to pixel coordinate
function scaleX(val: number, min: number, max: number): number {
  if (max === min) return MARGIN.left;
  return MARGIN.left + ((val - min) / (max - min)) * PLOT_W;
}

function scaleY(val: number, min: number, max: number): number {
  if (max === min) return MARGIN.top + PLOT_H / 2;
  return MARGIN.top + PLOT_H - ((val - min) / (max - min)) * PLOT_H;
}

// Build SVG path from points
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
): string {
  // Parse SG timestamps
  const sgParsed = sgData.map(p => ({
    t: new Date(p.date).getTime(),
    sg: p.value,
    temp: p.temp,
  }));

  if (sgParsed.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
      <rect width="${WIDTH}" height="${HEIGHT}" fill="${COLORS.bg}"/>
      <text x="${WIDTH/2}" y="${HEIGHT/2}" fill="${COLORS.axisText}" text-anchor="middle" font-size="14" font-family="sans-serif">Ingen data</text>
    </svg>`;
  }

  // Time range from SG data
  const tMin = sgParsed[0].t;
  const tMax = sgParsed[sgParsed.length - 1].t;

  // SG range with padding
  const sgValues = sgParsed.map(p => p.sg);
  const sgMin = Math.min(...sgValues, fg) - 0.002;
  const sgMax = Math.max(...sgValues, og) + 0.002;

  // Downsample SG
  const sgDown = downsample(sgParsed, 60, p => p.t, p => p.sg);
  const sgPoints = sgDown.map(p => ({
    x: scaleX(p.t, tMin, tMax),
    y: scaleY(p.sg, sgMin, sgMax),
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
      const tempDown = downsample(tempParsed, 60, p => p.t, p => p.current);
      const allTemps = tempDown.flatMap(p => [p.current, p.target]);
      const tempMin = Math.min(...allTemps) - 1;
      const tempMax = Math.max(...allTemps) + 1;

      // Right Y-axis for temp
      const tempScaleY = (v: number) => {
        if (tempMax === tempMin) return MARGIN.top + PLOT_H / 2;
        return MARGIN.top + PLOT_H - ((v - tempMin) / (tempMax - tempMin)) * PLOT_H;
      };

      // Controller temp area
      const ctrlPoints = tempDown.map(p => ({
        x: scaleX(p.t, tMin, tMax),
        y: tempScaleY(p.current),
      }));
      const baseY = MARGIN.top + PLOT_H;
      const areaPath = buildPath(ctrlPoints) + 
        ` L${ctrlPoints[ctrlPoints.length - 1].x.toFixed(1)},${baseY} L${ctrlPoints[0].x.toFixed(1)},${baseY} Z`;
      
      tempSvgParts += `<path d="${areaPath}" fill="${COLORS.controllerArea}" stroke="none"/>`;
      tempSvgParts += `<path d="${buildPath(ctrlPoints)}" fill="none" stroke="${COLORS.controllerLine}" stroke-width="1.5"/>`;

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
          const allTemps = tempParsed.flatMap(tp => [tp.current, tp.target]);
          const tempMin = Math.min(...allTemps) - 1;
          const tempMax = Math.max(...allTemps) + 1;
          return MARGIN.top + PLOT_H - ((p.temp! - tempMin) / (tempMax - tempMin)) * PLOT_H;
        }
        return 0; // Skip if no temp scale
      })(),
    }));

  let pillTempSvg = '';
  if (pillTempPoints.length > 0 && tempHistory && tempHistory.length > 0) {
    pillTempSvg = `<path d="${buildPath(pillTempPoints)}" fill="none" stroke="${COLORS.pillTempLine}" stroke-width="1"/>`;
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

  // OG/FG reference lines
  const ogY = scaleY(og, sgMin, sgMax);
  const fgY = scaleY(fg, sgMin, sgMax);
  let refLines = '';
  if (og > 0) {
    refLines += `<line x1="${MARGIN.left}" y1="${ogY}" x2="${WIDTH - MARGIN.right}" y2="${ogY}" stroke="${COLORS.sgLine}40" stroke-width="0.5" stroke-dasharray="3 3"/>`;
    refLines += `<text x="${MARGIN.left + 3}" y="${ogY - 4}" fill="${COLORS.sgLine}80" font-size="8" font-family="sans-serif">OG</text>`;
  }
  if (fg > 0 && fg < og) {
    refLines += `<line x1="${MARGIN.left}" y1="${fgY}" x2="${WIDTH - MARGIN.right}" y2="${fgY}" stroke="${COLORS.sgLine}40" stroke-width="0.5" stroke-dasharray="3 3"/>`;
    refLines += `<text x="${MARGIN.left + 3}" y="${fgY - 4}" fill="${COLORS.sgLine}80" font-size="8" font-family="sans-serif">FG</text>`;
  }

  // SG line with glow effect
  const sgPathD = buildPath(sgPoints);
  const sgLineSvg = `
    <path d="${sgPathD}" fill="none" stroke="${COLORS.sgGlow}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${sgPathD}" fill="none" stroke="${COLORS.sgLine}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  `;

  // Current SG value label
  const lastSg = sgDown[sgDown.length - 1];
  const currentSgLabel = `<text x="${sgPoints[sgPoints.length - 1].x - 5}" y="${sgPoints[sgPoints.length - 1].y - 8}" fill="${COLORS.sgLine}" font-size="11" font-weight="bold" font-family="sans-serif" text-anchor="end">${lastSg.sg.toFixed(3)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <rect width="${WIDTH}" height="${HEIGHT}" rx="8" fill="${COLORS.bg}"/>
    ${gridSvg}
    ${xAxisSvg}
    ${yAxisSvg}
    ${refLines}
    ${tempSvgParts}
    ${pillTempSvg}
    ${sgLineSvg}
    ${currentSgLabel}
  </svg>`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const { brewId } = await req.json();
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
        p_sample_interval_minutes: 30,
      });

      if (tempData && tempData.length > 0) {
        tempHistory = tempData as TempHistoryPoint[];
      }
    }

    // Generate SVG
    const svg = generateChartSvg(sgData, brew.original_gravity, brew.final_gravity, tempHistory);

    // Upload SVG directly to chart-images bucket (static SVG in <img> is rasterized once, no GPU overhead)
    const svgBytes = new TextEncoder().encode(svg);
    const fileName = `chart_${brewId}.svg`;
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
