import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Chart dimensions
const WIDTHS: Record<number, number> = { 1: 600, 2: 600, 3: 400 };
const HEIGHT_FULL = 340;
const HEIGHT_COMPACT = 260;
const MARGIN = { top: 8, right: 15, bottom: 30, left: 35 };

const COLORS = {
  sgLine: '#e8a225',
  sgGlow: '#e8a22599',
  controllerArea: '#268bd214',
  controllerLine: '#268bd24d',
  avgTempLine: '#268bd2',
  avgTempFill: '#268bd215',
  targetLine: '#268bd280',
  pillTempLine: '#268bd24d',
  grid: '#3a3d4e',
  axisText: '#6b7280',
};

import type { SgDataPoint } from '../_shared/types.ts'

interface SnapshotPoint {
  recorded_at: string;
  sg: number;
  pill_temp: number | null;
  controller_temp: number | null;
  profile_target_temp: number | null;
}

// Build straight-line SVG path from raw points
function buildPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

// Build smooth SVG path (monotone cubic interpolation)
function buildSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  if (points.length === 2) return `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)} L${points[1].x.toFixed(1)},${points[1].y.toFixed(1)}`;

  const n = points.length;
  const dx: number[] = [];
  const dy: number[] = [];
  const m: number[] = [];

  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1].x - points[i].x);
    dy.push(points[i + 1].y - points[i].y);
    m.push(dx[i] === 0 ? 0 : dy[i] / dx[i]);
  }

  const tangents: number[] = new Array(n);
  tangents[0] = m[0];
  tangents[n - 1] = m[n - 2];

  for (let i = 1; i < n - 1; i++) {
    tangents[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  }

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

// Moving average smoothing
function smoothValues(values: (number | null)[], windowSize: number): (number | null)[] {
  return values.map((val, i) => {
    if (val === null) return null;
    const half = Math.floor(windowSize / 2);
    const start = Math.max(0, i - half);
    const end = Math.min(values.length - 1, i + half);
    let sum = 0, count = 0;
    for (let j = start; j <= end; j++) {
      if (values[j] !== null) { sum += values[j]!; count++; }
    }
    return count > 0 ? sum / count : val;
  });
}

function getWindowSize(dataLength: number): number {
  if (dataLength > 200) return 9;
  if (dataLength > 100) return 7;
  if (dataLength > 50) return 5;
  return 3;
}

function formatDay(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

/**
 * Downsample an array to at most maxPoints using LTTB-like uniform sampling,
 * always keeping first and last points.
 */
function downsample<T>(data: T[], maxPoints: number): T[] {
  if (data.length <= maxPoints) return data;
  const result: T[] = [data[0]];
  const step = (data.length - 1) / (maxPoints - 1);
  for (let i = 1; i < maxPoints - 1; i++) {
    result.push(data[Math.round(i * step)]);
  }
  result.push(data[data.length - 1]);
  return result;
}

function generateChartSvg(
  snapshotData: SnapshotPoint[],
  og: number,
  fg: number,
  compact: boolean = false,
  brewCount: number = 2,
): string {
  const WIDTH = WIDTHS[brewCount] ?? 600;
  const HEIGHT = compact ? HEIGHT_COMPACT : HEIGHT_FULL;
  const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
  const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;

  const scaleX = (val: number, min: number, max: number): number => {
    if (max === min) return MARGIN.left;
    return MARGIN.left + ((val - min) / (max - min)) * PLOT_W;
  };

  const scaleY = (val: number, min: number, max: number): number => {
    if (max === min) return MARGIN.top + PLOT_H / 2;
    return MARGIN.top + PLOT_H - ((val - min) / (max - min)) * PLOT_H;
  };

  const rawParsed = snapshotData
    .map((p) => ({
      t: new Date(p.recorded_at).getTime(),
      sg: p.sg,
      pill: p.pill_temp,
      controller: p.controller_temp,
      target: p.profile_target_temp,
    }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.sg))
    .sort((a, b) => a.t - b.t);

  // Apply moving average smoothing to all value series
  const w = getWindowSize(rawParsed.length);
  const smoothedSg = smoothValues(rawParsed.map(p => p.sg), w);
  const smoothedPill = smoothValues(rawParsed.map(p => p.pill), w);
  const smoothedCtrl = smoothValues(rawParsed.map(p => p.controller), w);

  const parsed = rawParsed.map((p, i) => ({
    ...p,
    sg: smoothedSg[i] ?? p.sg,
    pill: smoothedPill[i],
    controller: smoothedCtrl[i],
  }));

  if (parsed.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="100%" height="100%">
      <text x="${WIDTH / 2}" y="${HEIGHT / 2}" fill="${COLORS.axisText}" text-anchor="middle" font-size="14" font-family="sans-serif">Ingen data</text>
    </svg>`;
  }

  const tMin = parsed[0].t;
  const tMax = parsed[parsed.length - 1].t;

  const sgValues = parsed.map((p) => p.sg);
  const sgMin = Math.min(...sgValues, fg) - 0.001;
  const sgMax = Math.max(...sgValues, og) + 0.001;

  const tempValues = parsed
    .flatMap((p) => [p.pill, p.controller, p.target])
    .filter((v): v is number => v !== null && Number.isFinite(v));

  const hasTempData = tempValues.length > 0;
  const tempMin = hasTempData ? Math.min(...tempValues) - 1 : 0;
  const tempMax = hasTempData ? Math.max(...tempValues) + 1 : 1;
  const tempScaleY = (v: number) => scaleY(v, tempMin, tempMax);

  let gridSvg = '';
  const gridLines = 4;
  for (let i = 0; i <= gridLines; i++) {
    const y = MARGIN.top + (i / gridLines) * PLOT_H;
    gridSvg += `<line x1="${MARGIN.left}" y1="${y}" x2="${WIDTH - MARGIN.right}" y2="${y}" stroke="${COLORS.grid}" stroke-width="0.5"/>`;
  }

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

  let yAxisSvg = '';
  const sgTicks = 4;
  for (let i = 0; i <= sgTicks; i++) {
    const v = sgMin + (i / sgTicks) * (sgMax - sgMin);
    const y = scaleY(v, sgMin, sgMax);
    yAxisSvg += `<text x="${MARGIN.left - 5}" y="${y + 3}" fill="${COLORS.axisText}" font-size="9" font-family="sans-serif" text-anchor="end">${v.toFixed(3)}</text>`;
  }

  let tempAxisSvg = '';
  if (hasTempData) {
    const tempTicks = 4;
    for (let i = 0; i <= tempTicks; i++) {
      const v = tempMin + (i / tempTicks) * (tempMax - tempMin);
      const y = tempScaleY(v);
      tempAxisSvg += `<text x="${WIDTH - MARGIN.right + 5}" y="${y + 3}" fill="${COLORS.controllerLine}" font-size="9" font-family="sans-serif" text-anchor="start">${v.toFixed(0)}°</text>`;
    }
  }

  const sgPoints = parsed.map((p) => ({ x: scaleX(p.t, tMin, tMax), y: scaleY(p.sg, sgMin, sgMax) }));
  const sgLineSvg = `<path d="${buildSmoothPath(sgPoints)}" fill="none" stroke="${COLORS.sgLine}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;

  const controllerPoints = parsed
    .filter((p) => p.controller !== null)
    .map((p) => ({ x: scaleX(p.t, tMin, tMax), y: tempScaleY(p.controller as number) }));
  const controllerSvg = controllerPoints.length > 0
    ? `<path d="${buildSmoothPath(controllerPoints)}" fill="none" stroke="${COLORS.controllerLine}" stroke-width="1"/>`
    : '';

  const pillPoints = parsed
    .filter((p) => p.pill !== null)
    .map((p) => ({ x: scaleX(p.t, tMin, tMax), y: tempScaleY(p.pill as number) }));
  const pillSvg = pillPoints.length > 0
    ? `<path d="${buildSmoothPath(pillPoints)}" fill="none" stroke="${COLORS.pillTempLine}" stroke-width="1"/>`
    : '';

  const targetPoints = parsed
    .filter((p) => p.target !== null)
    .map((p) => ({ x: scaleX(p.t, tMin, tMax), y: tempScaleY(p.target as number) }));
  const targetSvg = targetPoints.length > 0
    ? `<path d="${buildPath(targetPoints)}" fill="none" stroke="${COLORS.targetLine}" stroke-width="1.5" stroke-dasharray="4 4"/>`
    : '';

  const spanPoints = parsed
    .filter((p) => p.pill !== null && p.controller !== null)
    .map((p) => ({
      x: scaleX(p.t, tMin, tMax),
      pillY: tempScaleY(p.pill as number),
      ctrlY: tempScaleY(p.controller as number),
      avgY: tempScaleY(((p.pill as number) + (p.controller as number)) / 2),
    }));

  let tempSpanSvg = '';
  let avgTempSvg = '';
  if (spanPoints.length > 1) {
    const upper = spanPoints.map((p) => ({ x: p.x, y: p.pillY }));
    const lower = [...spanPoints].reverse().map((p) => ({ x: p.x, y: p.ctrlY }));
    const spanPath = `${buildSmoothPath(upper)} ${buildSmoothPath(lower).replace(/^M/, 'L')} Z`;
    tempSpanSvg = `<path d="${spanPath}" fill="url(#tempSpanGrad)" stroke="none"/>`;

    const avgPoints = spanPoints.map((p) => ({ x: p.x, y: p.avgY }));
    avgTempSvg = `<path d="${buildSmoothPath(avgPoints)}" fill="none" stroke="${COLORS.avgTempLine}" stroke-width="1.5"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none" width="100%" height="100%">
    <defs>
      <linearGradient id="tempSpanGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#268bd2" stop-opacity="0.15"/>
        <stop offset="100%" stop-color="#268bd2" stop-opacity="0.08"/>
      </linearGradient>
    </defs>
    ${gridSvg}
    ${xAxisSvg}
    ${yAxisSvg}
    ${tempAxisSvg}
    ${tempSpanSvg}
    ${avgTempSvg}
    ${targetSvg}
    ${controllerSvg}
    ${pillSvg}
    ${sgLineSvg}
  </svg>`;
}

/** Max chart points – enough for visual fidelity at 600px wide */
const MAX_CHART_POINTS = 200;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const { brewId, compact, brewCount, action } = await req.json();

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Handle delete action
    if (action === 'delete' && brewId) {
      const { data: files } = await supabase.storage.from('chart-images').list('', { search: `chart_${brewId}` });
      if (files && files.length > 0) {
        const paths = files.map(f => f.name);
        const { error } = await supabase.storage.from('chart-images').remove(paths);
        if (error) console.error('[RenderChart] Delete error:', error);
        return new Response(JSON.stringify({ deleted: paths }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ deleted: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!brewId) {
      return new Response(
        JSON.stringify({ error: 'brewId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const bc = brewCount ?? 2;
    const fileName = `chart_${brewId}${compact ? '_compact' : ''}_${bc}b.svg`;
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/chart-images/${fileName}`;

    // ── Cache check: compare latest snapshot timestamp with stored SVG ──
    // Fetch latest snapshot timestamp for this brew
    const { data: latestSnap } = await supabase
      .from('brew_data_snapshots')
      .select('recorded_at')
      .eq('brew_id', brewId)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .single();

    const latestTs = latestSnap?.recorded_at ?? '';

    // Check if cached SVG exists (by listing with exact name match)
    const { data: existingFiles } = await supabase.storage
      .from('chart-images')
      .list('', { search: fileName, limit: 1 });

    const existingFile = existingFiles?.find(f => f.name === fileName);
    if (existingFile && latestTs) {
      // Compare: if SVG was updated AFTER the latest snapshot, it's still fresh
      const svgUpdated = new Date(existingFile.updated_at).getTime();
      const snapTime = new Date(latestTs).getTime();
      if (svgUpdated > snapTime) {
        console.log(`[RenderChart] Cache hit for ${brewId} (${Date.now() - startTime}ms)`);
        return new Response(
          JSON.stringify({ chartUrl: publicUrl }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ── Fetch brew metadata ──
    const { data: brew, error: brewError } = await supabase
      .from('brew_readings')
      .select('id, sg_data, original_gravity, final_gravity')
      .eq('id', brewId)
      .single();

    if (brewError || !brew) {
      console.error('[RenderChart] Brew not found:', brewError);
      return new Response(
        JSON.stringify({ error: 'Brew not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Fetch snapshot count and sample efficiently ──
    const { count: totalCount } = await supabase
      .from('brew_data_snapshots')
      .select('id', { count: 'exact', head: true })
      .eq('brew_id', brewId);

    let snapshotRows: SnapshotPoint[] = [];
    const total = totalCount ?? 0;

    if (total <= MAX_CHART_POINTS) {
      // Few enough points — fetch all in one query
      const { data: batch } = await supabase
        .from('brew_data_snapshots')
        .select('recorded_at, sg, pill_temp, controller_temp, profile_target_temp')
        .eq('brew_id', brewId)
        .order('recorded_at', { ascending: true })
        .limit(MAX_CHART_POINTS);

      snapshotRows = (batch ?? []) as SnapshotPoint[];
    } else {
      // Many points — fetch all but downsample after
      // Use a single large fetch (Supabase max 1000) then sample
      const allSnapshots: SnapshotPoint[] = [];
      let offset = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: batch, error } = await supabase
          .from('brew_data_snapshots')
          .select('recorded_at, sg, pill_temp, controller_temp, profile_target_temp')
          .eq('brew_id', brewId)
          .order('recorded_at', { ascending: true })
          .range(offset, offset + batchSize - 1);

        if (error || !batch || batch.length === 0) {
          hasMore = false;
        } else {
          allSnapshots.push(...(batch as SnapshotPoint[]));
          offset += batchSize;
          hasMore = batch.length === batchSize;
        }
      }

      // Downsample to MAX_CHART_POINTS for rendering
      snapshotRows = downsample(allSnapshots, MAX_CHART_POINTS);
    }

    // Fallback to SG log if snapshots are not yet available
    const fallbackRows = ((brew.sg_data || []) as SgDataPoint[]).map((p) => ({
      recorded_at: p.date,
      sg: p.value,
      pill_temp: p.temp ?? null,
      controller_temp: null,
      profile_target_temp: null,
    }));

    const chartRows = snapshotRows.length > 0 ? snapshotRows : fallbackRows;

    // Generate SVG
    const svg = generateChartSvg(chartRows, brew.original_gravity, brew.final_gravity, !!compact, bc);

    const svgBytes = new TextEncoder().encode(svg);
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

    console.log(`[RenderChart] Generated chart for ${brewId} in ${Date.now() - startTime}ms (${snapshotRows.length}→${chartRows.length} pts, ${svgBytes.length} bytes)`);

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
