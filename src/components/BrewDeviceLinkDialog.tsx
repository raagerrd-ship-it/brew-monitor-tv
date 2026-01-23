import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Thermometer, Pill, Link2, Unlink } from "lucide-react";

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
  controllers,
  pills,
  onUpdate,
}: BrewDeviceLinkDialogProps) {
  const [selectedControllerId, setSelectedControllerId] = useState<string>(currentControllerId || "none");
  const [saving, setSaving] = useState(false);

  // Update selected values when dialog opens or props change
  useEffect(() => {
    if (open) {
      setSelectedControllerId(currentControllerId || "none");
    }
  }, [open, currentControllerId]);

  // Get the linked pill for the selected controller
  const selectedController = controllers.find(c => c.controller_id === selectedControllerId);
  const linkedPill = selectedController?.linked_pill_id 
    ? pills.find(p => p.pill_id === selectedController.linked_pill_id) 
    : null;

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("brew_readings")
        .update({
          linked_controller_id: selectedControllerId === "none" ? null : selectedControllerId,
          // Clear the old linked_pill_id - pill is now derived from controller
          linked_pill_id: null,
        })
        .eq("batch_id", brewId);

      if (error) throw error;

      toast.success("Controller kopplad");
      onUpdate();
      onOpenChange(false);
    } catch (error) {
      console.error("Error saving device links:", error);
      toast.error("Kunde inte spara enhetskoppling");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Koppla controller till {brewName}</DialogTitle>
          <DialogDescription>
            Välj vilken Temperature Controller som används för detta brygg. Pill-kopplingen sker automatiskt baserat på controller-inställningen.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              <Thermometer className="h-4 w-4 text-primary" />
              Temperature Controller
            </label>
            <Select value={selectedControllerId} onValueChange={setSelectedControllerId}>
              <SelectTrigger>
                <SelectValue placeholder="Välj controller" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">
                  <div className="flex items-center gap-2">
                    <Unlink className="h-3 w-3 text-muted-foreground" />
                    <span>Ingen (automatisk matchning)</span>
                  </div>
                </SelectItem>
                {controllers.map((controller) => {
                  const controllerPill = pills.find(p => p.pill_id === controller.linked_pill_id);
                  return (
                    <SelectItem key={controller.id} value={controller.controller_id}>
                      <div className="flex items-center gap-2">
                        <span>{controller.name}</span>
                        {controllerPill && (
                          <Badge variant="secondary" className="text-xs py-0 h-5">
                            <Pill className="h-3 w-3 mr-1" style={{ color: controllerPill.color }} />
                            {controllerPill.name}
                          </Badge>
                        )}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Show linked pill info */}
          {selectedControllerId !== "none" && (
            <div className="rounded-lg border border-border/50 bg-muted/30 p-3">
              <p className="text-sm font-medium mb-2 flex items-center gap-2">
                <Pill className="h-4 w-4" />
                Kopplad Pill
              </p>
              {linkedPill ? (
                <div className="flex items-center gap-2">
                  <Pill className="h-5 w-5" style={{ color: linkedPill.color }} />
                  <span className="font-medium">{linkedPill.name}</span>
                  <Badge variant="secondary" className="text-xs">
                    <Link2 className="h-3 w-3 mr-1" />
                    Auto
                  </Badge>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Ingen pill kopplad till denna controller. Koppla en pill under Inställningar → Enheter.
                </p>
              )}
            </div>
          )}

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