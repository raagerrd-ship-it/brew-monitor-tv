import { useState, useEffect, useMemo, useRef, useCallback } from "react";
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
import { useToast } from "@/hooks";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, X, ImageIcon } from "lucide-react";
import { Textarea } from "./ui/textarea";
import { format } from "date-fns";
import { sv } from "date-fns/locale";


export interface CustomBrewData {
  id: string;
  batch_id: string;
  name: string;
  style: string;
  batch_number: string;
  original_gravity: number;
  final_gravity: number;
  status: string;
  fermentation_start: string | null;
  label_image_url: string | null;
  description: string | null;
  linked_pill_id: string | null;
  linked_controller_id: string | null;
}

interface PillOption {
  pill_id: string;
  name: string;
  color: string;
  paired_device_id?: string | null;
}

interface ControllerOption {
  controller_id: string;
  name: string;
  linked_pill_id: string | null;
}

interface SgDataPoint {
  date: string;
  sg?: number;
  value?: number; // Alternative field name for SG
  temp?: number;
  pillTemp?: number;
  controllerTemp?: number;
  targetTemp?: number;
}

export interface CustomBrewPrefill {
  name?: string;
  style?: string;
  description?: string;
  label_image_url?: string;
}

interface CustomBrewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBrewSaved: () => void;
  editBrew?: CustomBrewData | null;
  prefill?: CustomBrewPrefill | null;
  pills?: PillOption[];
  controllers?: ControllerOption[];
}

