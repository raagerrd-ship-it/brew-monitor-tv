import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, CheckCircle2, XCircle, Info, Wrench, Snowflake, Pill, Gauge, Pencil, RefreshCw, Send, Database, AlertTriangle, ShieldAlert, Clock, GraduationCap, Zap, Thermometer, Activity, TrendingDown, Ruler } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const fmtTime = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('sv-SE') : null;

/** Build a tooltip showing avg (decision value) + per-interval utilization for 5 data points */
const buildUtilTooltip = (data: {
  lastUpdate?: string | null;
  recentPct?: number | null;   // p1→p0
  midPct?: number | null;      // p2→p1
  oldestPct?: number | null;   // p3→p2
  ancientPct?: number | null;  // p4→p3
  pct?: number | null;         // rolling avg (decision value)
  prevAt?: string | null;      // p1 timestamp
  p2At?: string | null;        // p2 timestamp
  anchorAt?: string | null;    // p3 timestamp
  p4At?: string | null;        // p4 timestamp
}): string => {
  const lines: string[] = [];

  // Rolling average header (avg of 2 most recent intervals — used for decisions)
  if (data.pct != null) {
    lines.push(`Snitt (senaste 2): ${data.pct}%`);
    lines.push('───');
  }

  // p0 (current) — interval from p1→p0
  const currentTime = fmtTime(data.lastUpdate ?? null);
  const prevTime = fmtTime(data.prevAt ?? null);
  if (currentTime && currentTime !== prevTime) {
    lines.push(`${currentTime}: ${data.recentPct != null ? `${data.recentPct}%` : '—'}`);
  }

  // p1 — interval from p2→p1
  if (prevTime) {
    lines.push(`${prevTime}: ${data.midPct != null ? `${data.midPct}%` : '—'}`);
  }

  // p2 — interval from p3→p2
  const p2Time = fmtTime(data.p2At ?? null);
  if (p2Time) {
    lines.push(`${p2Time}: ${data.oldestPct != null ? `${data.oldestPct}%` : '—'}`);
  }

  // p3 (anchor) — interval from p4→p3
  const anchorTime = fmtTime(data.anchorAt ?? null);
  if (anchorTime) {
    lines.push(`${anchorTime}: ${data.ancientPct != null ? `${data.ancientPct}%` : '—'}`);
  }

  // p4 (oldest) — no earlier data
  const p4Time = fmtTime(data.p4At ?? null);
  if (p4Time && p4Time !== anchorTime) {
    lines.push(`${p4Time}: (start)`);
  }

  if (lines.length === 0) lines.push('Ingen data ännu');
  return lines.join('\n');
};

const r1 = (v: number | null | undefined): string => {
  if (v === null || v === undefined) return '—';
  return parseFloat(Number(v).toFixed(1)).toString();
};

// --- Types ---

interface DecisionEntry {
  step: string;
  result: 'pass' | 'fail' | 'info' | 'action';
  message: string;
  details?: Record<string, unknown>;
}

interface DecisionLog {
  id: string;
  created_at: string;
  duration_ms: number;
  decision_count: number;
  decisions: DecisionEntry[];
  final_result: string;
  adjustment_made: boolean;
}

interface AdjustmentLog {
  id: string;
  created_at: string;
  reason: string;
  old_target_temp: number;
  new_target_temp: number;
  original_target_temp: number | null;
  cooler_controller_name: string;
  followed_controller_name: string | null;
  followed_current_temp: number | null;
  followed_target_temp: number | null;
  followed_hysteresis: number | null;
}

type AdjustmentCategory = 'pill-comp' | 'glykol' | 'manuell' | 'passthrough';

interface UnifiedEntry {
  log: DecisionLog;
  adjustments: (AdjustmentLog & { category: AdjustmentCategory })[];
  timestamp: string;
}

// --- Constants ---

/** Steps hidden from expanded view (operational noise) */
const HIDDEN_STEPS = new Set([
  'START', 'SETTINGS', 'FOLLOWED_CONTROLLERS', 'COMPLETE',
  'BATCH_DB', 'PILL_COMP', 'PILL_COMP_SKIP',
  'BOOTSTRAP', 'STALE_SENSOR',
  'PID_CONTROL', 'PID_SKIP', 'CONTROLLERS',
]);

/** All steps handled by named pipeline sections */
const PIPELINE_STEPS = new Set([
  'SYNC_DATA', 'BREW_SG_STATUS',
  'PILL_COMP_STATUS', 'PILL_COMP_ACTION',
  'PASS_THROUGH',
  'STALL', 'STALL_SKIP', 'STALL_ANALYSIS', 'STALL_BOOST', 'STALL_LEARN',
  'COOLING', 'COOLER_CONFIG', 'COOLER_STATUS', 'COOLER_STALE', 'COOLER_OK',
  'COOLING_CAPABILITY', 'COOLING_UTIL', 'EFFECTIVE_TARGET', 'MARGIN_CALC', 'RATE_LIMIT',
  'RAMP_BLOCK', 'DEMAND_GUARD', 'PROACTIVE', 'RATE_LEARN', 'MARGIN_LEARN', 'UTIL_LEARN', 'MAX_MARGIN', 'MIN_MARGIN',
  'HYSTERESIS_KICK', 'HYSTERESIS_KICK_NOOP', 'HYSTERESIS_DEADBAND', 'HYSTERESIS_REVERT', 'KICK_FLAG', 'COOLER_IDLE',
  'ADJUSTMENT', 'PID_CONTROL', 'BATCH_FLUSH',
  'RAPT_SEND',
  
]);

// --- Helpers ---

function categorizeAdjustment(reason: string): AdjustmentCategory {
  if (reason.startsWith('✏️') || reason.startsWith('🔧')) return 'manuell';
  if (reason.startsWith('🔄')) return 'passthrough';
  if (reason.startsWith('🎯') || reason.startsWith('🔥') || reason.startsWith('🌡️') || reason.startsWith('🧠')) return 'pill-comp';
  if (reason.includes('Cooling recovery') || reason.includes('colder than needed') || reason.includes('struggling to cool') || reason.includes('Ingen följd controller')) return 'glykol';
  return 'glykol';
}

function getCategoryBadge(category: AdjustmentCategory, adjText?: React.ReactNode, colorOverride?: string) {
  const styles: Record<AdjustmentCategory, { bg: string; color: string; border: string; icon: React.ReactNode; label: string }> = {
    'pill-comp': { bg: 'hsl(280 60% 60% / 0.2)', color: 'hsl(280 60% 60%)', border: 'hsl(280 60% 60% / 0.3)', icon: <Pill className="h-2.5 w-2.5 mr-0.5" />, label: 'PID' },
    'glykol': { bg: 'hsl(210 80% 60% / 0.2)', color: 'hsl(210 80% 60%)', border: 'hsl(210 80% 60% / 0.3)', icon: <Snowflake className="h-2.5 w-2.5 mr-0.5" />, label: 'Glykol' },
    'manuell': { bg: 'hsl(38 92% 55% / 0.2)', color: 'hsl(38 92% 55%)', border: 'hsl(38 92% 55% / 0.3)', icon: <Pencil className="h-2.5 w-2.5 mr-0.5" />, label: 'Manuell' },
    'passthrough': { bg: 'hsl(170 60% 45% / 0.2)', color: 'hsl(170 60% 45%)', border: 'hsl(170 60% 45% / 0.3)', icon: <RefreshCw className="h-2.5 w-2.5 mr-0.5" />, label: 'Synk' },
  };
  const s = styles[category];
  const color = colorOverride || s.color;
  const bg = colorOverride ? `${colorOverride}33` : s.bg;
  const border = colorOverride ? `${colorOverride}4d` : s.border;
  return (
    <Badge variant="default" className="text-[10px] px-1.5" style={{ background: bg, color, borderColor: border }}>
      {s.icon}{s.label}{adjText && <span className="ml-1">{adjText}</span>}
    </Badge>
  );
}

/** Parse PILL_COMP_ACTION brake/limit badges from message */
function parsePillCompActionBrakes(msg: string): string[] {
  const brakes: string[] = [];
  const limitsMatch = msg.match(/limits=\[([^\]]+)\]/);
  if (limitsMatch) {
    const constraints = limitsMatch[1].split(',');
    if (constraints.includes('overshoot-clamp')) brakes.push('🔒 Overshoot');
    if (constraints.includes('overshoot-release')) brakes.push('🛑 Release');
    if (constraints.includes('ramp-hold')) brakes.push('🔒 Ramp');
    if (constraints.includes('approach-release')) brakes.push('🚀 Approach');
    if (constraints.includes('dir-clamp')) brakes.push('🔒 Riktning');
    const rateLimitC = constraints.find(c => c.startsWith('rate-limit='));
    if (rateLimitC) brakes.push(`⏱ ${rateLimitC.split('=')[1]}°/c`);
  }
  return brakes;
}

/** Extract new target from PILL_COMP_ACTION message */
function parsePillCompActionTarget(msg: string): { name: string; newTarget: number | null; noChange: boolean } {
  // "ControllerName: PID X°C → Y°C (...)" or "ControllerName: ingen ändring (same RAPT data)"
  const pidMatch = msg.match(/^(.+?):\s*PID\s*([\d.]+)°C\s*→\s*([\d.]+)°C/);
  if (pidMatch) {
    const noChange = msg.includes('ingen ändring');
    return { name: pidMatch[1], newTarget: parseFloat(pidMatch[3]), noChange };
  }
  const noChangeMatch = msg.match(/^(.+?):\s*(.+)/);
  if (noChangeMatch && msg.includes('ingen ändring')) {
    return { name: noChangeMatch[1], newTarget: null, noChange: true };
  }
  return { name: msg, newTarget: null, noChange: false };
}

