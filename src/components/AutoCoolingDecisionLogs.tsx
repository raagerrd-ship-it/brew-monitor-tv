import React, { useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, CheckCircle2, XCircle, Info, Wrench, Snowflake, Pill, Gauge, Pencil, RefreshCw, Send, Database, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

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
  'COOLING_CAPABILITY', 'EFFECTIVE_TARGET', 'MARGIN_CALC', 'RATE_LIMIT',
  'RAMP_BLOCK', 'PROACTIVE', 'RATE_LEARN', 'MARGIN_LEARN',
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

          {/* Adjustment detail cards (glykol, manuell, passthrough only — PID is in pipeline) */}
          {adjs.filter(a => a.category !== 'pill-comp').map(adj => (
            <AdjustmentCard key={adj.id} adj={adj} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// --- Pipeline View ---

function PipelineView({ decisions, hideSync, hidePid }: {
  decisions: DecisionEntry[]; hideSync: boolean; hidePid: boolean;
}) {
  const syncEntries = decisions.filter(d => d.step === 'SYNC_DATA');
  const brewSgEntries = decisions.filter(d => d.step === 'BREW_SG_STATUS');
  // Build a map of pill/brew data per controller name for merging into SYNC_DATA
  const brewSgByName = new Map<string, DecisionEntry>();
  brewSgEntries.forEach(d => {
    const name = d.message.replace('Controller: ', '');
    brewSgByName.set(name, d);
  });
  const pidStatusEntries = decisions.filter(d => d.step === 'PILL_COMP_STATUS');
  const pidActionEntries = decisions.filter(d => d.step === 'PILL_COMP_ACTION');
  const stallEntries = decisions.filter(d => d.step.startsWith('STALL'));
  const coolerEntries = decisions.filter(d =>
    d.step === 'COOLING' || d.step.startsWith('COOLER_') ||
    d.step === 'COOLING_CAPABILITY' || d.step === 'EFFECTIVE_TARGET' ||
    d.step === 'MARGIN_CALC' || d.step === 'RATE_LIMIT' ||
    d.step === 'RAMP_BLOCK' || d.step === 'PROACTIVE' ||
    d.step === 'RATE_LEARN' || d.step === 'MARGIN_LEARN'
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
                <th className="text-center py-0.5 pl-1 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {syncEntries.map((d, i) => {
                const det = d.details || {};
                const name = d.message.replace('Controller: ', '');
                const pillData = brewSgByName.get(name);
                const pillDet = pillData?.details || {};
                return (
                  <React.Fragment key={i}>
                    <tr className={`border-b ${pillData ? 'border-border/5' : 'border-border/10'}`}>
                      <td className="py-0.5 pr-2 font-medium truncate max-w-[100px]">{name}</td>
                      <td className="py-0.5 px-1 text-right" style={{ color: 'hsl(38 92% 50%)' }}>{r1(det.pill_temp as number)}</td>
                      <td className="py-0.5 px-1 text-right">{r1(det.ctrl_temp as number)}</td>
                      <td className="py-0.5 px-1 text-right">{r1(det.ctrl_target as number)}</td>
                      <td className="py-0.5 px-1 text-right font-medium" style={{ color: 'hsl(280 60% 60%)' }}>{r1(det.profile_target as number)}</td>
                      <td className="py-0.5 pl-1 text-center">
                        {det.preserved ? (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-sky-500/15 text-sky-400">bevarad</span>
                        ) : (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground">hw</span>
                        )}
                      </td>
                    </tr>
                    {pillData && (
                      <tr className="border-b border-border/10">
                        <td colSpan={6} className="py-0.5 pl-6">
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
                              <span>🔋 {pillDet.battery as number}%</span>
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
                <th className="text-left py-0.5 pr-2 font-medium">Controller</th>
                <th className="text-right py-0.5 px-1 font-medium">Är-temp</th>
                <th className="text-right py-0.5 px-1 font-medium">Profil</th>
                <th className="text-right py-0.5 px-1 font-medium">Delta</th>
                <th className="text-right py-0.5 px-1 font-medium">Komp</th>
                <th className="text-right py-0.5 px-1 font-medium">→ Mål</th>
                <th className="text-right py-0.5 px-1 font-medium">Damp</th>
                <th className="text-left py-0.5 pl-1 font-medium">Begr.</th>
                <th className="text-left py-0.5 pl-1 font-medium">Läge</th>
              </tr>
            </thead>
            <tbody>
              {pidStatusEntries.map((d, i) => {
                const det = d.details || {};
                const name = d.message.replace('Controller: ', '');
                const comp = det.compensation as number;
                const delta = det.delta as number;
                const damping = det.damping as number;
                const mode = det.mode as string;
                const action = actionByName.get(name);
                const actualTempVal = det.actual_temp as number ?? det.avg_temp as number;
                const dualSensors = det.dual_sensors as boolean;
                const actualTargetVal = det.actual_target as number ?? det.base_target as number;
                return (
                  <tr key={i} className="border-b border-border/10 last:border-0">
                    <td className="py-0.5 pr-2 font-medium truncate max-w-[90px]">{name}</td>
                    <td className="py-0.5 px-1 text-right" style={{ color: dualSensors ? 'hsl(38 92% 50%)' : undefined }}>
                      {r1(actualTempVal)}°
                      {dualSensors && <span className="text-[8px] text-muted-foreground ml-0.5">⌀</span>}
                    </td>
                    <td className="py-0.5 px-1 text-right font-medium" style={{ color: 'hsl(280 60% 60%)' }}>{r1(det.base_target as number)}</td>
                    <td className="py-0.5 px-1 text-right" style={{
                      color: delta != null && Math.abs(delta) > 0.3 ? 'hsl(38 92% 50%)' : undefined
                    }}>
                      {delta != null ? `${delta >= 0 ? '+' : ''}${r1(delta)}°` : '—'}
                    </td>
                    <td className="py-0.5 px-1 text-right" style={{
                      color: comp != null && Math.abs(comp) > 0.05 ? (comp < 0 ? 'hsl(210 80% 60%)' : 'hsl(38 92% 50%)') : undefined
                    }}>
                      {comp != null ? `${comp >= 0 ? '+' : ''}${r1(comp)}°` : '—'}
                    </td>
                    <td className="py-0.5 px-1 text-right font-medium">
                      {action?.noChange ? (
                        <span className="text-muted-foreground">—</span>
                      ) : action?.newTarget != null ? (
                        <span style={{ color: 'hsl(var(--ferment-green))' }}>{r1(action.newTarget)}°</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-0.5 px-1 text-right" style={{
                      color: damping != null && damping < 1.0 ? 'hsl(210 80% 60%)' : undefined
                    }}>
                      {damping != null ? r1(damping) : '—'}
                    </td>
                    <td className="py-0.5 pl-1">
                      {action?.brakes && action.brakes.length > 0 ? (
                        <div className="flex flex-wrap gap-0.5">
                          {action.brakes.map((b, bi) => (
                            <span key={bi} className="text-[8px] px-1 py-0 rounded bg-sky-500/15 text-sky-400 whitespace-nowrap">{b}</span>
                          ))}
                        </div>
                      ) : action?.noChange ? (
                        <span className="text-[8px] px-1 py-0 rounded bg-muted text-muted-foreground">–</span>
                      ) : null}
                    </td>
                    <td className="py-0.5 pl-1">
                      {mode ? (
                        <span className={`text-[9px] px-1 py-0.5 rounded ${mode === 'cooling' ? 'bg-sky-500/15 text-sky-400' : 'bg-orange-500/15 text-orange-400'}`}>
                          {mode === 'cooling' ? '❄️' : '🔥'}
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
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
          d.step === 'STALL_COOLDOWN' || d.step === 'STALL_ERROR'
        );
        if (actionableStall.length === 0) return null;
        return (
          <PipelineSection icon={<AlertTriangle className="h-3 w-3" />} title="Stall-detektering" color="hsl(38 92% 55%)" borderColor="hsl(38 92% 55% / 0.3)" bgColor="hsl(38 92% 55% / 0.05)">
            {actionableStall.map((d, i) => {
              const isBoost = d.step === 'STALL_BOOST' || d.step === 'STALL_UNBOOST';
              const isError = d.step === 'STALL_ERROR';
              const isAnalysis = d.step === 'STALL_ANALYSIS';
              const stallDetected = isAnalysis && d.result === 'action';
              return (
                <div key={i} className="flex items-start gap-2 text-[11px] py-0.5">
                  <div className="mt-0.5 flex-shrink-0">
                    {isBoost ? <Wrench className="h-3 w-3 text-amber-500" /> :
                     isError ? <XCircle className="h-3 w-3 text-red-400" /> :
                     stallDetected ? <AlertTriangle className="h-3 w-3 text-amber-500" /> :
                     <CheckCircle2 className="h-3 w-3 text-green-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={`font-medium ${isError ? 'text-red-400' : ''}`}>{d.message}</span>
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

      {/* 5. Glykol-kylare */}
      {coolerEntries.length > 0 && (
        <PipelineSection icon={<Snowflake className="h-3 w-3" />} title="Glykol-kylare" color="hsl(210 80% 60%)" borderColor="hsl(210 80% 60% / 0.3)" bgColor="hsl(210 80% 60% / 0.05)">
          {coolerEntries.map((d, i) => {
            const isStatus = d.step === 'COOLER_STATUS' && d.details;
            const isOk = d.step === 'COOLER_OK';
            const isAction = d.result === 'action';

            if (isStatus && d.details) {
              return (
                <div key={i} className="flex items-center gap-3 text-[11px] py-0.5">
                  <CheckCircle2 className="h-3 w-3 flex-shrink-0 text-green-500" />
                  <span className="font-medium">{d.message.replace('Cooler: ', '')}</span>
                  <span className="text-muted-foreground">
                    Mål: {r1(d.details.target_temp as number)}° | Temp: {r1(d.details.current_temp as number)}°
                  </span>
                </div>
              );
            }

            return (
              <div key={i} className="flex items-start gap-2 text-[11px] py-0.5">
                <div className="mt-0.5 flex-shrink-0">
                  {isAction ? <Wrench className="h-3 w-3 text-amber-500" /> :
                   isOk || d.result === 'pass' ? <CheckCircle2 className="h-3 w-3 text-green-500" /> :
                   d.result === 'fail' ? <XCircle className="h-3 w-3 text-red-400" /> :
                   <Info className="h-3 w-3 text-muted-foreground" />}
                </div>
                <span className={d.result === 'fail' ? 'text-muted-foreground' : ''}>{d.message}</span>
              </div>
            );
          })}
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