export function CustomBrewDialog({
  open,
  onOpenChange,
  onBrewSaved,
  editBrew,
  prefill,
  pills = [],
  controllers = [],
}: CustomBrewDialogProps) {
  const [name, setName] = useState("");
  const [style, setStyle] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [originalGravity, setOriginalGravity] = useState("");
  const [finalGravity, setFinalGravity] = useState("");
  const [linkedPillId, setLinkedPillId] = useState<string | null>(null);

  const [status, setStatus] = useState("Jäsning");
  const [originalStatus, setOriginalStatus] = useState("Jäsning");
  const [fermentationStart, setFermentationStart] = useState("");
  const [labelImageUrl, setLabelImageUrl] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [uploadingLabel, setUploadingLabel] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [sgData, setSgData] = useState<SgDataPoint[]>([]);
  const [selectedEndPointIndex, setSelectedEndPointIndex] = useState<string>("");
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

  // Resolve controller from selected pill via hardware pairing
  const resolvedControllerId = useMemo(() => {
    if (!linkedPillId) return null;
    const pill = pills.find(p => p.pill_id === linkedPillId);
    if (pill?.paired_device_id) {
      const ctrl = controllers.find(c => c.controller_id === pill.paired_device_id);
      if (ctrl) return ctrl.controller_id;
    }
    // Fallback: controller that has this pill linked
    const ctrl = controllers.find(c => c.linked_pill_id === linkedPillId);
    return ctrl?.controller_id ?? null;
  }, [linkedPillId, pills, controllers]);

  const resolvedControllerName = useMemo(() => {
    if (!resolvedControllerId) return null;
    return controllers.find(c => c.controller_id === resolvedControllerId)?.name ?? null;
  }, [resolvedControllerId, controllers]);

  // Check if we're changing from Jäsning to another status
  const isLeavingFermentation = isEditMode && 
    originalStatus === "Jäsning" && 
    status !== "Jäsning" && 
    sgData.length > 0;

  // Format sg_data for display in dropdown - show last 30 points reversed (newest first)
  const sgDataOptions = useMemo(() => {
    if (!sgData.length) return [];
    
    return sgData
      .map((point, index) => {
        const temp = point.pillTemp || point.controllerTemp || point.temp;
        const tempStr = temp !== undefined ? `${temp.toFixed(1)}°` : "?°";
        // Support both 'sg' and 'value' field names
        const sgValue = point.sg ?? point.value;
        const sgStr = sgValue !== undefined ? sgValue.toFixed(4) : "?";
        return {
          index,
          date: point.date,
          sg: sgValue,
          temp,
          label: `${format(new Date(point.date), "d MMM HH:mm", { locale: sv })} • ${sgStr} SG • ${tempStr}`
        };
      })
      .reverse() // Show newest first
      .slice(0, 30); // Limit to last 30 points
  }, [sgData]);

  // Load sg_data when editing
  useEffect(() => {
    const loadSgData = async () => {
      if (open && editBrew) {
        const { data, error } = await supabase
          .from("brew_readings")
          .select("sg_data")
          .eq("id", editBrew.id)
          .single();
        
        if (!error && data?.sg_data) {
          const parsedData = Array.isArray(data.sg_data) ? data.sg_data : [];
          setSgData(parsedData as unknown as SgDataPoint[]);
          // Default to last point
          if (parsedData.length > 0) {
            setSelectedEndPointIndex((parsedData.length - 1).toString());
          }
        }
      }
    };
    
    loadSgData();
  }, [open, editBrew]);

  // Reset/populate form when dialog opens
  useEffect(() => {
    if (open) {
      if (editBrew) {
        setName(editBrew.name);
        setStyle(editBrew.style || "");
        setBatchNumber(editBrew.batch_number || "");
        setOriginalGravity(editBrew.original_gravity?.toString() || "1.050");
        setFinalGravity(editBrew.final_gravity?.toString() || "1.010");
        setStatus(editBrew.status || "Jäsning");
        setOriginalStatus(editBrew.status || "Jäsning");
        setLabelImageUrl(editBrew.label_image_url || null);
        setDescription(editBrew.description || "");
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
        // Auto-generate batch number for new custom brews
        const fetchNextNumber = async () => {
          const { count } = await supabase
            .from("brew_readings")
            .select("id", { count: "exact", head: true })
            .like("batch_id", "custom_%");
          setBatchNumber(String((count ?? 0) + 1));
        };
        fetchNextNumber();
        setName(prefill?.name || "");
        setStyle(prefill?.style || "");
        setOriginalGravity("1.050");
        setFinalGravity("1.010");
        setStatus("Jäsning");
        setOriginalStatus("Jäsning");
        setSgData([]);
        setSelectedEndPointIndex("");
        setLabelImageUrl(prefill?.label_image_url || null);
        setDescription(prefill?.description || "");
        // Default to now for new brews
        const now = new Date();
        const localDateTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16);
        setFermentationStart(localDateTime);
      }
    }
  }, [open, editBrew]);

  const handleLabelUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Fel",
        description: "Endast bildfiler är tillåtna",
        variant: "destructive",
      });
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "Fel",
        description: "Bilden får inte vara större än 5MB",
        variant: "destructive",
      });
      return;
    }

    try {
      setUploadingLabel(true);

      // Generate unique filename
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
      const filePath = `labels/${fileName}`;

      // Upload to Supabase storage
      const { error: uploadError } = await supabase.storage
        .from('brew-labels')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('brew-labels')
        .getPublicUrl(filePath);

      setLabelImageUrl(publicUrl);
      toast({
        title: "Etikett uppladdad!",
        description: "Bilden har sparats",
      });
    } catch (error) {
      console.error("Error uploading label:", error);
      toast({
        title: "Fel",
        description: "Kunde inte ladda upp etiketten",
        variant: "destructive",
      });
    } finally {
      setUploadingLabel(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemoveLabel = async () => {
    if (labelImageUrl) {
      // Extract path from URL for deletion
      try {
        const urlParts = labelImageUrl.split('/brew-labels/');
        if (urlParts.length > 1) {
          const path = urlParts[1];
          await supabase.storage.from('brew-labels').remove([path]);
        }
      } catch (error) {
        console.error("Error removing label from storage:", error);
      }
    }
    setLabelImageUrl(null);
  };

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
        // Prepare update data
        const updateData: Record<string, unknown> = {
          name: name.trim(),
          style: style.trim() || "Custom",
          batch_number: batchNumber.trim() || "1",
          original_gravity: og,
          final_gravity: fg,
          attenuation: attenuation,
          abv: abv,
          status: status,
          fermentation_start: fermStart,
          label_image_url: labelImageUrl,
          description: description.trim() || null,
        };

        // If leaving fermentation and user selected an endpoint, trim sg_data
        if (isLeavingFermentation && selectedEndPointIndex !== "") {
          const endIndex = parseInt(selectedEndPointIndex, 10);
          const trimmedSgData = sgData.slice(0, endIndex + 1);
          updateData.sg_data = trimmedSgData;
          
          // Update current_sg to the last point's value (support both field names)
          const lastPoint = trimmedSgData[trimmedSgData.length - 1];
          const lastSgValue = lastPoint?.sg ?? lastPoint?.value;
          if (lastSgValue !== undefined) {
            updateData.current_sg = lastSgValue;
          }
        }

        // If fermentation_start changed, remove sg_data points before that date
        if (fermStart && fermStart !== editBrew.fermentation_start && sgData.length > 0) {
          const fermStartTime = new Date(fermStart).getTime();
          const currentSgData = (updateData.sg_data as Array<{ date: string; [key: string]: unknown }>) ?? sgData;
          const filtered = currentSgData.filter((p: { date: string }) => new Date(p.date).getTime() >= fermStartTime);
          if (filtered.length < currentSgData.length) {
            updateData.sg_data = filtered;
            const removedCount = currentSgData.length - filtered.length;
            console.log(`Removed ${removedCount} sg_data points before fermentation start`);
          }
        }

        // Update existing brew
        const { error: updateError } = await supabase
          .from("brew_readings")
          .update(updateData)
          .eq("id", editBrew.id);

        if (updateError) throw updateError;

        const trimMessage = isLeavingFermentation && selectedEndPointIndex !== "" 
          ? ` (${sgData.length - parseInt(selectedEndPointIndex, 10) - 1} mätpunkter borttagna)`
          : "";

        toast({
          title: "Öl uppdaterad!",
          description: `${name} har sparats${trimMessage}`,
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
            status: status,
            original_gravity: og,
            final_gravity: fg,
            current_sg: og, // Start at OG
            current_temp: 20, // Default temp
            attenuation: 0, // No fermentation yet
            abv: 0, // No fermentation yet
            sg_data: [],
            fermentation_start: fermStart,
            label_image_url: labelImageUrl,
            description: description.trim() || null,
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
      <DialogContent className="sm:max-w-[425px] max-h-[90vh] overflow-y-auto">
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

          {/* Batch number is auto-generated for new brews, hidden */}
          {isEditMode && (
            <div className="grid gap-2">
              <Label htmlFor="batchNumber">Eget nummer</Label>
              <Input
                id="batchNumber"
                value={batchNumber}
                disabled
                className="opacity-60"
              />
            </div>
          )}

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

          {/* Show endpoint selector when leaving fermentation status */}
          {isLeavingFermentation && sgDataOptions.length > 0 && (
            <div className="grid gap-2 p-3 rounded-lg border border-primary/30 bg-primary/10">
              <Label className="text-primary">Sista mätpunkt vid jäsningsslut</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Välj sista riktiga mätpunkten. Alla punkter efter tas bort.
              </p>
              <Select 
                value={selectedEndPointIndex} 
                onValueChange={setSelectedEndPointIndex}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Välj sista mätpunkt" />
                </SelectTrigger>
                <SelectContent>
                  {sgDataOptions.map((option) => (
                    <SelectItem key={option.index} value={option.index.toString()}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedEndPointIndex !== "" && (
                <p className="text-xs text-muted-foreground">
                  {sgData.length - parseInt(selectedEndPointIndex, 10) - 1} mätpunkter kommer att tas bort
                </p>
              )}
            </div>
          )}




          {/* Label Image Upload */}
          <div className="grid gap-2">
            <Label>Öl-etikett</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleLabelUpload}
              className="hidden"
            />
            {labelImageUrl ? (
              <div className="relative group">
                <img
                  src={labelImageUrl}
                  alt="Öl-etikett"
                  className="w-full h-32 object-contain rounded-lg border bg-muted/50"
                />
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={handleRemoveLabel}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="h-24 border-dashed flex flex-col gap-2"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingLabel}
              >
                {uploadingLabel ? (
                  <>
                    <Loader2 className="h-6 w-6 animate-spin" />
                    <span className="text-sm">Laddar upp...</span>
                  </>
                ) : (
                  <>
                    <ImageIcon className="h-6 w-6 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Klicka för att ladda upp etikett
                    </span>
                  </>
                )}
              </Button>
            )}
          </div>

          {/* Description */}
          <div className="grid gap-2">
            <Label htmlFor="description">Beskrivning</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="En poetisk beskrivning av ölet..."
              rows={4}
              className="resize-none"
            />
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
