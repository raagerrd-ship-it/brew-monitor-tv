import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Pill } from "lucide-react";
import { useToast } from "@/hooks";

interface PillRow {
  id: string;
  pill_id: string;
  name: string;
  color: string;
  paired_device_id: string | null;
  temperature: number | null;
  gravity: number | null;
  battery_level: number | null;
  last_update: string | null;
}

const normalizeMac = (raw: string) =>
  raw.replace(/[^0-9a-fA-F]/g, "").toLowerCase();

export function RaptPillPairing() {
  const [pills, setPills] = useState<PillRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const load = async () => {
    const { data, error } = await supabase
      .from("rapt_pills")
      .select(
        "id,pill_id,name,color,paired_device_id,temperature,gravity,battery_level,last_update"
      )
      .order("name");
    if (error) {
      console.error(error);
      toast({ title: "Fel", description: "Kunde inte ladda Pills", variant: "destructive" });
    } else {
      setPills(data || []);
      const next: Record<string, string> = {};
      (data || []).forEach((p) => {
        next[p.pill_id] = p.paired_device_id ?? "";
      });
      setDrafts(next);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("rapt_pills_pairing")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rapt_pills" },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const save = async (pillId: string) => {
    const normalized = normalizeMac(drafts[pillId] ?? "");
    if (normalized && normalized.length !== 12) {
      toast({
        title: "Ogiltig MAC",
        description: "MAC måste innehålla 12 hex-tecken (kolon valfritt).",
        variant: "destructive",
      });
      return;
    }
    setSavingId(pillId);
    const { error } = await supabase
      .from("rapt_pills")
      .update({ paired_device_id: normalized || null })
      .eq("pill_id", pillId);
    setSavingId(null);
    if (error) {
      toast({ title: "Fel", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Sparat", description: "Pairing uppdaterad" });
    }
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">Laddar Pills...</div>;
  }

  if (pills.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        Inga Pills i databasen ännu.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground bg-muted/30 p-3 rounded-lg">
        💡 Klistra in BLE-MAC från Pi-scannern (med eller utan kolon). Värdet
        normaliseras innan det sparas. När MAC matchar en sniffad Pill börjar
        live-data flyta in varje minut.
      </div>
      {pills.map((pill) => {
        const draft = drafts[pill.pill_id] ?? "";
        const normalizedDraft = normalizeMac(draft);
        const dirty = normalizedDraft !== (pill.paired_device_id ?? "");
        return (
          <Card key={pill.id} className="p-4">
            <div className="flex items-start gap-3">
              <Pill color={pill.color} size={24} strokeWidth={2.5} className="mt-1 flex-shrink-0" />
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-medium truncate">{pill.name}</p>
                  <p className="text-xs text-muted-foreground whitespace-nowrap">
                    {pill.temperature != null ? `${pill.temperature.toFixed(1)}°C` : "—"}
                    {pill.gravity != null ? ` · SG ${(pill.gravity / 1000).toFixed(3)}` : ""}
                    {pill.battery_level != null ? ` · ${pill.battery_level}%` : ""}
                  </p>
                </div>
                <div>
                  <Label htmlFor={`mac-${pill.pill_id}`} className="text-xs text-muted-foreground">
                    BLE MAC (paired_device_id)
                  </Label>
                  <div className="flex gap-2 mt-1">
                    <Input
                      id={`mac-${pill.pill_id}`}
                      value={draft}
                      placeholder="t.ex. fc:e8:c0:b2:1d:b6"
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [pill.pill_id]: e.target.value }))
                      }
                      className="font-mono text-sm"
                    />
                    <Button
                      onClick={() => save(pill.pill_id)}
                      disabled={!dirty || savingId === pill.pill_id}
                      size="sm"
                    >
                      {savingId === pill.pill_id ? "Sparar..." : "Spara"}
                    </Button>
                  </div>
                  {dirty && normalizedDraft && (
                    <p className="text-xs text-muted-foreground mt-1 font-mono">
                      → sparas som <span className="text-foreground">{normalizedDraft}</span>
                    </p>
                  )}
                </div>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}