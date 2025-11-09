import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface PillData {
  id: string;
  pill_id: string;
  name: string;
  color: string;
  battery_level: number;
  last_update: string | null;
}

interface TempController {
  id: string;
  controller_id: string;
  name: string;
  current_temp: number | null;
  target_temp: number | null;
  pill_temp: number | null;
  linked_pill_id: string | null;
  cooling_enabled: boolean | null;
  heating_enabled: boolean | null;
  last_update: string | null;
}

interface BrewDeviceLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brewId: string;
  brewName: string;
  currentControllerId: string | null;
  currentPillId: string | null;
  controllers: TempController[];
  pills: PillData[];
  onUpdate: () => void;
}

export function BrewDeviceLinkDialog({
  open,
  onOpenChange,
  brewId,
  brewName,
  currentControllerId,
  currentPillId,
  controllers,
  pills,
  onUpdate,
}: BrewDeviceLinkDialogProps) {
  const [selectedControllerId, setSelectedControllerId] = useState<string>(currentControllerId || "none");
  const [selectedPillId, setSelectedPillId] = useState<string>(currentPillId || "none");
  const [saving, setSaving] = useState(false);

  // Update selected values when dialog opens or props change
  useEffect(() => {
    if (open) {
      setSelectedControllerId(currentControllerId || "none");
      setSelectedPillId(currentPillId || "none");
    }
  }, [open, currentControllerId, currentPillId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("brew_readings")
        .update({
          linked_controller_id: selectedControllerId === "none" ? null : selectedControllerId,
          linked_pill_id: selectedPillId === "none" ? null : selectedPillId,
        })
        .eq("batch_id", brewId);

      if (error) throw error;

      toast.success("Enhetskopplingar sparade");
      onUpdate();
      onOpenChange(false);
    } catch (error) {
      console.error("Error saving device links:", error);
      toast.error("Kunde inte spara enhetskopplingar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Koppla enheter till {brewName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Temperature Controller</label>
            <Select value={selectedControllerId} onValueChange={setSelectedControllerId}>
              <SelectTrigger>
                <SelectValue placeholder="Välj controller" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Ingen (automatisk matchning)</SelectItem>
                {controllers.map((controller) => {
                  const linkedPill = pills.find(p => p.pill_id === controller.linked_pill_id);
                  return (
                    <SelectItem key={controller.id} value={controller.controller_id}>
                      <div className="flex items-center gap-2">
                        <span>{controller.name}</span>
                        {linkedPill && (
                          <span className="text-xs text-muted-foreground">
                            (Pill: {linkedPill.name})
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">RAPT Pill</label>
            <Select value={selectedPillId} onValueChange={setSelectedPillId}>
              <SelectTrigger>
                <SelectValue placeholder="Välj pill" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Ingen (automatisk matchning)</SelectItem>
                {pills.map((pill) => (
                  <SelectItem key={pill.id} value={pill.pill_id}>
                    {pill.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Avbryt
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sparar...
                </>
              ) : (
                "Spara"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
