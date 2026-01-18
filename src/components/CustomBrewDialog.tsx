import { useState, useEffect } from "react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import type { PillData, TempController } from "@/types/brew";

export interface CustomBrewData {
  id: string;
  batch_id: string;
  name: string;
  style: string;
  batch_number: string;
  original_gravity: number;
  final_gravity: number;
  linked_controller_id: string | null;
  linked_pill_id: string | null;
  status: string;
  fermentation_start: string | null;
}

interface CustomBrewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pills: PillData[];
  controllers: TempController[];
  onBrewSaved: () => void;
  editBrew?: CustomBrewData | null;
}

export function CustomBrewDialog({
  open,
  onOpenChange,
  pills,
  controllers,
  onBrewSaved,
  editBrew,
}: CustomBrewDialogProps) {
  const [name, setName] = useState("");
  const [style, setStyle] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [originalGravity, setOriginalGravity] = useState("");
  const [finalGravity, setFinalGravity] = useState("");
  const [selectedControllerId, setSelectedControllerId] = useState<string>("");
  const [selectedPillId, setSelectedPillId] = useState<string>("");
  const [status, setStatus] = useState("Jäsning");
  const [fermentationStart, setFermentationStart] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  // Use Swedish status values to match Brewfather sync
  const statusOptions = [
    { value: "Planering", label: "Planering" },
    { value: "Bryggning", label: "Bryggning" },
    { value: "Jäsning", label: "Jäsning" },
    { value: "Konditionering", label: "Konditionering" },
    { value: "Klar", label: "Klar" },
    { value: "Arkiverad", label: "Arkiverad" },
  ];

  const isEditMode = !!editBrew;

  // Reset/populate form when dialog opens
  useEffect(() => {
    if (open) {
      if (editBrew) {
        setName(editBrew.name);
        setStyle(editBrew.style || "");
        setBatchNumber(editBrew.batch_number || "");
        setOriginalGravity(editBrew.original_gravity?.toString() || "1.050");
        setFinalGravity(editBrew.final_gravity?.toString() || "1.010");
        setSelectedControllerId(editBrew.linked_controller_id || "");
        setSelectedPillId(editBrew.linked_pill_id || "");
        setStatus(editBrew.status || "Jäsning");
        // Format datetime for input (YYYY-MM-DDTHH:mm)
        if (editBrew.fermentation_start) {
          const date = new Date(editBrew.fermentation_start);
          const localDateTime = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16);
          setFermentationStart(localDateTime);
        } else {
          setFermentationStart("");
        }
      } else {
        setName("");
        setStyle("");
        setBatchNumber("");
        setOriginalGravity("1.050");
        setFinalGravity("1.010");
        setSelectedControllerId("");
        setSelectedPillId("");
        setStatus("Jäsning");
        // Default to now for new brews
        const now = new Date();
        const localDateTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16);
        setFermentationStart(localDateTime);
      }
    }
  }, [open, editBrew]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast({
        title: "Fel",
        description: "Namn krävs",
        variant: "destructive",
      });
      return;
    }

    const og = parseFloat(originalGravity);
    const fg = parseFloat(finalGravity);

    if (isNaN(og) || og < 1.0 || og > 1.2) {
      toast({
        title: "Fel",
        description: "OG måste vara mellan 1.000 och 1.200",
        variant: "destructive",
      });
      return;
    }

    if (isNaN(fg) || fg < 1.0 || fg > 1.2) {
      toast({
        title: "Fel",
        description: "FG måste vara mellan 1.000 och 1.200",
        variant: "destructive",
      });
      return;
    }

    try {
      setSaving(true);

      // Calculate ABV: (OG - FG) * 131.25
      const abv = Math.round((og - fg) * 131.25 * 10) / 10;

      // Calculate attenuation: ((OG - FG) / (OG - 1)) * 100
      const attenuation = Math.round(((og - fg) / (og - 1)) * 100);

      // Parse fermentation start date
      const fermStart = fermentationStart ? new Date(fermentationStart).toISOString() : null;

      if (isEditMode && editBrew) {
        // Update existing brew
        const { error: updateError } = await supabase
          .from("brew_readings")
          .update({
            name: name.trim(),
            style: style.trim() || "Custom",
            batch_number: batchNumber.trim() || "1",
            original_gravity: og,
            final_gravity: fg,
            attenuation: attenuation,
            abv: abv,
            linked_controller_id: selectedControllerId || null,
            linked_pill_id: selectedPillId || null,
            status: status,
            fermentation_start: fermStart,
          })
          .eq("id", editBrew.id);

        if (updateError) throw updateError;

        toast({
          title: "Öl uppdaterad!",
          description: `${name} har sparats`,
        });
      } else {
        // Generate a unique batch_id for custom brews
        const customBatchId = `custom_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        // Insert into brew_readings
        const { error: insertError } = await supabase
          .from("brew_readings")
          .insert({
            batch_id: customBatchId,
            name: name.trim(),
            style: style.trim() || "Custom",
            batch_number: batchNumber.trim() || "1",
            status: "Jäsning",
            original_gravity: og,
            final_gravity: fg,
            current_sg: og, // Start at OG
            current_temp: 20, // Default temp
            attenuation: attenuation,
            abv: abv,
            sg_data: [],
            linked_controller_id: selectedControllerId || null,
            linked_pill_id: selectedPillId || null,
            fermentation_start: fermStart,
          });

        if (insertError) throw insertError;

        // Add to selected_brews to show on dashboard
        const { error: selectError } = await supabase
          .from("selected_brews")
          .insert({
            batch_id: customBatchId,
            display_order: 0, // Will be at top
            is_visible: true,
          });

        if (selectError) {
          console.error("Error adding to selected_brews:", selectError);
          // Don't throw, the brew was created
        }

        toast({
          title: "Öl skapad!",
          description: `${name} har lagts till`,
        });
      }

      onBrewSaved();
      onOpenChange(false);
    } catch (error) {
      console.error("Error saving custom brew:", error);
      toast({
        title: "Fel",
        description: isEditMode ? "Kunde inte uppdatera ölen" : "Kunde inte skapa ölen",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{isEditMode ? "Redigera öl" : "Skapa egen öl"}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? "Ändra uppgifter för din bryggning"
              : "Lägg till en bryggning utan Brewfather"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Namn *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Min IPA"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="style">Stil</Label>
            <Input
              id="style"
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              placeholder="Ex: American IPA"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="batchNumber">Batch-nummer</Label>
            <Input
              id="batchNumber"
              value={batchNumber}
              onChange={(e) => setBatchNumber(e.target.value)}
              placeholder="Ex: 42"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="og">Original Gravity (OG)</Label>
              <Input
                id="og"
                type="number"
                step="0.001"
                min="1.000"
                max="1.200"
                value={originalGravity}
                onChange={(e) => setOriginalGravity(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="fg">Final Gravity (FG)</Label>
              <Input
                id="fg"
                type="number"
                step="0.001"
                min="1.000"
                max="1.200"
                value={finalGravity}
                onChange={(e) => setFinalGravity(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="fermentationStart">Jäsningsstart</Label>
            <Input
              id="fermentationStart"
              type="datetime-local"
              value={fermentationStart}
              onChange={(e) => setFermentationStart(e.target.value)}
            />
          </div>

          {isEditMode && (
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Välj status" />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-2">
            <Label>RAPT Controller</Label>
            <Select
              value={selectedControllerId || "none"}
              onValueChange={(val) => setSelectedControllerId(val === "none" ? "" : val)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Välj controller (valfritt)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Ingen</SelectItem>
                {controllers.map((controller) => (
                  <SelectItem
                    key={controller.id}
                    value={controller.controller_id}
                  >
                    {controller.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>RAPT Pill</Label>
            <Select 
              value={selectedPillId || "none"} 
              onValueChange={(val) => setSelectedPillId(val === "none" ? "" : val)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Välj pill (valfritt)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Ingen</SelectItem>
                {pills.map((pill) => (
                  <SelectItem key={pill.id} value={pill.pill_id}>
                    {pill.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {isEditMode ? "Sparar..." : "Skapar..."}
              </>
            ) : isEditMode ? (
              "Spara ändringar"
            ) : (
              "Skapa öl"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
