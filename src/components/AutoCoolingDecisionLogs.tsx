import React, { useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, CheckCircle2, XCircle, Info, Wrench, Snowflake, Pill, Gauge, Pencil, RefreshCw, Send, Database, AlertTriangle, ShieldAlert, Clock, GraduationCap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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
  'BATCH_FLUSH', 'BATCH_DB', 'PILL_COMP', 'PILL_COMP_SKIP',
  'BOOTSTRAP', 'STALE_SENSOR',
]);

/** All steps handled by named pipeline sections */
const PIPELINE_STEPS = new Set([
  'SYNC_DATA', 'BREW_SG_STATUS',
  'PILL_COMP_STATUS', 'PILL_COMP_ACTION',
  'PASS_THROUGH',
  'STALL', 'STALL_SKIP', 'STALL_ANALYSIS', 'STALL_BOOST', 'STALL_LEARN',
  'COOLING', 'COOLER_CONFIG', 'COOLER_STATUS', 'COOLER_STALE', 'COOLER_OK',
  'COOLING_CAPABILITY', 'COOLING_UTIL', 'EFFECTIVE_TARGET', 'MARGIN_CALC', 'RATE_LIMIT',
  'RAMP_BLOCK', 'DEMAND_GUARD', 'PROACTIVE', 'RATE_LEARN', 'MARGIN_LEARN', 'UTIL_LEARN', 'MAX_MARGIN',
  'ADJUSTMENT', 'PID_CONTROL', 'BATCH_FLUSH',
  'RAPT_SEND',
]);

// --- Helpers ---

function categorizeAdjustment(reason: string): AdjustmentCategory {
  if (reason.startsWith('✏️')) return 'manuell';
  if (reason.startsWith('🔄')) return 'passthrough';
  if (reason.startsWith('🎯') || reason.startsWith('🔥') || reason.startsWith('🌡️') || reason.startsWith('🧠')) return 'pill-comp';
  if (reason.includes('Cooling recovery') || reason.includes('colder than needed') || reason.includes('struggling to cool') || reason.includes('Ingen följd controller')) return 'glykol';
  return 'glykol';
}