// --- Component ---

export function AutoCoolingDecisionLogs() {
  const [entries, setEntries] = useState<UnifiedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [controllerColors, setControllerColors] = useState<Record<string, string>>({});
  const [lastSuccessfulRaptSync, setLastSuccessfulRaptSync] = useState<string | null>(null);
  const hideSync = false;
  const hidePid = false;

  useEffect(() => {
    // Fetch controller→pill color map + last RAPT sync
    (async () => {
      const [{ data: controllers }, { data: pills }, { data: syncSettings }] = await Promise.all([
        supabase.from('rapt_temp_controllers').select('name, linked_pill_id'),
        supabase.from('rapt_pills').select('pill_id, color'),
        supabase.from('sync_settings').select('last_successful_rapt_sync_at').limit(1).maybeSingle(),
      ]);
      if (syncSettings?.last_successful_rapt_sync_at) {
        setLastSuccessfulRaptSync(syncSettings.last_successful_rapt_sync_at);
      }
      if (controllers && pills) {
        const pillColorMap = Object.fromEntries(pills.map(p => [p.pill_id, p.color]));
        const map: Record<string, string> = {};
        for (const c of controllers) {
          const color = c.linked_pill_id ? pillColorMap[c.linked_pill_id] : null;
          if (color && color !== '#000000') map[c.name] = color;
        }
        setControllerColors(map);
      }
    })();
    loadAll();
    const ch1 = supabase
      .channel('decision-logs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'auto_cooling_decision_logs' }, () => loadAll())
      .subscribe();
    const ch2 = supabase
      .channel('adjustment-logs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'auto_cooling_adjustments' }, () => loadAll())
      .subscribe();
    return () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2); };
  }, []);

  const loadAll = async () => {
    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const [decisionRes, adjustmentRes] = await Promise.all([
        supabase.from('auto_cooling_decision_logs').select('*').gte('created_at', cutoff).order('created_at', { ascending: false }).limit(500),
        supabase.from('auto_cooling_adjustments').select('*').gte('created_at', cutoff).order('created_at', { ascending: false }).limit(500),
      ]);

      const decisions = (decisionRes.data || []).map(log => ({
        ...log, decisions: (log.decisions as unknown) as DecisionEntry[],
      })) as DecisionLog[];

      const adjustments = (adjustmentRes.data || []).map(adj => ({
        ...(adj as unknown as AdjustmentLog), category: categorizeAdjustment(adj.reason),
      }));

      // Build adjustment lookup by time for quick access in EntryRow
      const adjByTime = new Map<string, (AdjustmentLog & { category: AdjustmentCategory })[]>();
      for (const adj of adjustments) {
        // Find closest decision log (within 15s)
        let matched = false;
        for (const dec of decisions) {
          if (Math.abs(new Date(adj.created_at).getTime() - new Date(dec.created_at).getTime()) < 15000) {
            const list = adjByTime.get(dec.id) || [];
            list.push(adj);
            adjByTime.set(dec.id, list);
            matched = true;
            break;
          }
        }
        if (!matched) {
          // Orphan adjustment — create standalone entry
          const orphanId = `orphan-${adj.id}`;
          adjByTime.set(orphanId, [adj]);
        }
      }

      // One entry per decision log — no merging, every 5-min cycle is its own row
      const unified: UnifiedEntry[] = decisions.map(dec => ({
        log: dec,
        adjustments: adjByTime.get(dec.id) || [],
        timestamp: dec.created_at,
      }));

      // Add orphan adjustments as standalone entries
      for (const [key, adjs] of adjByTime.entries()) {
        if (key.startsWith('orphan-')) {
          const adj = adjs[0];
          unified.push({
            log: { id: key, created_at: adj.created_at, duration_ms: 0, decision_count: 0, decisions: [], final_result: adj.category === 'manuell' ? 'Manuell justering' : 'Adjustment', adjustment_made: true },
            adjustments: adjs,
            timestamp: adj.created_at,
          });
        }
      }

      unified.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setEntries(unified);
    } catch (error) {
      console.error('Error loading logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (ts: string) => new Date(ts).toLocaleString('sv-SE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  if (loading) return <p className="text-sm text-muted-foreground">Laddar...</p>;
  if (entries.length === 0) return <p className="text-sm text-muted-foreground italic">Inga justeringar har gjorts ännu.</p>;

  return (
    <div className="space-y-2">
      {(() => {
        const allCoolerAdjs = entries
          .flatMap(e => e.adjustments.filter(a => a.category === 'glykol'))
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 4);
        return (
          <>
            {entries.map((entry) => (
              <EntryRow key={entry.log.id} entry={entry} hideSync={hideSync} hidePid={hidePid} formatTime={formatTime} recentCoolerAdjs={allCoolerAdjs} controllerColors={controllerColors} lastSuccessfulRaptSync={lastSuccessfulRaptSync} />
            ))}
          </>
        );
      })()}
    </div>
  );
}

// --- Entry Row ---

function EntryRow({ entry, hideSync, hidePid, formatTime, recentCoolerAdjs, controllerColors, lastSuccessfulRaptSync }: {
  entry: UnifiedEntry; hideSync: boolean; hidePid: boolean; formatTime: (ts: string) => string;
  recentCoolerAdjs: (AdjustmentLog & { category: AdjustmentCategory })[];
  controllerColors: Record<string, string>;
  lastSuccessfulRaptSync: string | null;
}) {
  const { log, adjustments: adjs } = entry;
  const primaryAdj = adjs.length > 0 ? adjs[0] : null;
  const hasPidAdj = adjs.some(a => a.category === 'pill-comp');
  const hasGlykolAdj = adjs.some(a => a.category === 'glykol');

  // Check if any controller is offline (stale)
  const hasOfflineController = log.decisions.some(d => d.step === 'SYNC_DATA' && d.details?.stale);

  // Check if automation features are disabled from SETTINGS decision
  const settingsDecision = log.decisions.find(d => d.step === 'SETTINGS');
  const settingsDetails = settingsDecision?.details as Record<string, boolean> | undefined;
  const allDisabled = log.final_result === 'All disabled';
  const disabledFeatures: string[] = [];
  if (settingsDetails) {
    if (!settingsDetails.cooling) disabledFeatures.push('Glykolkylare');
    if (!settingsDetails.pill_compensation) disabledFeatures.push('PID-kompensation');
    if (!settingsDetails.stall_boost) disabledFeatures.push('Stall-boost');
    if (!settingsDetails.overshoot_prevention) disabledFeatures.push('Overshoot');
  }
  const hasDisabledFeatures = allDisabled || disabledFeatures.length > 0;
  const showWarningTriangle = hasDisabledFeatures || hasOfflineController;

  // Header badge
  let headerBadge: React.ReactNode;

  if (adjs.length === 0) {
    headerBadge = (
      <div className="flex gap-1 items-center">
        {showWarningTriangle && (
          <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />
        )}
        <Badge variant="default" className="text-[10px] px-1.5" style={{ background: 'hsl(var(--primary) / 0.2)', color: 'hsl(var(--primary))', borderColor: 'hsl(var(--primary) / 0.3)' }}>
          <Gauge className="h-2.5 w-2.5 mr-0.5" />System
        </Badge>
      </div>
    );
  } else if (hasPidAdj && hasGlykolAdj) {
    const pidAdj = adjs.find(a => a.category === 'pill-comp')!;
    const glykolAdj = adjs.find(a => a.category === 'glykol')!;
    const pidColor = pidAdj.followed_controller_name ? controllerColors[pidAdj.followed_controller_name] : undefined;
    const adjStr = (a: typeof pidAdj) => `${r1(a.old_target_temp)}° → ${r1(a.new_target_temp)}°`;
    headerBadge = (
      <div className="flex gap-1 items-center flex-wrap">
        {showWarningTriangle && <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />}
        {getCategoryBadge('pill-comp', adjStr(pidAdj), pidColor)}
        {getCategoryBadge('glykol', adjStr(glykolAdj))}
      </div>
    );
  } else {
    const adjStr = `${r1(primaryAdj!.old_target_temp)}° → ${r1(primaryAdj!.new_target_temp)}°`;
    const pidColor = primaryAdj!.category === 'pill-comp' && primaryAdj!.followed_controller_name ? controllerColors[primaryAdj!.followed_controller_name] : undefined;
    headerBadge = (
      <div className="flex gap-1 items-center">
        {showWarningTriangle && <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />}
        {getCategoryBadge(primaryAdj!.category, adjStr, pidColor)}
      </div>
    );
  }

  return (
    <Collapsible className="outline-none" tabIndex={-1}>
      <CollapsibleTrigger className="grid grid-cols-[auto_1fr_20px] items-center w-full py-2 px-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors gap-x-2 text-xs outline-none focus:outline-none focus-visible:outline-none">
        <span className="text-muted-foreground whitespace-nowrap text-left">{formatTime(entry.timestamp)}</span>
        {headerBadge}
        <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform duration-200 justify-self-end" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 p-3 bg-background rounded-lg border border-border space-y-3 overflow-x-auto">
          {/* Disabled features warning */}
          {hasDisabledFeatures && (
            <div className="flex items-start gap-2 text-[11px] text-destructive bg-destructive/10 rounded px-2 py-1.5 border border-destructive/20">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <div>
                {allDisabled ? (
                  <span className="font-medium">All automation är avstängd</span>
                ) : (
                  <span><span className="font-medium">Avstängt:</span> {disabledFeatures.join(', ')}</span>
                )}
                {lastSuccessfulRaptSync && (
                  <div className="text-muted-foreground mt-0.5">
                    Senaste lyckade RAPT-synk: {new Date(lastSuccessfulRaptSync).toLocaleString('sv-SE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Meta header */}
          {log.decision_count > 0 && (
            <div className="flex gap-4 text-[10px] text-muted-foreground pb-2 border-b border-border">
              <span>Steg: {log.decision_count}</span>
              <span>Tid: {log.duration_ms}ms</span>
              <span>Resultat: {log.final_result}</span>
            </div>
          )}

          {/* Pipeline sections */}
          {log.decisions.length > 0 && (
            <PipelineView decisions={log.decisions} hideSync={hideSync} hidePid={hidePid} recentCoolerAdjs={recentCoolerAdjs} />
          )}

          {/* Adjustment detail cards (manuell, passthrough only — PID is in pipeline, glykol in GLYKOL-KYLARE section) */}
          {adjs.filter(a => a.category !== 'pill-comp' && a.category !== 'glykol').map(adj => (
            <AdjustmentCard key={adj.id} adj={adj} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// --- Cooler Sub-Section (always-visible labeled row) ---

function CoolerSubSection({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-[11px]">
      <div className="flex items-center gap-1 text-muted-foreground min-w-[100px] shrink-0 pt-0.5">
        {icon}
        <span className="font-medium text-[10px] uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex-1 flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

// --- Cooler Decision View ---

function CoolerDecisionView({ entries, recentCoolerAdjs }: { entries: DecisionEntry[]; recentCoolerAdjs: (AdjustmentLog & { category: AdjustmentCategory })[] }) {
  const status = entries.find(d => d.step === 'COOLER_STATUS');
  const effectiveTarget = entries.find(d => d.step === 'EFFECTIVE_TARGET');
  const marginCalc = entries.find(d => d.step === 'MARGIN_CALC');
  const coolerOk = entries.find(d => d.step === 'COOLER_OK');
  const adjustment = entries.find(d => d.step === 'ADJUSTMENT');
  const rateLimit = entries.find(d => d.step === 'RATE_LIMIT');
  const rampBlock = entries.find(d => d.step === 'RAMP_BLOCK');
  const demandGuard = entries.find(d => d.step === 'DEMAND_GUARD');
  const proactive = entries.find(d => d.step === 'PROACTIVE');
  const marginLearn = entries.find(d => d.step === 'MARGIN_LEARN');
  const utilLearn = entries.find(d => d.step === 'UTIL_LEARN');
  const rateLearn = entries.find(d => d.step === 'RATE_LEARN');
  const coolerStale = entries.find(d => d.step === 'COOLER_STALE');
  const noCooling = entries.find(d => d.step === 'COOLING_CAPABILITY');
  const noConfig = entries.find(d => d.step === 'COOLER_CONFIG');
  const utilEntries = entries.filter(d => d.step === 'COOLING_UTIL');
  const hystKick = entries.find(d => d.step === 'HYSTERESIS_KICK');
  const hystKickNoop = entries.find(d => d.step === 'HYSTERESIS_KICK_NOOP');
  const hystDeadband = entries.find(d => d.step === 'HYSTERESIS_DEADBAND');
  const hystRevert = entries.find(d => d.step === 'HYSTERESIS_REVERT');
  const kickFlag = entries.find(d => d.step === 'KICK_FLAG');
  const minMargin = entries.find(d => d.step === 'MIN_MARGIN');
  const coolerIdle = entries.find(d => d.step === 'COOLER_IDLE');

  // Error/skip states
  if (noConfig) return <div className="text-[11px] text-muted-foreground flex items-center gap-2"><XCircle className="h-3 w-3 text-red-400" />{noConfig.message}</div>;
  if (coolerStale) return <div className="text-[11px] text-red-400 flex items-center gap-2"><AlertTriangle className="h-3 w-3" />{coolerStale.message}</div>;
  if (noCooling) return <div className="text-[11px] text-muted-foreground flex items-center gap-2"><Info className="h-3 w-3" />{noCooling.message}</div>;

  const statusDet = status?.details || {};
  const marginDet = marginCalc?.details || {};
  const effectiveDet = effectiveTarget?.details || {};
  const coolerTemp = r1(statusDet.current_temp as number);
  const coolerTarget = r1(statusDet.target_temp as number);
  const learnedMargin = r1(marginDet.learned_margin as number);
  const minEffective = r1(marginDet.min_effective as number);
  const samples = marginDet.margin_samples as number;

  // Determine outcome
  const isBlocked = !!rampBlock;
  const isDemandGuarded = !!demandGuard;
  const isRateLimited = !!rateLimit;
  const isOk = !!coolerOk;
  const isAdjusted = !!adjustment;

  // Format RAPT timestamp for tooltip
  const coolerUtilTooltip = buildUtilTooltip({
    lastUpdate: statusDet.last_update as string | null,
    recentPct: statusDet.recent_utilization as number | null,
    midPct: statusDet.mid_utilization as number | null,
    oldestPct: statusDet.oldest_utilization as number | null,
    ancientPct: statusDet.ancient_utilization as number | null,
    pct: statusDet.cooler_utilization as number | null,
    prevAt: statusDet.prev_at as string | null,
    p2At: statusDet.p2_at as string | null,
    anchorAt: statusDet.anchor_at as string | null,
    p4At: statusDet.p4_at as string | null,
  });

  return (
    <div className="space-y-1">
      {/* All rows use CoolerSubSection for consistent alignment */}

      {/* ── Kylare ── */}
      <CoolerSubSection label="Kylare" icon={<Thermometer className="h-2.5 w-2.5" />}>
        <span className="font-mono font-medium">{coolerTemp}°</span>
        <span className="text-muted-foreground text-[10px]">(Mål {coolerTarget}°)</span>
      </CoolerSubSection>

      {/* ── Aktiverad ── */}
      <CoolerSubSection label="Aktiverad" icon={<Activity className="h-2.5 w-2.5" />}>
        {statusDet.cooler_utilization != null ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={`font-mono font-medium cursor-help ${(statusDet.cooler_utilization as number) >= 80 ? 'text-amber-400' : (statusDet.cooler_utilization as number) >= 40 ? 'text-foreground' : 'text-muted-foreground'}`}>
                {statusDet.cooler_utilization as number}%
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs whitespace-pre-line">{coolerUtilTooltip}</TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="font-mono text-[10px] text-muted-foreground/40 cursor-help">- %</span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs whitespace-pre-line">{coolerUtilTooltip}</TooltipContent>
          </Tooltip>
        )}
      </CoolerSubSection>

      {/* ── Lägsta behov ── */}
      <CoolerSubSection label="Lägsta behov" icon={<TrendingDown className="h-2.5 w-2.5" />}>
        {effectiveTarget ? (() => {
          const effCtrlName = effectiveDet.controller as string;
          const matchingUtil = utilEntries.find(u => u.message.split(':')[0].trim() === effCtrlName);
          const mDet = matchingUtil?.details || {};
          const mUtilMatch = matchingUtil?.message.match(/util=(\d+)%/);
          const mUtilPct = mUtilMatch ? parseInt(mUtilMatch[1]) : null;
          const mTip = buildUtilTooltip({
            lastUpdate: mDet.last_update as string | null,
            recentPct: mDet.recent_utilization as number | null,
            midPct: mDet.mid_utilization as number | null,
            oldestPct: mDet.oldest_utilization as number | null,
            ancientPct: mDet.ancient_utilization as number | null,
            pct: mUtilPct,
            prevAt: mDet.prev_at as string | null,
            p2At: mDet.p2_at as string | null,
            anchorAt: mDet.anchor_at as string | null,
            p4At: mDet.p4_at as string | null,
          });
          return (
            <>
              <span className="font-mono font-medium" style={{ color: 'hsl(210 80% 60%)' }}>
                {r1((effectiveTarget.details?.temp ?? effectiveTarget.details?.effective_target) as number)}°
              </span>
              {mTip !== 'Ingen data ännu' ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-muted-foreground text-[10px] cursor-help">({effCtrlName}{mUtilPct != null ? ` ${mUtilPct}%` : ''})</span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs whitespace-pre-line">{mTip}</TooltipContent>
                </Tooltip>
              ) : (
                <span className="text-muted-foreground text-[10px]">({effCtrlName})</span>
              )}
              {/* Extra tank utilizations */}
              {utilEntries.map((u, i) => {
                const isActive = u.message.includes('❄️');
                const name = u.message.split(':')[0].trim();
                const utilMatch = u.message.match(/util=(\d+)%/);
                const utilPct = utilMatch ? parseInt(utilMatch[1]) : null;
                if (effCtrlName && name === effCtrlName) return null;
                const uDet = u.details || {};
                const tankUtilTip = buildUtilTooltip({
                  lastUpdate: uDet.last_update as string | null,
                  recentPct: uDet.recent_utilization as number | null,
                  midPct: uDet.mid_utilization as number | null,
                  oldestPct: uDet.oldest_utilization as number | null,
                  ancientPct: uDet.ancient_utilization as number | null,
                  pct: utilPct,
                  prevAt: uDet.prev_at as string | null,
                  p2At: uDet.p2_at as string | null,
                  anchorAt: uDet.anchor_at as string | null,
                  p4At: uDet.p4_at as string | null,
                });
                return (
                  <Tooltip key={i}>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-help">
                        <span>{isActive ? '❄️' : '⏸️'}</span>
                        <span>{name}</span>
                        {utilPct != null ? (
                          <span className={`font-mono font-medium ${utilPct >= 80 ? 'text-amber-400' : utilPct >= 40 ? 'text-foreground' : 'text-muted-foreground'}`}>
                            {utilPct}%
                          </span>
                        ) : (
                          <span className="font-mono text-muted-foreground/50">—</span>
                        )}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs whitespace-pre-line">{tankUtilTip}</TooltipContent>
                  </Tooltip>
                );
              })}
            </>
          );
        })() : <span className="text-muted-foreground/40 text-[10px]">—</span>}
      </CoolerSubSection>

      {/* ── Marginal ── */}
      {marginCalc && (
        <CoolerSubSection label="Marginal" icon={<Ruler className="h-2.5 w-2.5" />}>
          <span className="font-mono text-foreground">{learnedMargin}°</span>
          {minEffective && <span className="text-muted-foreground text-[10px]">Min eff: <span className="font-mono">{minEffective}°</span></span>}
          {samples != null && <span className="text-muted-foreground text-[10px]">({samples} samples)</span>}
          {marginDet.required_rate != null && (
            <span className="text-muted-foreground text-[10px]">Krav: <span className="font-mono">{r1(marginDet.required_rate as number)}°/h</span></span>
          )}
        </CoolerSubSection>
      )}

      {/* Separator before feature toggles */}
      <div className="pt-1 border-t border-border/20 space-y-1">

        {/* ── Proaktiv ── */}
        <CoolerSubSection label="Proaktiv" icon={<Info className="h-2.5 w-2.5 text-blue-400" />}>
          {proactive ? (
            <span style={{ color: 'hsl(210 80% 70%)' }}>{proactive.message}</span>
          ) : (
            <span className="text-muted-foreground/40 text-[10px]">Ej aktiv</span>
          )}
        </CoolerSubSection>

        {/* ── Hysteres-kick ── */}
        <CoolerSubSection label="Hysteres-kick" icon={<Zap className="h-2.5 w-2.5" />}>
          {hystKick ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 text-[10px]">
              <Zap className="h-2.5 w-2.5" />
              Aktiverad
            </span>
          ) : hystRevert ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400 text-[10px]">
              <Zap className="h-2.5 w-2.5" />
              {hystRevert.message}
            </span>
          ) : hystDeadband ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-muted-foreground/40 text-[10px] cursor-help">Ej aktiv</span>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs max-w-[300px]">{hystDeadband.message}{hystKickNoop ? `\n${hystKickNoop.message}` : ''}</TooltipContent>
            </Tooltip>
          ) : hystKickNoop ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-muted-foreground/40 text-[10px] cursor-help">Ej aktiv</span>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">{hystKickNoop.message}</TooltipContent>
            </Tooltip>
          ) : (
            <span className="text-muted-foreground/40 text-[10px]">Ej aktiv</span>
          )}
        </CoolerSubSection>

        {/* ── Inlärning ── */}
        <CoolerSubSection label="Inlärning" icon={<GraduationCap className="h-2.5 w-2.5 text-purple-400" />}>
          <div className="flex flex-wrap items-center gap-1.5">
            {marginLearn && marginLearn.result === 'action' ? (() => {
              const ml = marginLearn.details || {};
              const oldVal = ml.old_value as number;
              const newVal = ml.new_value as number;
              const direction = (oldVal != null && newVal != null && newVal < oldVal) ? '↓' : '↑';
              return (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 text-[10px]">
                  Marginal
                  {oldVal != null && newVal != null ? (
                    <span className="font-mono">{oldVal.toFixed(2)}° {direction} {newVal.toFixed(2)}°</span>
                  ) : (
                    <span>{marginLearn.message.replace(/.*tightening:|.*widening:|.*nudging:/, '').trim()}</span>
                  )}
                </span>
              );
            })() : null}
            {rateLearn && rateLearn.result === 'action' ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 text-[10px]">
                Rate
                <span className="font-mono">{rateLearn.message.replace(/.*→\s*/, '').trim()}</span>
              </span>
            ) : null}
            {utilLearn && utilLearn.result === 'action' ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 text-[10px]">
                Util
                <span className="font-mono">{utilLearn.message.replace(/.*→\s*/, '').trim()}</span>
              </span>
            ) : null}
            {minMargin && minMargin.result === 'action' ? (() => {
              const mm = minMargin.details || {};
              const oldVal = mm.old_value as number;
              const newVal = mm.new_value as number;
              return (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 text-[10px]">
                  Min eff
                  {oldVal != null && newVal != null ? (
                    <span className="font-mono">{oldVal.toFixed(2)}° → {newVal.toFixed(2)}°</span>
                  ) : (
                    <span className="font-mono">{minMargin.message.replace(/^.*:/, '').trim()}</span>
                  )}
                </span>
              );
            })() : null}
            {(() => {
              const hasActiveLearn = (marginLearn?.result === 'action') || (rateLearn?.result === 'action') || (utilLearn?.result === 'action') || (minMargin?.result === 'action');
              if (hasActiveLearn) return null;
              const skipReason = marginLearn?.message || 'Ingen aktiv inlärning';
              return (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-muted-foreground/40 text-[10px] cursor-help">Ej aktiv</span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">{skipReason}</TooltipContent>
                </Tooltip>
              );
            })()}
          </div>
        </CoolerSubSection>

        {/* ── Beslut (sist — resultat) ── */}
        <CoolerSubSection label="Beslut" icon={<Wrench className="h-2.5 w-2.5" />}>
          {(() => {
            const historyLines = recentCoolerAdjs.length > 0
              ? recentCoolerAdjs.map(a => {
                  const time = new Date(a.created_at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
                  return `${time}: ${r1(a.old_target_temp)}° → ${r1(a.new_target_temp)}°`;
                }).join('\n')
              : 'Inga justeringar ännu';

            const badge = isAdjusted ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-medium cursor-help">
                <Wrench className="h-2.5 w-2.5" />
                {(() => {
                  const adjDet = adjustment.details || {};
                  const oldT = adjDet.old_target as number;
                  const newT = adjDet.new_target as number;
                  return oldT != null && newT != null
                    ? <span className="font-mono">{r1(oldT)}° → {r1(newT)}°</span>
                    : <span>{adjustment.message}</span>;
                })()}
              </span>
            ) : isDemandGuarded ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400 cursor-help">
                    <ShieldAlert className="h-2.5 w-2.5" />Demand guard
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs max-w-[300px]">{demandGuard!.message}</TooltipContent>
              </Tooltip>
            ) : isBlocked ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 cursor-help">
                <ShieldAlert className="h-2.5 w-2.5" />Ramp-block
              </span>
            ) : isRateLimited ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-muted-foreground cursor-help">
                <Clock className="h-2.5 w-2.5" />Rate-limit
              </span>
            ) : isOk ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 cursor-help">
                <CheckCircle2 className="h-2.5 w-2.5" />OK
                {(() => {
                  const diffMatch = coolerOk.message.match(/Ändring ([0-9.]+)°C/);
                  return diffMatch ? <span className="font-mono text-[10px] opacity-70">Δ{diffMatch[1]}°</span> : null;
                })()}
              </span>
            ) : coolerIdle ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-muted-foreground cursor-help">
                <Info className="h-2.5 w-2.5" />{coolerIdle.message}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-muted-foreground cursor-help">
                <Info className="h-2.5 w-2.5" />Ingen åtgärd
              </span>
            );

            return (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>{badge}</TooltipTrigger>
                  <TooltipContent side="top" className="text-xs whitespace-pre-line font-mono max-w-[300px]">
                    {isOk && coolerOk?.message ? `${coolerOk.message}\n\n` : ''}{historyLines}
                  </TooltipContent>
                </Tooltip>
                {isOk && coolerOk?.message && (
                  <span className="text-muted-foreground/70 text-[10px] ml-1 break-words">{coolerOk.message}</span>
                )}
              </>
            );
          })()}
        </CoolerSubSection>

      </div>
    </div>
  );
}

// --- Pipeline View ---

function PipelineView({ decisions, hideSync, hidePid, recentCoolerAdjs }: {
  decisions: DecisionEntry[]; hideSync: boolean; hidePid: boolean;
  recentCoolerAdjs: (AdjustmentLog & { category: AdjustmentCategory })[];
}) {
  const syncEntriesRaw = decisions.filter(d => d.step === 'SYNC_DATA');
  // Sort: active controllers first (alphabetically), then inactive, then glycol last
  const syncEntries = [...syncEntriesRaw].sort((a, b) => {
    const aD = a.details || {};
    const bD = b.details || {};
    const aGlycol = !!aD.glycol;
    const bGlycol = !!bD.glycol;
    if (aGlycol !== bGlycol) return aGlycol ? 1 : -1;
    const aInactive = !!aD.inactive && !aD.stale;
    const bInactive = !!bD.inactive && !bD.stale;
    if (aInactive !== bInactive) return aInactive ? 1 : -1;
    const aName = a.message.replace('Controller: ', '');
    const bName = b.message.replace('Controller: ', '');
    return aName.localeCompare(bName);
  });
  const brewSgEntries = decisions.filter(d => d.step === 'BREW_SG_STATUS');
  const utilEntries = decisions.filter(d => d.step === 'COOLING_UTIL');
  // Build a map of pill/brew data per controller name for merging into SYNC_DATA
  const brewSgByName = new Map<string, DecisionEntry>();
  brewSgEntries.forEach(d => {
    const name = d.message.replace('Controller: ', '');
    brewSgByName.set(name, d);
  });
  // Build a map of utilization per controller name
  const utilByName = new Map<string, { pct: number | null; active: boolean; recentPct: number | null; midPct: number | null; oldestPct: number | null; ancientPct: number | null; lastUpdate: string | null; prevAt: string | null; p2At: string | null; anchorAt: string | null; p4At: string | null }>();
  utilEntries.forEach(d => {
    const name = d.message.split(':')[0].trim();
    const utilMatch = d.message.match(/util=(\d+)%/);
    const pct = utilMatch ? parseInt(utilMatch[1]) : null;
    const active = d.message.includes('❄️');
    const det = d.details || {};
    utilByName.set(name, {
      pct, active,
      recentPct: det.recent_utilization as number | null,
      midPct: det.mid_utilization as number | null,
      oldestPct: det.oldest_utilization as number | null,
      ancientPct: det.ancient_utilization as number | null,
      lastUpdate: det.last_update as string | null,
      prevAt: det.prev_at as string | null,
      p2At: det.p2_at as string | null,
      anchorAt: det.anchor_at as string | null,
      p4At: det.p4_at as string | null,
    });
  });
  const pidStatusEntries = decisions.filter(d => d.step === 'PILL_COMP_STATUS');
  const pidActionEntries = decisions.filter(d => d.step === 'PILL_COMP_ACTION');
  const stallEntries = decisions.filter(d => d.step.startsWith('STALL'));
  const coolerEntries = decisions.filter(d =>
    d.step === 'COOLING' || d.step.startsWith('COOLER_') ||
    d.step === 'COOLING_CAPABILITY' || d.step === 'COOLING_UTIL' ||
    d.step === 'EFFECTIVE_TARGET' || d.step === 'MARGIN_CALC' ||
    d.step === 'RATE_LIMIT' || d.step === 'DEMAND_GUARD' ||
    d.step === 'RAMP_BLOCK' || d.step === 'PROACTIVE' ||
    d.step === 'RATE_LEARN' || d.step === 'MARGIN_LEARN' || d.step === 'UTIL_LEARN' ||
    d.step === 'ADJUSTMENT' || d.step === 'MAX_MARGIN' || d.step === 'MIN_MARGIN' ||
    d.step === 'HYSTERESIS_KICK' || d.step === 'HYSTERESIS_KICK_NOOP' || d.step === 'HYSTERESIS_DEADBAND' || d.step === 'HYSTERESIS_REVERT' || d.step === 'KICK_FLAG' || d.step === 'COOLER_IDLE'
  );
  const smartRelayEntries: typeof decisions = [];
  const raptSendEntries = decisions.filter(d => d.step === 'RAPT_SEND' || d.step === 'BATCH_FLUSH');
  const passThroughEntries = decisions.filter(d => d.step === 'PASS_THROUGH');
  const otherEntries = decisions.filter(d =>
    !HIDDEN_STEPS.has(d.step) && !PIPELINE_STEPS.has(d.step) && d.step !== 'PILL_COMP_ACTION'
  );

  // Build a map of PILL_COMP_ACTION per controller name for PID table integration
  const actionByName = new Map<string, { newTarget: number | null; noChange: boolean; brakes: string[] }>();
  pidActionEntries.forEach(d => {
    const parsed = parsePillCompActionTarget(d.message);
    const brakes = parsePillCompActionBrakes(d.message);
    actionByName.set(parsed.name, { newTarget: parsed.newTarget, noChange: parsed.noChange, brakes });
  });

  return (
    <div className="space-y-2">
      {/* 1. SYNC_DATA (merged with pill/brew data) */}
      {!hideSync && syncEntries.length > 0 && (
        <PipelineSection icon={<Database className="h-3 w-3" />} title="Synk-data" color="muted-foreground">
          <div className="overflow-x-auto -mx-2 px-2">
          <table className="w-full text-[10px] min-w-[520px]">
            <thead>
              <tr className="text-muted-foreground/80 border-b border-border/40 bg-muted/30">
                <th className="text-left py-1 pr-2 pl-1.5 font-semibold whitespace-nowrap">Controller</th>
                <th className="text-right py-1 px-1.5 font-semibold whitespace-nowrap">Pill</th>
                <th className="text-right py-1 px-1.5 font-semibold whitespace-nowrap">Ctrl</th>
                <th className="text-right py-1 px-1.5 font-semibold whitespace-nowrap">Mål</th>
                <th className="text-right py-1 px-1.5 font-semibold whitespace-nowrap">Profil</th>
                <th className="text-center py-1 px-1.5 font-semibold whitespace-nowrap">Kyla</th>
                <th className="text-center py-1 px-1.5 font-semibold whitespace-nowrap">Behov</th>
                <th className="text-center py-1 px-1.5 font-semibold whitespace-nowrap">Status</th>
                <th className="text-right py-1 px-1.5 font-semibold whitespace-nowrap">RAPT</th>
              </tr>
            </thead>
            <tbody>
              {syncEntries.map((d, i) => {
                const det = d.details || {};
                const name = d.message.replace('Controller: ', '');
                const pillData = brewSgByName.get(name);
                const pillDet = pillData?.details || {};
                const util = utilByName.get(name);
                const lastUpdate = det.last_update as string | null;
                const isStale = !!det.stale;
                const isGlycol = !!det.glycol;
                const isInactive = !!det.inactive;
                const rowDimmed = isInactive && !isStale;
                return (
                  <React.Fragment key={i}>
                    <tr className={`border-b ${pillData ? 'border-border/5' : 'border-border/10'} ${i % 2 === 0 ? 'bg-muted/10' : ''} ${rowDimmed ? 'opacity-50' : ''}`}>
                      <td className="py-1 pr-2 pl-1.5 font-medium whitespace-nowrap">
                        <span className="flex items-center gap-1">
                          {name}
                          {isStale && (
                            <TooltipProvider delayDuration={200}><Tooltip><TooltipTrigger asChild><span className="text-[9px] px-1 py-0 rounded bg-destructive/20 text-destructive cursor-help">offline</span></TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">Ingen sensordata — controllern exkluderas från automation</TooltipContent></Tooltip></TooltipProvider>
                          )}
                          {isGlycol && (
                            <TooltipProvider delayDuration={200}><Tooltip><TooltipTrigger asChild><span className="text-[9px] px-1 py-0 rounded bg-sky-500/15 text-sky-400 cursor-help">glykol</span></TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">Glykolkylare — styrs av automationens kylarmodul</TooltipContent></Tooltip></TooltipProvider>
                          )}
                          {isInactive && !isStale && (
                            <TooltipProvider delayDuration={200}><Tooltip><TooltipTrigger asChild><span className="text-[9px] px-1 py-0 rounded bg-muted text-muted-foreground cursor-help">av</span></TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">Varken kyla eller värme är aktiverad — inte inkluderad i automation</TooltipContent></Tooltip></TooltipProvider>
                          )}
                        </span>
                      </td>
                      <td className="py-1 px-1.5 text-right whitespace-nowrap" style={{ color: 'hsl(38 92% 50%)' }}>{r1(det.pill_temp as number)}</td>
                      <td className="py-1 px-1.5 text-right whitespace-nowrap">{r1(det.ctrl_temp as number)}</td>
                      <td className="py-1 px-1.5 text-right whitespace-nowrap">{r1(det.ctrl_target as number)}</td>
                      <td className="py-1 px-1.5 text-right font-medium whitespace-nowrap" style={{ color: 'hsl(280 60% 60%)' }}>{r1(det.profile_target as number)}</td>
                      <td className="py-1 px-1.5 text-center whitespace-nowrap">
                        {util ? (() => {
                          const utilTip = buildUtilTooltip({
                            lastUpdate: util.lastUpdate,
                            recentPct: util.recentPct,
                            midPct: util.midPct,
                            oldestPct: util.oldestPct,
                            ancientPct: util.ancientPct,
                            pct: util.pct,
                            prevAt: util.prevAt,
                            p2At: util.p2At,
                            anchorAt: util.anchorAt,
                            p4At: util.p4At,
                          });
                          return (
                            <TooltipProvider delayDuration={200}><Tooltip>
                              <TooltipTrigger asChild>
                                <span className={`font-mono cursor-help ${util.pct != null && util.pct >= 80 ? 'text-amber-400' : util.pct != null && util.pct >= 40 ? 'text-foreground' : 'text-muted-foreground'}`}>
                                  {util.active ? '❄️' : '⏸️'}{util.pct != null ? ` ${util.pct}%` : ' —'}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs whitespace-pre-line">{utilTip}</TooltipContent>
                            </Tooltip></TooltipProvider>
                          );
                        })() : (
                          <TooltipProvider delayDuration={200}><Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-muted-foreground/40 font-mono cursor-help">- %</span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">Ingen kyldata för denna controller</TooltipContent>
                          </Tooltip></TooltipProvider>
                        )}
                      </td>
                      <td className="py-1 px-1.5 text-center whitespace-nowrap">
                        {det.duty_pct != null ? (
                          <TooltipProvider delayDuration={200}><Tooltip>
                            <TooltipTrigger asChild>
                              <span className={`font-mono cursor-help ${(det.duty_pct as number) >= 50 ? 'text-amber-400' : (det.duty_pct as number) >= 25 ? 'text-foreground' : 'text-muted-foreground'}`}>
                                {String(det.duty_pct)}%
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                              Inlärt kylbehov: {String(det.duty_pct)}% = ~{Math.round((det.duty_pct as number) / 100 * 300)}s per 5 min
                              {det.duty_samples != null && ` (${String(det.duty_samples)} mätningar)`}
                            </TooltipContent>
                          </Tooltip></TooltipProvider>
                        ) : (
                          <span className="text-muted-foreground/40 font-mono">—</span>
                        )}
                      </td>
                      <td className="py-1 px-1.5 text-center whitespace-nowrap">
                        {det.preserved ? (
                          <TooltipProvider delayDuration={200}><Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400 cursor-help">bevarad</span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs max-w-[200px]">Databasens måltemp bevaras (aktiv profil, PID eller kylare) istället för RAPT-hårdvarans värde</TooltipContent>
                          </Tooltip></TooltipProvider>
                        ) : (
                          <TooltipProvider delayDuration={200}><Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground cursor-help">hw</span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs max-w-[200px]">Måltemperaturen kommer direkt från RAPT-hårdvaran utan överskrivning</TooltipContent>
                          </Tooltip></TooltipProvider>
                        )}
                      </td>
                      <td className="py-1 px-1.5 text-right text-muted-foreground font-mono whitespace-nowrap">
                        {lastUpdate || '—'}
                      </td>
                    </tr>
                    {pillData && (
                      <tr className="border-b border-border/10 bg-[hsl(38_92%_50%/0.04)]">
                        <td colSpan={9} className="py-1 px-1.5 pl-4">
                          <div className="flex items-center gap-3 text-muted-foreground whitespace-nowrap">
                            <span className="flex items-center gap-1" style={{ color: 'hsl(38 92% 50%)' }}>
                              <Pill className="h-2.5 w-2.5" />
                              <span className="text-[9px] font-medium">Pill</span>
                            </span>
                            {pillDet.current_sg != null && (
                              <span className="whitespace-nowrap">SG: <span className="font-mono" style={{ color: 'hsl(160 60% 50%)' }}>{(pillDet.current_sg as number).toFixed(3)}</span></span>
                            )}
                            {pillDet.battery != null && (
                              <span className="whitespace-nowrap">🔋 {parseFloat((pillDet.battery as number).toFixed(1))}%</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
        </PipelineSection>
      )}

      {/* 2. PID-reglering */}
      {!hidePid && pidStatusEntries.length > 0 && (
        <PipelineSection
          icon={<Gauge className="h-3 w-3" />}
          title="PID-reglering"
          color="hsl(220 70% 55%)"
          borderColor="hsl(220 70% 55% / 0.3)"
          bgColor="hsl(220 70% 55% / 0.05)"
        >
          <div className="overflow-x-auto -mx-2 px-2">
          <table className="w-full text-[10px] min-w-[520px]">
            <thead>
              <tr className="text-muted-foreground/80 border-b border-border/40 bg-[hsl(220_70%_55%/0.08)]">
                {/* Info columns */}
                <th className="text-left py-1 pr-2 pl-1.5 font-semibold whitespace-nowrap">Controller</th>
                <th className="text-right py-1 px-1.5 font-semibold whitespace-nowrap">Är</th>
                <th className="text-center py-1 px-0 font-medium text-muted-foreground/20">│</th>
                {/* Calculation columns: Profil − Δ + PI = Nytt mål */}
                <th className="text-right py-1 px-1.5 font-semibold whitespace-nowrap">Profil</th>
                <th className="text-right py-1 px-1.5 font-semibold whitespace-nowrap">Δ</th>
                <th className="text-right py-1 px-1.5 font-semibold whitespace-nowrap">PI</th>
                <th className="text-center py-1 px-0 font-medium text-muted-foreground/30">=</th>
                <th className="text-right py-1 px-1.5 font-semibold whitespace-nowrap" style={{ color: 'hsl(var(--ferment-green))' }}>Nytt mål</th>
                <th className="text-center py-1 px-0 font-medium text-muted-foreground/20">│</th>
                {/* Result columns */}
                <th className="text-right py-1 px-1.5 font-semibold whitespace-nowrap">Ctrl mål</th>
                <th className="text-right py-1 px-1.5 font-semibold whitespace-nowrap">Diff</th>
              </tr>
            </thead>
            <tbody>
              {pidStatusEntries.map((d, i) => {
                const det = d.details || {};
                const name = d.message.replace('Controller: ', '');
                const delta = det.delta as number;
                const rawDelta = (det.raw_delta as number) ?? delta;
                const loggedComp = (det.compensation as number) ?? rawDelta ?? 0;
                // Use raw_delta (= avgDelta = sensor delta / 2) for display,
                // NOT the back-calculated effectiveDelta which includes clamps/limits
                const comp = rawDelta ?? loggedComp;
                const errCorr = (det.error_correction as number) ?? 0;
                const pCorr = det.p_correction as number;
                const iCorr = det.i_correction as number;
                const learnedBaseline = det.learned_baseline as number;
                const rawComp = det.raw_compensation as number;
                const damping = det.damping as number;
                const mode = det.mode as string;
                const action = actionByName.get(name);
                const actualTempVal = det.actual_temp as number ?? det.avg_temp as number;
                const dualSensors = det.dual_sensors as boolean;
                const actualTargetVal = det.actual_target as number ?? det.base_target as number;
                const ctrlTarget = det.ctrl_target as number;
                const ctrlTargetPid = det.ctrl_target_pid as number;
                const rawCtrlTargetPid = det.raw_ctrl_target_pid as number;
                const statusLimits = (det.limits as string[]) ?? [];

                // "Nytt mål" = formula result: Profil − Δ + PI (using displayed values)
                // This matches what the user sees in the formula columns.
                // ctrlTargetPid (from backend) may differ due to rate limits, clamps etc.
                const formulaResult = actualTargetVal != null && comp != null
                  ? actualTargetVal - comp + (errCorr ?? 0)
                  : null;

                // Show diff between formula result and current hardware target
                const diff = formulaResult != null && ctrlTarget != null
                  ? formulaResult - ctrlTarget
                  : null;

                return (
                  <React.Fragment key={i}>
                  <tr className={`border-b border-border/10 ${i % 2 === 0 ? 'bg-muted/10' : ''}`}>
                    {/* Info: Controller + Begränsningar */}
                    <td className="py-1 pr-2 pl-1.5 font-medium whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        {name}
                        {mode && (
                          <span className={`text-[8px] ${mode === 'cooling' ? 'text-sky-400' : 'text-orange-400'}`}>
                            {mode === 'cooling' ? '❄️' : '🔥'}
                          </span>
                        )}
                      </div>
                      {(() => {
                        // Use limits from STATUS data directly, fall back to ACTION brakes
                        const brakes: { label: string; tip: string }[] = [];
                         const rawVal = formulaResult;
                         const clampedVal = ctrlTargetPid;
                         const clampDiff = rawVal != null && clampedVal != null ? rawVal - clampedVal : null;
                         const clampDiffStr = clampDiff != null && Math.abs(clampDiff) >= 0.05 ? `${clampDiff >= 0 ? '+' : ''}${r1(clampDiff)}° begränsat` : '';
                        if (statusLimits.length > 0) {
                          if (statusLimits.includes('overshoot-clamp')) brakes.push({ label: '🔒 Overshoot', tip: `Begränsar mål till probe-temp för att inte starta fel läge. ${clampDiffStr}` });
                          if (statusLimits.includes('overshoot-release')) brakes.push({ label: '🛑 Release', tip: 'Probe nära mål — overshoot-skydd aktivt' });
                          if (statusLimits.includes('ramp-hold')) brakes.push({ label: '🔒 Ramp', tip: `Håller target under ramp — låter profilen komma ikapp. ${clampDiffStr}` });
                          if (statusLimits.includes('approach-release')) {
                            const dist = actualTempVal != null && actualTargetVal != null ? Math.abs(actualTempVal - actualTargetVal) : null;
                            const approachC2 = statusLimits.find(c => c.startsWith('approach='));
                            const scale = approachC2 ? approachC2.split('=')[1] : null;
                            const distStr = dist != null ? ` Avstånd: ${r1(dist)}° från mål.` : '';
                            const scaleStr = scale ? ` Δ-skalning: ×${scale}.` : '';
                            const releaseStr = ' Släpper vid <1° från mål.';
                            brakes.push({ label: '🚀 Approach', tip: `Rate-limitad mot mål.${distStr}${scaleStr}${releaseStr} ${clampDiffStr}` });
                          }
                          if (statusLimits.includes('dir-clamp')) brakes.push({ label: '🔒 Riktning', tip: `Kan inte överskrida profilmål under ramp. ${clampDiffStr}` });
                          const rateLimitC = statusLimits.find(c => c.startsWith('rate-limit='));
                          if (rateLimitC) { const v = rateLimitC.split('=')[1]; brakes.push({ label: `⏱ ${v}°/c`, tip: `Max ändring ${v}°C per cykel. ${clampDiffStr}` }); }
                          const hwMin = statusLimits.find(c => c.startsWith('hw-min='));
                          if (hwMin) brakes.push({ label: `⬇ Min ${hwMin.split('=')[1]}°`, tip: `Hårdvarugräns min ${hwMin.split('=')[1]}°C. ${clampDiffStr}` });
                          const hwMax = statusLimits.find(c => c.startsWith('hw-max='));
                          if (hwMax) brakes.push({ label: `⬆ Max ${hwMax.split('=')[1]}°`, tip: `Hårdvarugräns max ${hwMax.split('=')[1]}°C. ${clampDiffStr}` });
                          const approachC = statusLimits.find(c => c.startsWith('approach='));
                          if (approachC) brakes.push({ label: `🎯 ${approachC.split('=')[1]}`, tip: `Approach-skalning: delta-komp × ${approachC.split('=')[1]} (nära mål)` });
                          const deltaDamp = statusLimits.find(c => c.startsWith('delta-damp='));
                          if (deltaDamp) brakes.push({ label: `🌊 ${deltaDamp.split('=')[1]}`, tip: `Hög delta-dämpning: rate × ${deltaDamp.split('=')[1]} (Δ > 4°C)` });
                          const utilSat = statusLimits.find(c => c.startsWith('util-sat='));
                          if (utilSat) brakes.push({ label: `⚡ Util ${utilSat.split('=')[1]}`, tip: `Kylkretsen körs ${utilSat.split('=')[1]} av tiden — hårdvaran maxad, PID begränsas` });
                          const heatGuard = statusLimits.find(c => c.startsWith('heat-guard='));
                          if (heatGuard) brakes.push({ label: `🔥 Heat-guard`, tip: `PID begränsad för att inte aktivera värmaren (hysteres ${heatGuard.split('=')[1]}°C). Temperaturen tillåts stiga naturligt.` });
                        } else if (action?.brakes && action.brakes.length > 0) {
                          action.brakes.forEach(b => brakes.push({ label: b, tip: '' }));
                        }
                        return brakes.length > 0 ? (
                          <div className="flex flex-col gap-0.5 mt-0.5">
                            <div className="flex flex-wrap gap-0.5">
                              {brakes.map((b, bi) => (
                                <span key={bi} className="text-[8px] px-1 py-0 rounded bg-sky-500/15 text-sky-400 whitespace-nowrap">{b.label}</span>
                              ))}
                            </div>
                            {brakes.filter(b => b.tip).map((b, bi) => (
                              <span key={bi} className="text-[8px] text-muted-foreground/70 leading-tight">{b.tip}</span>
                            ))}
                          </div>
                        ) : damping != null && damping < 1.0 ? (
                          <div className="mt-0.5">
                            <TooltipProvider delayDuration={200}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="text-[8px] px-1 py-0 rounded bg-sky-500/15 text-sky-400 cursor-help">damp={r1(damping)}</span>
                                </TooltipTrigger>
                                 <TooltipContent side="top" className="text-[10px]">
                                   D-term dämpning: kompensation × {r1(damping)} (närmar sig mål)
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        ) : null;
                      })()}
                    </td>
                    {/* Info: Är-temp */}
                    <td className="py-1 px-1.5 text-right whitespace-nowrap" style={{ color: dualSensors ? 'hsl(38 92% 50%)' : undefined }}>
                      {r1(actualTempVal)}°
                      {dualSensors && <span className="text-[8px] text-muted-foreground ml-0.5"></span>}
                    </td>
                    {/* Separator */}
                    <td className="py-1 px-0 text-center text-muted-foreground/15">│</td>
                    {/* Calc: Profil (actual_target) */}
                    <td className="py-1 px-1.5 text-right font-medium whitespace-nowrap" style={{ color: 'hsl(280 60% 60%)' }}>
                      {actualTargetVal != null ? `${r1(actualTargetVal)}°` : '—'}
                    </td>
                    {/* Calc: Δ (delta/2 = compensation) */}
                    <td className="py-1 px-1.5 text-right whitespace-nowrap" style={{
                      color: comp != null && Math.abs(comp) > 0.05 ? 'hsl(210 80% 60%)' : undefined
                    }}>
                    {comp != null ? (
                        Math.abs(comp) > 0.01 ? (
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help border-b border-dotted border-current/30">{r1(comp)}°</span>
                            </TooltipTrigger>
                             <TooltipContent side="top" className="text-[10px] max-w-[200px]">
                               <div className="space-y-0.5">
                                 <div>Rå Δ = avg − probe = {(det.raw_delta as number) != null ? `${(det.raw_delta as number) >= 0 ? '+' : ''}${r1(det.raw_delta as number)}°` : delta != null ? `${delta >= 0 ? '+' : ''}${r1(delta)}°` : '?'}</div>
                                {damping != null && damping < 1.0 && <div>× damp {r1(damping)}</div>}
                                <div className="border-t border-border/30 pt-0.5 font-medium">= {r1(comp)}° effektiv kompensation</div>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        ) : <span className="text-muted-foreground/40">0</span>
                      ) : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    {/* Calc: + PI (with tooltip) */}
                    <td className="py-1 px-1.5 text-right whitespace-nowrap" style={{
                      color: errCorr != null && Math.abs(errCorr) > 0.05 ? 'hsl(160 60% 50%)' : undefined
                    }}>
                      {errCorr != null ? (
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className={`cursor-help border-b border-dotted border-current/30 ${Math.abs(errCorr) <= 0.01 ? 'text-muted-foreground/40' : ''}`}>
                                {Math.abs(errCorr) > 0.01 ? `${errCorr >= 0 ? '+' : ''}${r1(errCorr)}°` : '0'}
                              </span>
                            </TooltipTrigger>
                             <TooltipContent side="top" className="text-[10px] max-w-[200px]">
                               <div className="space-y-0.5">
                                 <div>P = {pCorr != null ? `${pCorr >= 0 ? '+' : ''}${r1(pCorr)}°` : '?'}</div>
                                <div>I = {iCorr != null ? `${iCorr >= 0 ? '+' : ''}${r1(iCorr)}°` : '?'}</div>
                                {learnedBaseline != null && Math.abs(learnedBaseline) > 0.01 && errCorr >= 0 && (
                                   <div>Inlärd = {r1(learnedBaseline)}°</div>
                                 )}
                                <div className="border-t border-border/30 pt-0.5 font-medium">= {errCorr >= 0 ? '+' : ''}{r1(errCorr)}° totalt</div>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    {/* = */}
                    <td className="py-1 px-0 text-center text-muted-foreground/25">=</td>
                     {/* Nytt mål = Profil − Δ + PI (formula result) */}
                     <td className="py-1 px-1.5 text-right font-bold whitespace-nowrap" style={{ color: 'hsl(var(--ferment-green))' }}>
                       {formulaResult != null ? (
                         ctrlTargetPid != null && Math.abs(formulaResult - ctrlTargetPid) >= 0.05 ? (
                           <TooltipProvider delayDuration={200}>
                             <Tooltip>
                               <TooltipTrigger asChild>
                                 <span className="cursor-help border-b border-dotted border-current/30">{r1(formulaResult)}°</span>
                               </TooltipTrigger>
                                <TooltipContent side="top" className="text-[10px]">
                                  <div>Formel: {r1(formulaResult)}° → Hårdvara: {r1(ctrlTargetPid)}°</div>
                                 {statusLimits.length > 0 && <div className="text-muted-foreground">{statusLimits.join(', ')}</div>}
                               </TooltipContent>
                             </Tooltip>
                           </TooltipProvider>
                         ) : `${r1(formulaResult)}°`
                       ) : ctrlTargetPid != null ? `${r1(ctrlTargetPid)}°` : '—'}
                     </td>
                    {/* Separator */}
                    <td className="py-1 px-0 text-center text-muted-foreground/15">│</td>
                    {/* Ctrl mål (before) */}
                    <td className="py-1 px-1.5 text-right text-muted-foreground/50 whitespace-nowrap">
                      {ctrlTarget != null ? `${r1(ctrlTarget)}°` : '—'}
                    </td>
                    {/* Diff */}
                    <td className="py-1 px-1.5 text-right font-medium whitespace-nowrap" style={{
                      color: diff != null && Math.abs(diff) > 0.05
                        ? (diff < 0 ? 'hsl(210 80% 60%)' : 'hsl(38 92% 50%)')
                        : undefined
                    }}>
                      {diff != null && Math.abs(diff) > 0.05 ? `${diff >= 0 ? '+' : ''}${r1(diff)}°` : '—'}
                    </td>
                  </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
        </PipelineSection>
      )}

      {/* Smart Relay removed — not supported by RAPT API */}

      {/* 4. Pass-through */}
      {passThroughEntries.length > 0 && (
        <PipelineSection icon={<RefreshCw className="h-3 w-3" />} title="Pass-through" color="hsl(170 60% 45%)" borderColor="hsl(170 60% 45% / 0.3)" bgColor="hsl(170 60% 45% / 0.05)">
          {passThroughEntries.map((d, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px] py-0.5">
              <RefreshCw className="h-3 w-3 flex-shrink-0" style={{ color: 'hsl(170 60% 45%)' }} />
              <span>{d.message}</span>
            </div>
          ))}
        </PipelineSection>
      )}

      {/* 3. Stall-detektering — only show actionable decisions */}
      {stallEntries.length > 0 && (() => {
        // Filter: only show STALL_ANALYSIS (with result), STALL_BOOST, STALL_LEARN, STALL_UNBOOST, STALL_COOLDOWN, STALL_ERROR
        const actionableStall = stallEntries.filter(d =>
          d.step === 'STALL_ANALYSIS' || d.step === 'STALL_BOOST' ||
          d.step === 'STALL_LEARN' || d.step === 'STALL_UNBOOST' ||
          d.step === 'STALL_COOLDOWN' || d.step === 'STALL_ERROR' ||
          d.step === 'STALL_SKIP'
        );
        if (actionableStall.length === 0) return null;
        return (
          <PipelineSection icon={<AlertTriangle className="h-3 w-3" />} title="Stall-detektering" color="hsl(38 92% 55%)" borderColor="hsl(38 92% 55% / 0.3)" bgColor="hsl(38 92% 55% / 0.05)">
            {actionableStall.map((d, i) => {
              const isBoost = d.step === 'STALL_BOOST' || d.step === 'STALL_UNBOOST';
              const isError = d.step === 'STALL_ERROR';
              const isAnalysis = d.step === 'STALL_ANALYSIS';
              const isSkip = d.step === 'STALL_SKIP';
              const stallDetected = isAnalysis && d.result === 'action';
              return (
                <div key={i} className="flex items-start gap-2 text-[11px] py-0.5">
                  <div className="mt-0.5 flex-shrink-0">
                    {isBoost ? <Wrench className="h-3 w-3 text-amber-500" /> :
                     isError ? <XCircle className="h-3 w-3 text-red-400" /> :
                     stallDetected ? <AlertTriangle className="h-3 w-3 text-amber-500" /> :
                     isSkip ? <Info className="h-3 w-3 text-muted-foreground" /> :
                     <CheckCircle2 className="h-3 w-3 text-green-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={`font-medium ${isError ? 'text-red-400' : isSkip ? 'text-muted-foreground' : ''}`}>{d.message}</span>
                    {isAnalysis && d.details && (
                      <span className="text-muted-foreground ml-2">
                        SG: {r1(d.details.sg_rate_per_day as number)}/dag
                        {d.details.activity != null && ` · Akt: ${r1(d.details.activity as number)}`}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </PipelineSection>
        );
      })()}

      {/* 5. Glykol-kylare — structured decision view */}
      {coolerEntries.length > 0 && (
        <PipelineSection icon={<Snowflake className="h-3 w-3" />} title="Glykol-kylare" color="hsl(210 80% 60%)" borderColor="hsl(210 80% 60% / 0.3)" bgColor="hsl(210 80% 60% / 0.05)">
          <CoolerDecisionView entries={coolerEntries} recentCoolerAdjs={recentCoolerAdjs} />
        </PipelineSection>
      )}

      {/* Section 6 removed — merged into section 3 "PID-reglering" above */}

      {/* 7. RAPT_SEND + BATCH_FLUSH */}
      {(() => {
        if (raptSendEntries.length === 0) return null;
        const hasFailure = raptSendEntries.some(d => d.result === 'fail');
        const sectionColor = hasFailure ? 'hsl(0 84% 60%)' : 'hsl(25 95% 53%)';
        const sectionBorder = hasFailure ? 'hsl(0 84% 60% / 0.3)' : 'hsl(25 95% 53% / 0.3)';
        const sectionBg = hasFailure ? 'hsl(0 84% 60% / 0.05)' : 'hsl(25 95% 53% / 0.05)';
        const title = hasFailure ? 'Skickat till RAPT — Timeout' : 'Skickat till RAPT';
        return (
          <PipelineSection icon={<Send className="h-3 w-3" />} title={title} color={sectionColor} borderColor={sectionBorder} bgColor={sectionBg}>
            {raptSendEntries.map((d, i) => {
              const isFail = d.result === 'fail';
              return (
                <div key={`rapt-${i}`} className="flex items-center gap-2 text-[11px] py-0.5">
                  {isFail
                    ? <XCircle className="h-3 w-3 flex-shrink-0 text-red-500" />
                    : <Wrench className="h-3 w-3 flex-shrink-0" style={{ color: 'hsl(25 95% 53%)' }} />
                  }
                  <span className="font-medium" style={{ color: isFail ? 'hsl(0 84% 60%)' : 'hsl(25 80% 60%)' }}>{d.message}</span>
                </div>
              );
            })}
          </PipelineSection>
        );
      })()}

      {/* 7. Remaining (errors, etc.) */}
      {otherEntries.length > 0 && (
        <PipelineSection icon={<AlertTriangle className="h-3 w-3" />} title="Övrigt" color="muted-foreground">
          {otherEntries.map((d, i) => (
            <div key={i} className="flex items-start gap-2 text-[11px]">
              <div className="mt-0.5 flex-shrink-0">
                {d.result === 'pass' ? <CheckCircle2 className="h-3 w-3 text-green-500" /> :
                 d.result === 'fail' ? <XCircle className="h-3 w-3 text-red-500" /> :
                 d.result === 'action' ? <Wrench className="h-3 w-3 text-amber-500" /> :
                 <Info className="h-3 w-3 text-blue-500" />}
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-mono text-muted-foreground text-[10px]">{d.step}</span>
                <span className="text-foreground ml-2 break-words">{d.message}</span>
              </div>
            </div>
          ))}
        </PipelineSection>
      )}
    </div>
  );
}

// --- Pipeline Section wrapper ---

function PipelineSection({ icon, title, color, borderColor, bgColor, children }: {
  icon: React.ReactNode; title: string; color: string; borderColor?: string; bgColor?: string; children: React.ReactNode;
}) {
  return (
    <div className="p-2 rounded border overflow-x-auto" style={{
      borderColor: borderColor || 'hsl(var(--border) / 0.5)',
      background: bgColor || 'hsl(var(--muted) / 0.2)',
    }}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span style={{ color }}>{icon}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

// --- Adjustment Card (glykol, manuell, passthrough only) ---

function AdjustmentCard({ adj }: { adj: AdjustmentLog & { category: AdjustmentCategory } }) {
  const { category } = adj;

  if (category === 'glykol') {
    const isRaising = adj.new_target_temp > adj.old_target_temp;
    const margin = adj.followed_target_temp != null ? Math.abs(adj.followed_target_temp - adj.new_target_temp) : null;
    return (
      <div className="pt-2 border-t border-border text-xs space-y-1.5">
        <p className="font-semibold flex items-center gap-1" style={{ color: 'hsl(210 80% 60%)' }}>❄️ Glykolkylare</p>
        <p className="text-[11px] leading-relaxed">
          {isRaising ? (
            <>Tankens mål har <span className="text-amber-400 font-medium">ökat</span> — kylaren höjs från {r1(adj.old_target_temp)}° till {r1(adj.new_target_temp)}° för att spara energi.</>
          ) : (
            <>Tankens mål har <span className="text-blue-400 font-medium">sänkts</span> — kylaren sänks från {r1(adj.old_target_temp)}° till {r1(adj.new_target_temp)}° för att möta det nya behovet.</>
          )}
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] pt-1 border-t border-border/50">
          <div className="text-muted-foreground">Styrande tank:</div>
          <div className="font-medium">{adj.followed_controller_name || '—'}</div>
          {adj.followed_target_temp !== null && (
            <><div className="text-muted-foreground">Tank mål:</div><div className="font-medium">{adj.followed_target_temp.toFixed(1)}°</div></>
          )}
          <div className="text-muted-foreground">Kylare:</div>
          <div className="font-medium">{r1(adj.old_target_temp)}° → {r1(adj.new_target_temp)}°</div>
          {margin !== null && (
            <><div className="text-muted-foreground">Inlärd marginal:</div><div className="font-medium">{margin.toFixed(1)}°C</div></>
          )}
        </div>
      </div>
    );
  }

  if (category === 'manuell') {
    return (
      <div className="pt-2 border-t border-border text-xs space-y-1">
        <p className="font-semibold" style={{ color: 'hsl(38 92% 55%)' }}>✏️ Manuell justering</p>
        <p className="text-[11px]">{adj.cooler_controller_name}: {r1(adj.old_target_temp)}° → {r1(adj.new_target_temp)}°</p>
      </div>
    );
  }

  if (category === 'passthrough') {
    return (
      <div className="pt-2 border-t border-border text-xs space-y-1">
        <p className="font-semibold" style={{ color: 'hsl(170 60% 45%)' }}>🔄 Synk (pass-through)</p>
        <p className="text-[11px]">{adj.cooler_controller_name}: {r1(adj.old_target_temp)}° → {r1(adj.new_target_temp)}°</p>
      </div>
    );
  }

  return null;
}
