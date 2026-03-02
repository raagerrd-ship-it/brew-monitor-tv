import React, { useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, CheckCircle2, XCircle, Info, Wrench, Snowflake, Pill, Gauge, Pencil, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ParsedField { label: string; value: string; color?: string }

function parsePillCompMessage(msg: string): ParsedField[] | null {
  // Match: "Controller: PID X°C → Y°C (delta=D, komp=K°C, D-term: rate=R°/h, damp=D, PI=...)"
  // Use flexible regex that doesn't require matching closing paren
  // Match both regular PID changes and "ingen ändring" entries
  const pidMatch = msg.match(/^(.+?):\s*PID\s*([\d.]+)°C\s*→\s*([\d.]+)°C\s*[\(]/);
  if (pidMatch) {
    const [, name, from, to] = pidMatch;
    const deltaMatch = msg.match(/delta=([-\d.]+)/);
    const kompMatch = msg.match(/komp=([-\d.]+)°C/);
    const rateMatch = msg.match(/rate=([-\d.]+)°\/h/);
    const dampMatch = msg.match(/damp=([\d.]+)/);
    const delta = deltaMatch ? deltaMatch[1] : null;
    const komp = kompMatch ? kompMatch[1] : null;
    const rate = rateMatch ? rateMatch[1] : null;
    const damp = dampMatch ? dampMatch[1] : null;
    const noChange = msg.includes('ingen ändring');
    const fields: ParsedField[] = [
      { label: 'Styrenhet', value: name },
      { label: 'Status', value: noChange ? `PID ${from}° → ${to}° (ingen ändring)` : `PID ${from}° → ${to}°` },
    ];
    if (delta) fields.push({ label: 'Delta', value: `${delta}°`, color: parseFloat(delta) > 2 ? 'hsl(38 92% 50%)' : undefined });
    if (komp) fields.push({ label: 'Kompensation', value: `${komp}°` });
    if (rate) fields.push({ label: 'Pill-hastighet', value: `${rate}°C/h`, color: parseFloat(rate) < 0 ? 'hsl(var(--temp-blue))' : 'hsl(38 92% 50%)' });
    if (damp) fields.push({ label: 'Dämpning', value: parseFloat(damp) < 1.0 ? `${(parseFloat(damp) * 100).toFixed(0)}%` : '100%' });
    
    // Extract active constraints/brakes from limits=[...]
    const limitsMatch = msg.match(/limits=\[([^\]]+)\]/);
    if (limitsMatch) {
      const constraints = limitsMatch[1].split(',');
      const brakeLabels: string[] = [];
      if (constraints.includes('overshoot-clamp')) brakeLabels.push('🔒 Overshoot-clamp');
      if (constraints.includes('overshoot-release')) brakeLabels.push('🛑 Overshoot-release');
      if (constraints.includes('ramp-hold')) brakeLabels.push('🔒 Ramp Hold');
      if (constraints.includes('approach-release')) brakeLabels.push('🚀 Approach Release');
      if (constraints.includes('dir-clamp')) brakeLabels.push('🔒 Riktningsspärr');
      const rateLimitC = constraints.find(c => c.startsWith('rate-limit='));
      if (rateLimitC) brakeLabels.push(`⏱ Rate-limit ${rateLimitC.split('=')[1]}°/cykel`);
      const approachC = constraints.find(c => c.startsWith('approach='));
      if (approachC) brakeLabels.push(`🎯 Approach ${(parseFloat(approachC.split('=')[1]) * 100).toFixed(0)}%`);
      
      if (brakeLabels.length > 0) {
        fields.push({ label: 'Broms', value: brakeLabels.join(', '), color: 'hsl(200 70% 55%)' });
      }
    } else if (damp && parseFloat(damp) < 1.0) {
      fields.push({ label: 'Broms', value: `🎯 Approach Zone ${(parseFloat(damp) * 100).toFixed(0)}%`, color: 'hsl(200 70% 55%)' });
    }
    
    return fields;
  }

  // "Set Controller to X°C" success messages
  if (msg.startsWith('Set ')) {
    return [{ label: 'Status', value: msg, color: 'hsl(var(--ferment-green))' }];
  }

  // Skip header lines like "--- PID pill compensation check ---"
  if (msg.startsWith('---')) return null;

  // "Samma RAPT-data..." or similar skip/info messages
  const skipMatch = msg.match(/^(.+?):\s*(.+)/);
  if (skipMatch && msg.length > 30) {
    return [
      { label: 'Styrenhet', value: skipMatch[1] },
      { label: 'Status', value: skipMatch[2] },
    ];
  }

  // "Failed to update ..." 
  if (msg.startsWith('Failed to update')) {
    return [{ label: 'Fel', value: msg, color: 'hsl(0 80% 60%)' }];
  }

  return null;
}


const r1 = (v: number | null | undefined): string => {
  if (v === null || v === undefined) return '—';
  return parseFloat(Number(v).toFixed(1)).toString();
};
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

type HistoryEntry = 
  | { type: 'decision'; data: DecisionLog; timestamp: string }
  | { type: 'adjustment'; data: AdjustmentLog; category: AdjustmentCategory; timestamp: string };

function categorizeAdjustment(reason: string): AdjustmentCategory {
  if (reason.startsWith('✏️')) return 'manuell';
  if (reason.startsWith('🔄')) return 'passthrough';
  if (reason.startsWith('🎯')) return 'pill-comp';
  if (reason.startsWith('🔥')) return 'pill-comp'; // Stall boost
  // Legacy overshoot/stall entries still categorize to pill-comp
  if (reason.startsWith('🌡️')) return 'pill-comp';
  if (reason.startsWith('🧠')) return 'pill-comp';
  if (reason.includes('Cooling recovery') || reason.includes('colder than needed') || reason.includes('struggling to cool') || reason.includes('Ingen följd controller')) return 'glykol';
  return 'glykol';
}

function getCategoryBadge(category: AdjustmentCategory) {
  switch (category) {
    case 'pill-comp':
      return (
        <Badge variant="default" className="text-[10px] px-1.5" style={{ 
          background: 'hsl(280 60% 60% / 0.2)', 
          color: 'hsl(280 60% 60%)', 
          borderColor: 'hsl(280 60% 60% / 0.3)' 
        }}>
          <Pill className="h-2.5 w-2.5 mr-0.5" />
          PID
        </Badge>
      );
    case 'glykol':
      return (
        <Badge variant="default" className="text-[10px] px-1.5" style={{ 
          background: 'hsl(210 80% 60% / 0.2)', 
          color: 'hsl(210 80% 60%)', 
          borderColor: 'hsl(210 80% 60% / 0.3)' 
        }}>
          <Snowflake className="h-2.5 w-2.5 mr-0.5" />
          Glykol
        </Badge>
      );
    case 'manuell':
      return (
        <Badge variant="default" className="text-[10px] px-1.5" style={{ 
          background: 'hsl(38 92% 55% / 0.2)', 
          color: 'hsl(38 92% 55%)', 
          borderColor: 'hsl(38 92% 55% / 0.3)' 
        }}>
          <Pencil className="h-2.5 w-2.5 mr-0.5" />
          Manuell
        </Badge>
      );
    case 'passthrough':
      return (
        <Badge variant="default" className="text-[10px] px-1.5" style={{ 
          background: 'hsl(170 60% 45% / 0.2)', 
          color: 'hsl(170 60% 45%)', 
          borderColor: 'hsl(170 60% 45% / 0.3)' 
        }}>
          <RefreshCw className="h-2.5 w-2.5 mr-0.5" />
          Synk
        </Badge>
      );
    default:
      return (
        <Badge variant="default" className="text-[10px] px-1.5" style={{ 
          background: 'hsl(210 80% 60% / 0.2)', 
          color: 'hsl(210 80% 60%)', 
          borderColor: 'hsl(210 80% 60% / 0.3)' 
        }}>
          <Gauge className="h-2.5 w-2.5 mr-0.5" />
          System
        </Badge>
      );
  }
}

function extractAiReasoning(reason: string): string | null {
  // AI reasoning is in format "🌡️ Overshoot: <reasoning> (XX% säker)" or "🧠 AI: <reasoning>"
  const cleaned = reason.replace(/^🌡️\s*/, '').replace(/^🧠\s*/, '');
  return cleaned || null;
}

export function AutoCoolingDecisionLogs() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [hideSystem, setHideSystem] = useState(true);
  const [hideGlykol, setHideGlykol] = useState(false);
  const [hidePid, setHidePid] = useState(false);

  useEffect(() => {
    loadAll();

    const ch1 = supabase
      .channel('decision-logs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'auto_cooling_decision_logs' }, () => loadAll())
      .subscribe();

    const ch2 = supabase
      .channel('adjustment-logs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'auto_cooling_adjustments' }, () => loadAll())
      .subscribe();

    return () => {
      supabase.removeChannel(ch1);
      supabase.removeChannel(ch2);
    };
  }, []);

  const loadAll = async () => {
    try {
      const [decisionRes, adjustmentRes] = await Promise.all([
        supabase
          .from('auto_cooling_decision_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(30),
        supabase
          .from('auto_cooling_adjustments')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(30),
      ]);

      const decisionEntries: HistoryEntry[] = (decisionRes.data || []).map(log => ({
        type: 'decision' as const,
        data: { ...log, decisions: (log.decisions as unknown) as DecisionEntry[] },
        timestamp: log.created_at,
      }));

      const adjustmentEntries: HistoryEntry[] = (adjustmentRes.data || []).map(adj => ({
        type: 'adjustment' as const,
        data: adj as unknown as AdjustmentLog,
        category: categorizeAdjustment(adj.reason),
        timestamp: adj.created_at,
      }));

      // Merge and sort by timestamp, remove decision duplicates that overlap with adjustments (within 10s)
      const allEntries = [...adjustmentEntries];
      
      // Only add decision logs that don't have a matching adjustment within 10 seconds
      // Also filter out noisy "Not actively cooling" entries
      const filteredResults = new Set(['Not actively cooling', 'Not sustained cooling', 'Lowest not cooling']);
      for (const de of decisionEntries) {
        const log = de.data as DecisionLog;
        if (filteredResults.has(log.final_result)) continue;
        
        const deTime = new Date(de.timestamp).getTime();
        const hasMatchingAdjustment = adjustmentEntries.some(ae => 
          Math.abs(new Date(ae.timestamp).getTime() - deTime) < 10000
        );
        if (!hasMatchingAdjustment) {
          allEntries.push(de);
        }
      }

      allEntries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setEntries(allEntries.slice(0, 30));
    } catch (error) {
      console.error('Error loading logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const getResultIcon = (result: string) => {
    switch (result) {
      case 'pass': return <CheckCircle2 className="h-3 w-3 text-green-500" />;
      case 'fail': return <XCircle className="h-3 w-3 text-red-500" />;
      case 'action': return <Wrench className="h-3 w-3 text-amber-500" />;
      default: return <Info className="h-3 w-3 text-blue-500" />;
    }
  };

  const formatTime = (ts: string) => new Date(ts).toLocaleString('sv-SE', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  if (loading) return <p className="text-sm text-muted-foreground">Laddar...</p>;
  if (entries.length === 0) return <p className="text-sm text-muted-foreground italic">Inga justeringar har gjorts ännu.</p>;

  const filteredEntries = entries.filter(e => {
    if (hideSystem && e.type === 'decision') return false;
    if (hideGlykol && e.type === 'adjustment' && e.category === 'glykol') return false;
    if (hidePid && e.type === 'adjustment' && e.category === 'pill-comp') return false;
    return true;
  });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-1">
        <div className="flex items-center gap-2">
          <Switch id="hide-system" checked={hideSystem} onCheckedChange={setHideSystem} />
          <Label htmlFor="hide-system" className="text-xs text-muted-foreground cursor-pointer">Dölj system</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="hide-glykol" checked={hideGlykol} onCheckedChange={setHideGlykol} />
          <Label htmlFor="hide-glykol" className="text-xs text-muted-foreground cursor-pointer">Dölj glykol</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="hide-pid" checked={hidePid} onCheckedChange={setHidePid} />
          <Label htmlFor="hide-pid" className="text-xs text-muted-foreground cursor-pointer">Dölj PID</Label>
        </div>
      </div>
      {filteredEntries.length === 0 && (
        <p className="text-sm text-muted-foreground italic">Inga poster att visa.</p>
      )}
      {filteredEntries.map((entry) => {
        if (entry.type === 'adjustment') {
          const adj = entry.data;
          const category = entry.category;
          const aiReasoning = extractAiReasoning(adj.reason);
          const tempChange = adj.new_target_temp - adj.old_target_temp;
          const tempChangeStr = `${tempChange >= 0 ? '+' : ''}${tempChange.toFixed(1)}°`;

          return (
            <Collapsible key={`adj-${adj.id}`}>
              <CollapsibleTrigger className="grid grid-cols-[72px_105px_1fr_20px] md:grid-cols-[72px_105px_1fr_minmax(0,140px)_20px] items-center w-full py-2 px-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors gap-x-2 text-xs">
                  {getCategoryBadge(category)}
                  <span className="text-muted-foreground whitespace-nowrap text-left">{formatTime(adj.created_at)}</span>
                  <span className="font-medium whitespace-nowrap text-left" style={{ 
                    color: tempChange < 0 ? 'hsl(210 80% 60%)' : tempChange > 0 ? 'hsl(var(--ferment-green))' : undefined 
                  }}>
                    {r1(adj.old_target_temp)}° → {r1(adj.new_target_temp)}°
                  </span>
                  <span className="text-muted-foreground truncate hidden md:block text-right">
                    {category === 'glykol' ? adj.cooler_controller_name : (adj.followed_controller_name || adj.cooler_controller_name)}
                  </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform duration-200 justify-self-end" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-1 p-3 bg-background rounded-lg border border-border space-y-2">
                  <div className="flex gap-4 text-[10px] text-muted-foreground pb-2 border-b border-border flex-wrap">
                    <span>Styrenhet: {adj.followed_controller_name || adj.cooler_controller_name}</span>
                    <span>Mål: {r1(adj.old_target_temp)}° → {r1(adj.new_target_temp)}° (probe)</span>
                  </div>
                  
                  {category === 'pill-comp' && (() => {
                    const avgTemp = adj.followed_current_temp !== null && adj.followed_target_temp !== null
                      ? (adj.followed_current_temp + adj.followed_target_temp) / 2 : null;

                    return (
                    <div className="text-xs space-y-1.5">
                      <p className="font-semibold flex items-center gap-1" style={{ color: 'hsl(280 60% 60%)' }}>
                        🎯 Pill-kompensation
                      </p>

                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                        <div className="text-muted-foreground">Profilmål:</div>
                        <div className="font-medium">{adj.original_target_temp !== null ? `${adj.original_target_temp.toFixed(1)}°` : '—'}</div>
                        <div className="text-muted-foreground">Aktuell (medel):</div>
                        <div className="font-medium">
                          {avgTemp !== null ? `${avgTemp.toFixed(1)}°` : '—'}
                        </div>
                        <div className="text-muted-foreground">Pill (yta):</div>
                        <div className="font-medium" style={{ color: 'hsl(38 92% 50%)' }}>
                          {adj.followed_current_temp !== null ? `${adj.followed_current_temp.toFixed(1)}°` : '—'}
                        </div>
                        <div className="text-muted-foreground">Probe (styrenhet):</div>
                        <div className="font-medium">
                          {adj.followed_target_temp !== null ? `${adj.followed_target_temp.toFixed(1)}°` : '—'}
                        </div>
                        
                      </div>
                      {(() => {
                        const reason = adj.reason || '';
                        const rateMatch = reason.match(/rate=([-\d.]+)°\/h/);
                        const probeRateMatch = reason.match(/probeRate=([-\d.]+)°\/h/);
                        const etaMatch = reason.match(/ETA=(\d+)min/);
                        const dampMatch = reason.match(/damp=([\d.]+)/);
                        const piMatch = reason.match(/PI=\+([\d.]+)°C\(P=([\d.]+),I=([\d.]+)(?:,learned=([\d.]+)\[(\w+)\]n=(\d+))?\)/);
                        const pTermMatch = !piMatch ? reason.match(/P-term=\+([\d.]+)°C/) : null;
                        const limitsMatch = reason.match(/limits=\[([^\]]+)\]/);
                        const constraints = limitsMatch ? limitsMatch[1].split(',') : [];
                        const rate = rateMatch ? parseFloat(rateMatch[1]) : null;
                        const probeRate = probeRateMatch ? parseFloat(probeRateMatch[1]) : null;
                        const eta = etaMatch ? parseInt(etaMatch[1]) : null;
                        const damp = dampMatch ? parseFloat(dampMatch[1]) : null;
                        const piTotal = piMatch ? parseFloat(piMatch[1]) : (pTermMatch ? parseFloat(pTermMatch[1]) : null);
                        const pVal = piMatch ? parseFloat(piMatch[2]) : piTotal;
                        const iVal = piMatch ? parseFloat(piMatch[3]) : null;
                        const learnedVal = piMatch && piMatch[4] ? parseFloat(piMatch[4]) : null;
                        const learnedBucket = piMatch && piMatch[5] ? piMatch[5] : null;
                        const learnedN = piMatch && piMatch[6] ? parseInt(piMatch[6]) : null;
                        const avgTemp = adj.followed_current_temp !== null && adj.followed_target_temp !== null
                          ? (adj.followed_current_temp + adj.followed_target_temp) / 2 : null;
                        const profileTarget = adj.original_target_temp;
                        const avgDistance = avgTemp !== null && profileTarget !== null ? avgTemp - profileTarget : null;
                        
                        const bucketLabels: Record<string, string> = { 'high': 'Aktiv (>3°)', 'medium': 'Mellan (1.5-3°)', 'low': 'Lugn (<1.5°)' };

                        // Parse constraint details
                        const hasRampHold = constraints.includes('ramp-hold');
                        const hasDirClamp = constraints.includes('dir-clamp');
                        const hasApproachRelease = constraints.includes('approach-release');
                        const rateLimitC = constraints.find(c => c.startsWith('rate-limit='));
                        const rateLimitVal = rateLimitC ? parseFloat(rateLimitC.split('=')[1]) : null;
                        const approachC = constraints.find(c => c.startsWith('approach='));
                        const approachVal = approachC ? parseFloat(approachC.split('=')[1]) : null;
                        const isApproachZone = damp !== null && damp < 1.0;
                        const isLowering = adj.new_target_temp < adj.old_target_temp;
                        
                        return (
                          <div className="mt-1.5 pt-1.5 border-t border-border/50">
                            <p className="font-semibold text-[10px] mb-1" style={{ color: 'hsl(200 70% 55%)' }}>
                              🧮 PID-reglering
                            </p>

                            {/* Human-readable explanation */}
                            <p className="text-[11px] leading-relaxed mb-1.5">
                              {avgDistance !== null && profileTarget !== null ? (
                                avgDistance > 0.5 ? (
                                  hasRampHold ? (
                                    <>Temperaturen ligger <span className="text-amber-400 font-medium">{avgDistance.toFixed(1)}° över</span> profilmålet ({profileTarget.toFixed(1)}°), men PID:n <span className="text-sky-400 font-medium">håller målet</span> ({r1(adj.new_target_temp)}°) eftersom en ramp pågår — systemet låter rampen komma ikapp istället för att motverka den.</>
                                  ) : rateLimitVal !== null ? (
                                    <>Temperaturen ligger <span className="text-amber-400 font-medium">{avgDistance.toFixed(1)}° över</span> profilmålet ({profileTarget.toFixed(1)}°). Styrenhetens mål sänks till {r1(adj.new_target_temp)}° men <span className="text-sky-400 font-medium">begränsas</span> till max {rateLimitVal.toFixed(1)}°/cykel för att undvika oscillationer.</>
                                  ) : isApproachZone ? (
                                    <>Temperaturen ligger <span className="text-amber-400 font-medium">{avgDistance.toFixed(1)}° över</span> profilmålet ({profileTarget.toFixed(1)}°). Styrenhetens mål sänks till {r1(adj.new_target_temp)}° men kompensationen <span className="text-sky-400 font-medium">dämpas till {damp !== null ? `${(damp * 100).toFixed(0)}%` : ''}</span> — deltat förväntas minska naturligt när temperaturen närmar sig målet.</>
                                  ) : (
                                    <>Temperaturen ligger <span className="text-amber-400 font-medium">{avgDistance.toFixed(1)}° över</span> profilmålet ({profileTarget.toFixed(1)}°). Styrenhetens mål {isLowering ? 'sänks' : 'justeras'} till {r1(adj.new_target_temp)}° med full kompensation för att driva temperaturen nedåt.</>
                                  )
                                ) : avgDistance < -0.5 ? (
                                  hasRampHold ? (
                                    <>Temperaturen ligger <span className="text-blue-400 font-medium">{Math.abs(avgDistance).toFixed(1)}° under</span> profilmålet ({profileTarget.toFixed(1)}°), men PID:n <span className="text-sky-400 font-medium">håller målet</span> eftersom en ramp pågår.</>
                                  ) : (
                                    <>Temperaturen ligger <span className="text-blue-400 font-medium">{Math.abs(avgDistance).toFixed(1)}° under</span> profilmålet ({profileTarget.toFixed(1)}°). Styrenhetens mål höjs till {r1(adj.new_target_temp)}° för att värma upp.</>
                                  )
                                ) : (
                                  <>Temperaturen är <span className="font-medium" style={{ color: 'hsl(var(--ferment-green))' }}>nära profilmålet</span> ({profileTarget.toFixed(1)}°). Finjustering av styrenhetens mål till {r1(adj.new_target_temp)}°.</>
                                )
                              ) : (
                                <>Styrenhetens mål justeras från {r1(adj.old_target_temp)}° till {r1(adj.new_target_temp)}°.</>
                              )}
                            </p>

                            {/* Active constraint badges */}
                            {(hasRampHold || hasDirClamp || rateLimitVal !== null || hasApproachRelease || isApproachZone) && (
                              <div className="flex flex-wrap gap-1 mb-1.5">
                                {hasRampHold && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-400 border border-sky-500/20">🔒 Ramp Hold</span>
                                )}
                                {hasDirClamp && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">🔒 Riktningsspärr</span>
                                )}
                                {rateLimitVal !== null && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-400 border border-orange-500/20">⏱ Rate-limit {rateLimitVal.toFixed(1)}°/cykel</span>
                                )}
                                {hasApproachRelease && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/20">🚀 Approach Release</span>
                                )}
                                {isApproachZone && !hasRampHold && !hasApproachRelease && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-400 border border-sky-500/20">🎯 Approach Zone {damp !== null ? `${(damp * 100).toFixed(0)}%` : ''}</span>
                                )}
                              </div>
                            )}

                            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
                              <div className="text-muted-foreground">Medel → Mål:</div>
                              <div className="font-medium">
                                {avgTemp !== null && profileTarget !== null ? (
                                  <>
                                    <span>{avgTemp.toFixed(1)}° → {profileTarget.toFixed(1)}°</span>
                                    <span className="ml-1" style={{ 
                                      color: avgDistance! > 0.5 ? 'hsl(38 92% 50%)' : avgDistance! < -0.5 ? 'hsl(var(--temp-blue))' : 'hsl(var(--ferment-green))' 
                                    }}>
                                      ({avgDistance! >= 0 ? '+' : ''}{avgDistance!.toFixed(1)}°)
                                    </span>
                                  </>
                                ) : '—'}
                              </div>
                              <div className="text-muted-foreground">Delta (snitt):</div>
                              <div className="font-medium">
                                <span style={{ 
                                  color: adj.followed_hysteresis && adj.followed_hysteresis > 2 ? 'hsl(0 80% 60%)' : adj.followed_hysteresis && adj.followed_hysteresis > 1 ? 'hsl(38 92% 50%)' : undefined 
                                }}>
                                  {adj.followed_hysteresis !== null ? `+${adj.followed_hysteresis.toFixed(2)}°` : '—'}
                                </span>
                              </div>
                              <div className="text-muted-foreground">Kompensation:</div>
                              <div className="font-medium">
                                {(() => {
                                  const change = adj.new_target_temp - adj.old_target_temp;
                                  const sign = change >= 0 ? '+' : '';
                                  return `${sign}${change.toFixed(1)}°`;
                                })()}
                                {adj.original_target_temp != null && (() => {
                                  const diff = adj.new_target_temp - adj.original_target_temp;
                                  const absDiff = Math.abs(diff).toFixed(1);
                                  const direction = diff > 0.04 ? 'över' : diff < -0.04 ? 'under' : 'på';
                                  return (
                                    <span className="text-muted-foreground ml-1">
                                      (totalt {absDiff}° {direction} profil)
                                    </span>
                                  );
                                })()}
                              </div>
                              {piTotal !== null && piTotal > 0 && (
                                <>
                                  <div className="text-muted-foreground">PI-korrigering:</div>
                                  <div className="font-medium" style={{ color: 'hsl(var(--ferment-green))' }}>
                                    +{piTotal.toFixed(2)}°C
                                    {pVal !== null && iVal !== null && (
                                      <span className="text-muted-foreground ml-1">
                                        (P={pVal.toFixed(2)} I={iVal.toFixed(2)})
                                      </span>
                                    )}
                                  </div>
                                </>
                              )}
                              {learnedVal !== null && learnedVal > 0 && (
                                <>
                                  <div className="text-muted-foreground">Inlärd baseline:</div>
                                  <div className="font-medium" style={{ color: 'hsl(280 60% 60%)' }}>
                                    {learnedVal.toFixed(2)}°C
                                    <span className="text-muted-foreground ml-1">
                                      ({bucketLabels[learnedBucket || ''] || learnedBucket}, {learnedN} ggr)
                                    </span>
                                  </div>
                                </>
                              )}
                              {rate !== null && (
                                <>
                                  <div className="text-muted-foreground">Pill-hastighet:</div>
                                  <div className="font-medium" style={{ color: rate < 0 ? 'hsl(var(--temp-blue))' : rate > 0 ? 'hsl(38 92% 50%)' : undefined }}>
                                    {rate >= 0 ? '+' : ''}{rate.toFixed(2)}°C/h
                                  </div>
                                </>
                              )}
                              {probeRate !== null && (
                                <>
                                  <div className="text-muted-foreground">Probe-hastighet:</div>
                                  <div className="font-medium" style={{ color: probeRate < 0 ? 'hsl(var(--temp-blue))' : probeRate > 0 ? 'hsl(38 92% 50%)' : undefined }}>
                                    {probeRate >= 0 ? '+' : ''}{probeRate.toFixed(2)}°C/h
                                  </div>
                                </>
                              )}
                              <div className="text-muted-foreground">Controller mål:</div>
                              <div className="font-medium">
                                {adj.new_target_temp.toFixed(1)}°
                                {adj.followed_target_temp != null && (
                                  <span className="text-muted-foreground ml-1">
                                    (probe {adj.followed_target_temp.toFixed(1)}°)
                                  </span>
                                )}
                              </div>
                              {eta !== null && (
                                <>
                                  <div className="text-muted-foreground">ETA till mål:</div>
                                  <div className="font-medium">{eta} min</div>
                                </>
                              )}
                              {damp !== null && (
                                <>
                                  <div className="text-muted-foreground">Dämpning:</div>
                                  <div className="font-medium" style={{ color: damp < 1.0 ? 'hsl(200 70% 55%)' : 'hsl(var(--muted-foreground))' }}>
                                    {damp < 1.0 ? `${(damp * 100).toFixed(0)}% (aktiv)` : '100% (full komp)'}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                      <p className="text-[10px] text-muted-foreground mt-1 italic">
                        Justerar styrenhetens mål (probe) så att medelvärdet av pill (yta) och probe (kärna) hamnar på profilmålet
                      </p>
                    </div>
                    );
                  })()}


                  {category === 'glykol' && (() => {
                    const isRaising = adj.new_target_temp > adj.old_target_temp;
                    const margin = adj.followed_target_temp != null
                      ? Math.abs(adj.followed_target_temp - adj.new_target_temp)
                      : null;
                    return (
                    <div className="text-xs space-y-1.5">
                      <p className="font-semibold flex items-center gap-1" style={{ color: 'hsl(210 80% 60%)' }}>
                        ❄️ Glykolkylare
                      </p>

                      {/* Human-readable explanation */}
                      <p className="text-[11px] leading-relaxed">
                        {isRaising ? (
                          <>Tankens mål har <span className="text-amber-400 font-medium">ökat</span> — kylaren behöver inte kyla lika hårt och kan höjas från {r1(adj.old_target_temp)}° till {r1(adj.new_target_temp)}° för att spara energi.</>
                        ) : (
                          <>Tankens mål har <span className="text-blue-400 font-medium">sänkts</span> — kylaren sänks från {r1(adj.old_target_temp)}° till {r1(adj.new_target_temp)}° för att möta det nya behovet.</>
                        )}
                      </p>

                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] pt-1 border-t border-border/50">
                        <div className="text-muted-foreground">Styrande tank:</div>
                        <div className="font-medium">{adj.followed_controller_name || '—'}</div>
                        {adj.followed_target_temp !== null && (
                          <>
                            <div className="text-muted-foreground">Tank mål:</div>
                            <div className="font-medium">{adj.followed_target_temp.toFixed(1)}°</div>
                          </>
                        )}
                        {adj.followed_current_temp !== null && (
                          <>
                            <div className="text-muted-foreground">Tank aktuell:</div>
                            <div className="font-medium">{adj.followed_current_temp.toFixed(1)}°</div>
                          </>
                        )}
                        <div className="text-muted-foreground">Kylare:</div>
                        <div className="font-medium">{r1(adj.old_target_temp)}° → {r1(adj.new_target_temp)}°</div>
                        {margin !== null && (
                          <>
                            <div className="text-muted-foreground">Inlärd marginal:</div>
                            <div className="font-medium">{margin.toFixed(1)}°C</div>
                          </>
                        )}
                      </div>
                    </div>
                    );
                  })()}

                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        }

        // Decision log entry (fallback for entries without matching adjustment)
        const log = entry.data as DecisionLog;
        
        
        return (
          <Collapsible key={`dec-${log.id}`}>
            <CollapsibleTrigger className="flex items-center justify-between w-full py-2 px-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2 text-xs">
                <Badge variant="default" className="text-[10px] px-1.5" style={{ 
                  background: 'hsl(var(--primary) / 0.2)', 
                  color: 'hsl(var(--primary))', 
                  borderColor: 'hsl(var(--primary) / 0.3)' 
                }}>
                  System
                </Badge>
                <span className="text-muted-foreground">{formatTime(log.created_at)}</span>
                <span className="font-medium truncate max-w-[120px]">{log.final_result}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">{log.duration_ms}ms</span>
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200" />
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-1 p-3 bg-background rounded-lg border border-border space-y-2">
                <div className="flex gap-4 text-[10px] text-muted-foreground pb-2 border-b border-border">
                  <span>Steg: {log.decision_count}</span>
                  <span>Tid: {log.duration_ms}ms</span>
                  <span>Resultat: {log.final_result}</span>
                </div>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {log.decisions.map((decision, index) => {
                    const isPillComp = decision.step.startsWith('PILL_COMP');
                    const parsed = isPillComp ? parsePillCompMessage(decision.message) : null;
                    
                    return (
                      <div key={index} className="flex items-start gap-2 text-[11px]">
                        <div className="mt-0.5 flex-shrink-0">{getResultIcon(decision.result)}</div>
                        <div className="flex-1 min-w-0">
                          <span className="font-mono text-muted-foreground text-[10px]">{decision.step}</span>
                          {parsed ? (
                            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10px] mt-0.5 pl-1">
                              {parsed.map(({ label, value, color }, i) => (
                                <React.Fragment key={i}>
                                  <span className="text-muted-foreground">{label}:</span>
                                  <span className="font-medium" style={color ? { color } : undefined}>{value}</span>
                                </React.Fragment>
                              ))}
                            </div>
                          ) : (
                            <span className="text-foreground ml-2 break-words">{decision.message}</span>
                          )}
                          {decision.details && Object.keys(decision.details).length > 0 && (
                            <div className="mt-0.5 text-[10px] text-muted-foreground font-mono pl-2 border-l border-border ml-1">
                              {Object.entries(decision.details).map(([key, value]) => (
                                <div key={key}>{key}: {typeof value === 'object' ? JSON.stringify(value) : String(value)}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}