function getCategoryBadge(category: AdjustmentCategory) {
  const styles: Record<AdjustmentCategory, { bg: string; color: string; border: string; icon: React.ReactNode; label: string }> = {
    'pill-comp': { bg: 'hsl(280 60% 60% / 0.2)', color: 'hsl(280 60% 60%)', border: 'hsl(280 60% 60% / 0.3)', icon: <Pill className="h-2.5 w-2.5 mr-0.5" />, label: 'PID' },
    'glykol': { bg: 'hsl(210 80% 60% / 0.2)', color: 'hsl(210 80% 60%)', border: 'hsl(210 80% 60% / 0.3)', icon: <Snowflake className="h-2.5 w-2.5 mr-0.5" />, label: 'Glykol' },
    'manuell': { bg: 'hsl(38 92% 55% / 0.2)', color: 'hsl(38 92% 55%)', border: 'hsl(38 92% 55% / 0.3)', icon: <Pencil className="h-2.5 w-2.5 mr-0.5" />, label: 'Manuell' },
    'passthrough': { bg: 'hsl(170 60% 45% / 0.2)', color: 'hsl(170 60% 45%)', border: 'hsl(170 60% 45% / 0.3)', icon: <RefreshCw className="h-2.5 w-2.5 mr-0.5" />, label: 'Synk' },
  };
  const s = styles[category];
  return (
    <Badge variant="default" className="text-[10px] px-1.5" style={{ background: s.bg, color: s.color, borderColor: s.border }}>
      {s.icon}{s.label}
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
  const [hideSystem, setHideSystem] = useState(false);
  const [hideGlykol, setHideGlykol] = useState(false);
  const [hidePid, setHidePid] = useState(false);
  const [hideSync, setHideSync] = useState(false);

  useEffect(() => {
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
      const [decisionRes, adjustmentRes] = await Promise.all([
        supabase.from('auto_cooling_decision_logs').select('*').order('created_at', { ascending: false }).limit(30),
        supabase.from('auto_cooling_adjustments').select('*').order('created_at', { ascending: false }).limit(50),
      ]);

      const decisions = (decisionRes.data || []).map(log => ({
        ...log, decisions: (log.decisions as unknown) as DecisionEntry[],
      })) as DecisionLog[];

      const adjustments = (adjustmentRes.data || []).map(adj => ({
        ...(adj as unknown as AdjustmentLog), category: categorizeAdjustment(adj.reason),
      }));

      const filteredResults = new Set(['Not actively cooling', 'Not sustained cooling', 'Lowest not cooling']);
      const unified: UnifiedEntry[] = [];
      const usedAdjIds = new Set<string>();

      for (const dec of decisions) {
        if (filteredResults.has(dec.final_result)) continue;
        const decTime = new Date(dec.created_at).getTime();
        const related = adjustments.filter(adj => {
          if (usedAdjIds.has(adj.id)) return false;
          return Math.abs(new Date(adj.created_at).getTime() - decTime) < 15000;
        });
        related.forEach(adj => usedAdjIds.add(adj.id));
        unified.push({ log: dec, adjustments: related, timestamp: dec.created_at });
      }

      // Orphan adjustments (manual, no matching decision)
      const orphans = adjustments.filter(adj => !usedAdjIds.has(adj.id));
      for (const adj of orphans) {
        unified.push({
          log: { id: `orphan-${adj.id}`, created_at: adj.created_at, duration_ms: 0, decision_count: 0, decisions: [], final_result: adj.category === 'manuell' ? 'Manuell justering' : 'Adjustment', adjustment_made: true },
          adjustments: [adj], timestamp: adj.created_at,
        });
      }

      unified.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setEntries(unified.slice(0, 30));
    } catch (error) {
      console.error('Error loading logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (ts: string) => new Date(ts).toLocaleString('sv-SE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  if (loading) return <p className="text-sm text-muted-foreground">Laddar...</p>;
  if (entries.length === 0) return <p className="text-sm text-muted-foreground italic">Inga justeringar har gjorts ännu.</p>;

  const filteredEntries = entries.filter(entry => {
    const hasAdj = entry.adjustments.length > 0;
    const hasPid = entry.adjustments.some(a => a.category === 'pill-comp');
    const hasGlykol = entry.adjustments.some(a => a.category === 'glykol');
    const isSystemOnly = !hasAdj;
    if (hideSystem && isSystemOnly) return false;
    if (hidePid && hasPid && !hasGlykol && entry.adjustments.every(a => a.category === 'pill-comp' || a.category === 'passthrough')) return false;
    if (hideGlykol && hasGlykol && !hasPid && entry.adjustments.every(a => a.category === 'glykol')) return false;
    return true;
  });

  return (
    <div className="space-y-2">
      {/* Filter toggles */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-1">
        {[
          { id: 'hide-system', label: 'Dölj system', checked: hideSystem, onChange: setHideSystem },
          { id: 'hide-glykol', label: 'Dölj glykol', checked: hideGlykol, onChange: setHideGlykol },
          { id: 'hide-pid', label: 'Dölj PID', checked: hidePid, onChange: setHidePid },
          { id: 'hide-sync', label: 'Dölj synk', checked: hideSync, onChange: setHideSync },
        ].map(t => (
          <div key={t.id} className="flex items-center gap-2">
            <Switch id={t.id} checked={t.checked} onCheckedChange={t.onChange} />
            <Label htmlFor={t.id} className="text-xs text-muted-foreground cursor-pointer">{t.label}</Label>
          </div>
        ))}
      </div>

      {filteredEntries.length === 0 && <p className="text-sm text-muted-foreground italic">Inga poster att visa.</p>}

      {filteredEntries.map((entry) => (
        <EntryRow key={entry.log.id} entry={entry} hideSync={hideSync} hidePid={hidePid} formatTime={formatTime} />
      ))}
    </div>
  );
}

// --- Entry Row ---

function EntryRow({ entry, hideSync, hidePid, formatTime }: {
  entry: UnifiedEntry; hideSync: boolean; hidePid: boolean; formatTime: (ts: string) => string;
}) {
  const { log, adjustments: adjs } = entry;
  const primaryAdj = adjs.length > 0 ? adjs[0] : null;
  const hasPidAdj = adjs.some(a => a.category === 'pill-comp');
  const hasGlykolAdj = adjs.some(a => a.category === 'glykol');

  // Header badge & summary
  let headerBadge: React.ReactNode;
  let headerSummary: React.ReactNode;

  if (adjs.length === 0) {
    headerBadge = (
      <Badge variant="default" className="text-[10px] px-1.5" style={{ background: 'hsl(var(--primary) / 0.2)', color: 'hsl(var(--primary))', borderColor: 'hsl(var(--primary) / 0.3)' }}>
        <Gauge className="h-2.5 w-2.5 mr-0.5" />System
      </Badge>
    );
    headerSummary = <span className="font-medium truncate max-w-[160px]">{log.final_result}</span>;
  } else if (hasPidAdj && hasGlykolAdj) {
    headerBadge = <div className="flex gap-1">{getCategoryBadge('pill-comp')}{getCategoryBadge('glykol')}</div>;
    const pidAdj = adjs.find(a => a.category === 'pill-comp')!;
    headerSummary = (
      <span className="font-medium whitespace-nowrap" style={{ color: pidAdj.new_target_temp < pidAdj.old_target_temp ? 'hsl(210 80% 60%)' : 'hsl(var(--ferment-green))' }}>
        {r1(pidAdj.old_target_temp)}° → {r1(pidAdj.new_target_temp)}°
      </span>
    );
  } else {
    headerBadge = getCategoryBadge(primaryAdj!.category);
    headerSummary = (
      <span className="font-medium whitespace-nowrap" style={{
        color: primaryAdj!.new_target_temp < primaryAdj!.old_target_temp ? 'hsl(210 80% 60%)' : primaryAdj!.new_target_temp > primaryAdj!.old_target_temp ? 'hsl(var(--ferment-green))' : undefined
      }}>
        {r1(primaryAdj!.old_target_temp)}° → {r1(primaryAdj!.new_target_temp)}°
      </span>
    );
  }

  return (
    <Collapsible>
      <CollapsibleTrigger className="grid grid-cols-[auto_105px_1fr_auto_20px] items-center w-full py-2 px-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors gap-x-2 text-xs">
        {headerBadge}
        <span className="text-muted-foreground whitespace-nowrap text-left">{formatTime(entry.timestamp)}</span>
        {headerSummary}
        <span className="text-[10px] text-muted-foreground">{log.duration_ms > 0 ? `${log.duration_ms}ms` : ''}</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform duration-200 justify-self-end" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 p-3 bg-background rounded-lg border border-border space-y-3">
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
            <PipelineView decisions={log.decisions} hideSync={hideSync} hidePid={hidePid} />
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

// --- Cooler Decision View ---

function CoolerDecisionView({ entries }: { entries: DecisionEntry[] }) {
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
  const maxEffective = r1(marginDet.max_effective as number);
  const samples = marginDet.margin_samples as number;

  // Determine outcome
  const isBlocked = !!rampBlock;
  const isDemandGuarded = !!demandGuard;
  const isRateLimited = !!rateLimit;
  const isOk = !!coolerOk;
  const isAdjusted = !!adjustment;

  // Format RAPT timestamp for tooltip
  const coolerLastUpdate = statusDet.last_update as string | null;
  const coolerRunTime = statusDet.cooling_run_time as number | null;
  const coolerUtilValue = statusDet.cooler_utilization as number | null;
  const coolerStarts = statusDet.cooling_starts as number | null;
  const coolerUtilTooltip = (() => {
    const parts: string[] = [];
    if (coolerUtilValue != null) parts.push(`Utnyttjandegrad: ${coolerUtilValue}% (rullande 30 min)`);
    parts.push(`cooling_run_time: ${coolerRunTime ?? '?'}s`);
    if (coolerStarts != null) parts.push(`cooling_starts: ${coolerStarts}`);
    if (coolerLastUpdate) parts.push(`RAPT: ${new Date(coolerLastUpdate).toLocaleTimeString('sv-SE')}`);
    if (coolerUtilValue === 0 && (coolerRunTime == null || coolerRunTime === 0)) parts.push('Kylkretsen har inte körts ännu');
    return parts.join('\n');
  })();

  return (
    <div className="space-y-1.5">
      {/* Row 1: Current state + effective target + util per tank */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Kylare:</span>
          <span className="font-mono font-medium">{coolerTarget}°</span>
          <span className="text-muted-foreground text-[10px]">(är {coolerTemp}°)</span>
          {statusDet.cooler_utilization != null ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={`font-mono text-[10px] font-medium cursor-help ${(statusDet.cooler_utilization as number) >= 80 ? 'text-amber-400' : (statusDet.cooler_utilization as number) >= 40 ? 'text-foreground' : 'text-muted-foreground'}`}>
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
              <TooltipContent side="top" className="text-xs whitespace-pre-line">Ingen utnyttjandedata ännu{coolerLastUpdate ? `\nRAPT: ${coolerLastUpdate}` : ''}</TooltipContent>
            </Tooltip>
          )}
        </div>
        {effectiveTarget && (() => {
          const effCtrlName = effectiveDet.controller as string;
          const matchingUtil = utilEntries.find(u => u.message.split(':')[0].trim() === effCtrlName);
          const mDet = matchingUtil?.details || {};
          const mUtilMatch = matchingUtil?.message.match(/util=(\d+)%/);
          const mUtilPct = mUtilMatch ? parseInt(mUtilMatch[1]) : null;
          const mRunTime = mDet.cooling_run_time as number | null;
          const mLastUpdate = mDet.last_update as string | null;
          const mTip = (() => {
            const p: string[] = [];
            if (mUtilPct != null) p.push(`Utnyttjandegrad: ${mUtilPct}% (rullande 30 min)`);
            if (mRunTime != null) p.push(`cooling_run_time: ${mRunTime}s`);
            if (mLastUpdate) p.push(`RAPT: ${new Date(mLastUpdate).toLocaleTimeString('sv-SE')}`);
            return p.length > 0 ? p.join('\n') : null;
          })();
          return (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Lägsta behov:</span>
              <span className="font-mono font-medium" style={{ color: 'hsl(210 80% 60%)' }}>
                {r1((effectiveTarget.details?.temp ?? effectiveTarget.details?.effective_target) as number)}°
              </span>
              {mTip ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-muted-foreground text-[10px] cursor-help">({effCtrlName}{mUtilPct != null ? ` ${mUtilPct}%` : ''})</span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs whitespace-pre-line">{mTip}</TooltipContent>
                </Tooltip>
              ) : (
                <span className="text-muted-foreground text-[10px]">({effCtrlName})</span>
              )}
            </div>
          );
        })()}
        {/* Inline tank utilization */}
        {utilEntries.map((u, i) => {
          const isActive = u.message.includes('❄️');
          const name = u.message.split(':')[0].trim();
          const utilMatch = u.message.match(/util=(\d+)%/);
          const utilPct = utilMatch ? parseInt(utilMatch[1]) : null;
          // Skip if this is the same controller already shown in "Lägsta behov"
          const effectiveCtrlName = effectiveDet.controller as string;
          if (effectiveCtrlName && name === effectiveCtrlName) return null;
          const uDet = u.details || {};
          const tankRunTime = uDet.cooling_run_time as number | null;
          const tankLastUpdate = uDet.last_update as string | null;
          const tankUtilTip = (() => {
            const p: string[] = [];
            if (utilPct != null) p.push(`Utnyttjandegrad: ${utilPct}% (rullande 30 min)`);
            if (tankRunTime != null) p.push(`cooling_run_time: ${tankRunTime}s`);
            if (tankLastUpdate) p.push(`RAPT: ${new Date(tankLastUpdate).toLocaleTimeString('sv-SE')}`);
            return p.length > 0 ? p.join('\n') : 'Ingen data';
          })();
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
      </div>

      {/* Row 2: Margin calculation */}
      {marginCalc && (
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span>Marginal: <span className="font-mono text-foreground">{learnedMargin}°</span></span>
          {maxEffective && <span>Max eff: <span className="font-mono">{maxEffective}°</span></span>}
          {samples != null && <span>({samples} samples)</span>}
          {marginDet.required_rate != null && (
            <span>Krav: <span className="font-mono">{r1(marginDet.required_rate as number)}°/h</span></span>
          )}
        </div>
      )}

      {/* Row 3: Proactive look-ahead */}
      {proactive && (
        <div className="flex items-center gap-2 text-[10px]">
          <Info className="h-2.5 w-2.5 text-blue-400" />
          <span style={{ color: 'hsl(210 80% 70%)' }}>{proactive.message}</span>
        </div>
      )}

      {/* Row 4: Decision / Result */}
      <div className="flex items-center gap-2 text-[11px] pt-0.5 border-t border-border/20">
        {isAdjusted ? (
          <>
            <Wrench className="h-3 w-3 text-amber-500" />
            <span className="font-medium">{adjustment.message}</span>
          </>
        ) : isDemandGuarded ? (
          <>
            <ShieldAlert className="h-3 w-3 text-sky-400" />
            <span className="text-sky-400">{demandGuard.message}</span>
          </>
        ) : isBlocked ? (
          <>
            <ShieldAlert className="h-3 w-3 text-amber-500" />
            <span className="text-amber-400">{rampBlock.message}</span>
          </>
        ) : isRateLimited ? (
          <>
            <Clock className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">{rateLimit.message}</span>
          </>
        ) : isOk ? (
          <>
            <CheckCircle2 className="h-3 w-3 text-green-500" />
            <span className="text-green-400">{coolerOk.message}</span>
          </>
        ) : (
          <>
            <Info className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Ingen åtgärd</span>
          </>
        )}
      </div>

      {/* Row 5: Learning feedback (subtle) */}
      {(marginLearn || rateLearn || utilLearn) && (
        <div className="text-[10px] text-muted-foreground space-y-0.5 pt-0.5">
          {rateLearn && <div className="flex items-center gap-1"><GraduationCap className="h-2.5 w-2.5" />{rateLearn.message}</div>}
          {utilLearn && <div className="flex items-center gap-1"><GraduationCap className="h-2.5 w-2.5" />{utilLearn.message}</div>}
          {marginLearn && <div className="flex items-center gap-1"><GraduationCap className="h-2.5 w-2.5" />{marginLearn.message}</div>}
        </div>
      )}
    </div>
  );
}

// --- Pipeline View ---

function PipelineView({ decisions, hideSync, hidePid }: {
  decisions: DecisionEntry[]; hideSync: boolean; hidePid: boolean;
}) {
  const syncEntries = decisions.filter(d => d.step === 'SYNC_DATA');
  const brewSgEntries = decisions.filter(d => d.step === 'BREW_SG_STATUS');
  const utilEntries = decisions.filter(d => d.step === 'COOLING_UTIL');
  // Build a map of pill/brew data per controller name for merging into SYNC_DATA
  const brewSgByName = new Map<string, DecisionEntry>();
  brewSgEntries.forEach(d => {
    const name = d.message.replace('Controller: ', '');
    brewSgByName.set(name, d);
  });
  // Build a map of utilization per controller name
  const utilByName = new Map<string, { pct: number | null; active: boolean }>();
  utilEntries.forEach(d => {
    const name = d.message.split(':')[0].trim();
    const utilMatch = d.message.match(/util=(\d+)%/);
    const pct = utilMatch ? parseInt(utilMatch[1]) : null;
    const active = d.message.includes('❄️');
    utilByName.set(name, { pct, active });
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
    d.step === 'RATE_LEARN' || d.step === 'MARGIN_LEARN' || d.step === 'UTIL_LEARN'
  );
  const raptSendEntries = decisions.filter(d => d.step === 'RAPT_SEND');
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
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-muted-foreground border-b border-border/30">
                <th className="text-left py-0.5 pr-2 font-medium">Controller</th>
                <th className="text-right py-0.5 px-1 font-medium">Pill</th>
                <th className="text-right py-0.5 px-1 font-medium">Ctrl</th>
                <th className="text-right py-0.5 px-1 font-medium">Mål</th>
                <th className="text-right py-0.5 px-1 font-medium">Profil</th>
                <th className="text-right py-0.5 px-1 font-medium">Kyla</th>
                <th className="text-center py-0.5 px-1 font-medium">Status</th>
                <th className="text-right py-0.5 pl-1 font-medium">RAPT</th>
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
                return (
                  <React.Fragment key={i}>
                    <tr className={`border-b ${pillData ? 'border-border/5' : 'border-border/10'}`}>
                      <td className="py-0.5 pr-2 font-medium truncate max-w-[100px]">{name}</td>
                      <td className="py-0.5 px-1 text-right" style={{ color: 'hsl(38 92% 50%)' }}>{r1(det.pill_temp as number)}</td>
                      <td className="py-0.5 px-1 text-right">{r1(det.ctrl_temp as number)}</td>
                      <td className="py-0.5 px-1 text-right">{r1(det.ctrl_target as number)}</td>
                      <td className="py-0.5 px-1 text-right font-medium" style={{ color: 'hsl(280 60% 60%)' }}>{r1(det.profile_target as number)}</td>
                      <td className="py-0.5 px-1 text-right">
                        {util ? (
                          <span className={`font-mono ${util.pct != null && util.pct >= 80 ? 'text-amber-400' : util.pct != null && util.pct >= 40 ? 'text-foreground' : 'text-muted-foreground'}`}>
                            {util.active ? '❄️' : '⏸️'}{util.pct != null ? ` ${util.pct}%` : (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="text-muted-foreground/50 cursor-help"> - %</span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">Ingen utnyttjandedata ännu (väntar på tillräckligt med mätpunkter)</TooltipContent>
                              </Tooltip>
                            )}
                          </span>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-muted-foreground/40 font-mono cursor-help">- %</span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">Ingen kyldata för denna controller</TooltipContent>
                          </Tooltip>
                        )}
                      </td>
                      <td className="py-0.5 pl-1 text-center">
                        {det.preserved ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-[9px] px-1 py-0.5 rounded bg-sky-500/15 text-sky-400 cursor-help">bevarad</span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs max-w-[200px]">Databasens måltemp bevaras (aktiv profil, PID eller kylare) istället för RAPT-hårdvarans värde</TooltipContent>
                          </Tooltip>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground cursor-help">hw</span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs max-w-[200px]">Måltemperaturen kommer direkt från RAPT-hårdvaran utan överskrivning</TooltipContent>
                          </Tooltip>
                        )}
                      </td>
                      <td className="py-0.5 pl-1 text-right text-muted-foreground font-mono">
                        {lastUpdate || '—'}
                      </td>
                    </tr>
                    {pillData && (
                      <tr className="border-b border-border/10">
                        <td colSpan={8} className="py-0.5 pl-6">
                          <div className="flex items-center gap-3 text-muted-foreground">
                            <span className="flex items-center gap-1" style={{ color: 'hsl(38 92% 50%)' }}>
                              <Pill className="h-2.5 w-2.5" />
                              <span className="text-[9px] font-medium">Pill</span>
                            </span>
                            {pillDet.current_sg != null && (
                              <span>SG: <span className="font-mono" style={{ color: 'hsl(160 60% 50%)' }}>{(pillDet.current_sg as number).toFixed(3)}</span></span>
                            )}
                            {pillDet.og != null && (
                              <span>OG: <span className="font-mono">{(pillDet.og as number).toFixed(3)}</span></span>
                            )}
                            {pillDet.fg != null && (
                              <span>FG: <span className="font-mono">{(pillDet.fg as number).toFixed(3)}</span></span>
                            )}
                            {pillDet.battery != null && (
                              <span>🔋 {parseFloat((pillDet.battery as number).toFixed(1))}%</span>
                            )}
                            {pillDet.status && (
                              <span className="text-[9px] px-1 py-0.5 rounded bg-muted">{pillDet.status as string}</span>
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
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-muted-foreground border-b border-border/30">
                {/* Info columns */}
                <th className="text-left py-0.5 pr-2 font-medium">Controller</th>
                <th className="text-right py-0.5 px-1 font-medium">Är</th>
                <th className="text-right py-0.5 px-1 font-medium">Δ</th>
                <th className="text-center py-0.5 px-0 font-medium text-muted-foreground/20">│</th>
                {/* Calculation columns: Profil − Komp + PI = Nytt mål */}
                <th className="text-right py-0.5 px-1 font-medium">Profil</th>
                <th className="text-right py-0.5 px-1 font-medium">− Komp</th>
                <th className="text-right py-0.5 px-1 font-medium">+ PI</th>
                <th className="text-center py-0.5 px-0 font-medium text-muted-foreground/30">=</th>
                <th className="text-right py-0.5 px-1 font-medium" style={{ color: 'hsl(var(--ferment-green))' }}>Nytt mål</th>
                <th className="text-center py-0.5 px-0 font-medium text-muted-foreground/20">│</th>
                {/* Result columns */}
                <th className="text-right py-0.5 px-1 font-medium">Ctrl mål</th>
                <th className="text-right py-0.5 px-1 font-medium">Diff</th>
              </tr>
            </thead>
            <tbody>
              {pidStatusEntries.map((d, i) => {
                const det = d.details || {};
                const name = d.message.replace('Controller: ', '');
                const comp = det.compensation as number;
                const delta = det.delta as number;
                const errCorr = det.error_correction as number;
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

                // Computed raw from formula (fallback if backend doesn't log it yet)
                const computedRaw = actualTargetVal != null && comp != null
                  ? actualTargetVal - comp + (errCorr ?? 0)
                  : null;
                const rawValue = rawCtrlTargetPid ?? computedRaw;

                const diff = ctrlTargetPid != null && ctrlTarget != null
                  ? ctrlTargetPid - ctrlTarget
                  : null;

                return (
                  <React.Fragment key={i}>
                  <tr className="border-b border-border/10">
                    {/* Info: Controller + Begränsningar */}
                    <td className="py-0.5 pr-2 font-medium truncate max-w-[120px]">
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
                        const rawVal = rawValue;
                        const clampedVal = ctrlTargetPid;
                        const clampDiff = rawVal != null && clampedVal != null ? rawVal - clampedVal : null;
                        const clampDiffStr = clampDiff != null && Math.abs(clampDiff) >= 0.05 ? `${clampDiff >= 0 ? '+' : ''}${r1(clampDiff)}° begränsat` : '';
                        if (statusLimits.length > 0) {
                          if (statusLimits.includes('overshoot-clamp')) brakes.push({ label: '🔒 Overshoot', tip: `Begränsar mål till probe-temp för att inte starta fel läge. ${clampDiffStr}` });
                          if (statusLimits.includes('overshoot-release')) brakes.push({ label: '🛑 Release', tip: 'Probe nära mål — overshoot-skydd aktivt' });
                          if (statusLimits.includes('ramp-hold')) brakes.push({ label: '🔒 Ramp', tip: `Håller target under ramp — låter profilen komma ikapp. ${clampDiffStr}` });
                          if (statusLimits.includes('approach-release')) brakes.push({ label: '🚀 Approach', tip: `Rate-limitad mot mål i approach zone. ${clampDiffStr}` });
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
                        } else if (action?.brakes && action.brakes.length > 0) {
                          action.brakes.forEach(b => brakes.push({ label: b, tip: '' }));
                        }
                        return brakes.length > 0 ? (
                          <div className="flex flex-wrap gap-0.5 mt-0.5">
                            {brakes.map((b, bi) => (
                              <TooltipProvider key={bi} delayDuration={200}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="text-[8px] px-1 py-0 rounded bg-sky-500/15 text-sky-400 whitespace-nowrap cursor-help">{b.label}</span>
                                  </TooltipTrigger>
                                  {b.tip && (
                                    <TooltipContent side="bottom" className="text-[10px] max-w-[220px]">
                                      {b.tip}
                                    </TooltipContent>
                                  )}
                                </Tooltip>
                              </TooltipProvider>
                            ))}
                          </div>
                        ) : damping != null && damping < 1.0 ? (
                          <div className="mt-0.5">
                            <TooltipProvider delayDuration={200}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="text-[8px] px-1 py-0 rounded bg-sky-500/15 text-sky-400 cursor-help">damp={r1(damping)}</span>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="text-[10px]">
                                  D-term dämpning: kompensation × {r1(damping)} (närmar sig mål)
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        ) : null;
                      })()}
                    </td>
                    {/* Info: Är-temp */}
                    <td className="py-0.5 px-1 text-right" style={{ color: dualSensors ? 'hsl(38 92% 50%)' : undefined }}>
                      {r1(actualTempVal)}°
                      {dualSensors && <span className="text-[8px] text-muted-foreground ml-0.5">⌀</span>}
                    </td>
                    {/* Info: Delta (raw sensor diff) */}
                    <td className="py-0.5 px-1 text-right text-muted-foreground/50" style={{
                      color: delta != null && Math.abs(delta) > 0.3 ? 'hsl(38 92% 50% / 0.6)' : undefined
                    }}>
                      {delta != null ? `${delta >= 0 ? '+' : ''}${r1(delta)}°` : '—'}
                    </td>
                    {/* Separator */}
                    <td className="py-0.5 px-0 text-center text-muted-foreground/15">│</td>
                    {/* Calc: Profil (actual_target) */}
                    <td className="py-0.5 px-1 text-right font-medium" style={{ color: 'hsl(280 60% 60%)' }}>
                      {actualTargetVal != null ? `${r1(actualTargetVal)}°` : '—'}
                    </td>
                    {/* Calc: − Komp (with tooltip) */}
                    <td className="py-0.5 px-1 text-right" style={{
                      color: comp != null && Math.abs(comp) > 0.05 ? 'hsl(210 80% 60%)' : undefined
                    }}>
                      {comp != null ? (
                        Math.abs(comp) > 0.01 ? (
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help border-b border-dotted border-current/30">−{r1(Math.abs(comp))}°</span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-[10px] max-w-[200px]">
                              <div className="space-y-0.5">
                                <div>Δ/2 = {rawComp != null ? r1(rawComp) : delta != null ? r1(delta / 2) : '?'}°</div>
                                {damping != null && damping < 1.0 && <div>× damp {r1(damping)}</div>}
                                <div className="border-t border-border/30 pt-0.5 font-medium">= {r1(comp)}° slutgiltig</div>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        ) : <span className="text-muted-foreground/40">—</span>
                      ) : '—'}
                    </td>
                    {/* Calc: + PI (with tooltip) */}
                    <td className="py-0.5 px-1 text-right" style={{
                      color: errCorr != null && Math.abs(errCorr) > 0.05 ? 'hsl(160 60% 50%)' : undefined
                    }}>
                      {errCorr != null ? (
                        Math.abs(errCorr) > 0.01 ? (
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help border-b border-dotted border-current/30">{errCorr >= 0 ? '+' : ''}{r1(errCorr)}°</span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-[10px] max-w-[200px]">
                              <div className="space-y-0.5">
                                <div>P = {pCorr != null ? `${pCorr >= 0 ? '+' : ''}${r1(pCorr)}°` : '?'}</div>
                                <div>I = {iCorr != null ? `${iCorr >= 0 ? '+' : ''}${r1(iCorr)}°` : '?'}</div>
                                {learnedBaseline != null && Math.abs(learnedBaseline) > 0.01 && (
                                  <div>Inlärd = {r1(learnedBaseline)}°</div>
                                )}
                                <div className="border-t border-border/30 pt-0.5 font-medium">= {errCorr >= 0 ? '+' : ''}{r1(errCorr)}° totalt</div>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        ) : <span className="text-muted-foreground/40">—</span>
                      ) : '—'}
                    </td>
                    {/* = */}
                    <td className="py-0.5 px-0 text-center text-muted-foreground/25">=</td>
                    {/* Nytt mål (PID result sent to hardware) */}
                    <td className="py-0.5 px-1 text-right font-bold" style={{ color: 'hsl(var(--ferment-green))' }}>
                      {ctrlTargetPid != null ? (
                        rawValue != null && Math.abs(rawValue - ctrlTargetPid) >= 0.05 ? (
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help border-b border-dotted border-current/30">{r1(ctrlTargetPid)}°</span>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="text-[10px]">
                                <div>Rått: {r1(rawValue)}° → {r1(ctrlTargetPid)}°</div>
                                {statusLimits.length > 0 && <div className="text-muted-foreground">{statusLimits.join(', ')}</div>}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : `${r1(ctrlTargetPid)}°`
                      ) : rawValue != null ? `${r1(rawValue)}°` : '—'}
                    </td>
                    {/* Separator */}
                    <td className="py-0.5 px-0 text-center text-muted-foreground/15">│</td>
                    {/* Ctrl mål (before) */}
                    <td className="py-0.5 px-1 text-right text-muted-foreground/50">
                      {ctrlTarget != null ? `${r1(ctrlTarget)}°` : '—'}
                    </td>
                    {/* Diff */}
                    <td className="py-0.5 px-1 text-right font-medium" style={{
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
        </PipelineSection>
      )}

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
          <CoolerDecisionView entries={coolerEntries} />
        </PipelineSection>
      )}

      {/* Section 6 removed — merged into section 3 "PID-reglering" above */}

      {/* 7. RAPT_SEND */}
      {raptSendEntries.length > 0 && (
        <PipelineSection icon={<Send className="h-3 w-3" />} title="Skickat till RAPT" color="hsl(25 95% 53%)" borderColor="hsl(25 95% 53% / 0.3)" bgColor="hsl(25 95% 53% / 0.05)">
          {raptSendEntries.map((d, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px] py-0.5">
              <Wrench className="h-3 w-3 flex-shrink-0" style={{ color: 'hsl(25 95% 53%)' }} />
              <span className="font-medium" style={{ color: 'hsl(25 80% 60%)' }}>{d.message}</span>
            </div>
          ))}
        </PipelineSection>
      )}

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
