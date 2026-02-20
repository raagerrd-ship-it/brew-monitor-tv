import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { FermentationProfile, FermentationProfileStep, STEP_TYPE_LABELS } from "@/types/fermentation";
import { Thermometer, Clock, Activity, ArrowDown, Play, AlertCircle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Controller {
  controller_id: string;
  name: string;
  current_temp: number | null;
  target_temp: number | null;
}

interface Brew {
  id: string;
  batch_id: string;
  name: string;
}

interface StartFermentationSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedControllerId?: string;
  preselectedBrewId?: string;
}

export function StartFermentationSessionDialog({
  open,
  onOpenChange,
  preselectedControllerId,
  preselectedBrewId,
}: StartFermentationSessionDialogProps) {
  const [profiles, setProfiles] = useState<FermentationProfile[]>([]);
  const [controllers, setControllers] = useState<Controller[]>([]);
  const [brews, setBrews] = useState<Brew[]>([]);
  const [steps, setSteps] = useState<FermentationProfileStep[]>([]);
  
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [selectedControllerId, setSelectedControllerId] = useState<string>("");
  const [selectedBrewId, setSelectedBrewId] = useState<string>("");
  
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [existingSession, setExistingSession] = useState<{ controller_id: string; profile_name: string } | null>(null);
  
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      loadData();
      setSelectedControllerId(preselectedControllerId || "");
      setSelectedBrewId(preselectedBrewId || "");
    }
  }, [open, preselectedControllerId, preselectedBrewId]);

  useEffect(() => {
    if (selectedProfileId) {
      loadSteps(selectedProfileId);
    } else {
      setSteps([]);
    }
  }, [selectedProfileId]);

  useEffect(() => {
    if (selectedControllerId) {
      checkExistingSession(selectedControllerId);
    } else {
      setExistingSession(null);
    }
  }, [selectedControllerId]);

  const loadData = async () => {
    setLoading(true);
    
    // Load profiles, controllers, and brews in parallel
    // Include both Swedish 'Jäsning' and English 'Fermenting' statuses for custom brews
    const [profilesRes, controllersRes, brewsRes] = await Promise.all([
      supabase.from('fermentation_profiles').select('*').order('name'),
      supabase.from('rapt_temp_controllers').select('controller_id, name, current_temp, target_temp'),
      supabase.from('brew_readings').select('id, batch_id, name').in('status', ['Jäsning', 'Fermenting']),
    ]);

    if (profilesRes.data) {
      setProfiles(profilesRes.data as FermentationProfile[]);
    }
    if (controllersRes.data) {
      setControllers(controllersRes.data as Controller[]);
    }
    if (brewsRes.data) {
      setBrews(brewsRes.data as Brew[]);
    }
    
    setLoading(false);
  };

  const loadSteps = async (profileId: string) => {
    const { data } = await supabase
      .from('fermentation_profile_steps')
      .select('*')
      .eq('profile_id', profileId)
      .order('step_order');
    
    if (data) {
      setSteps(data as FermentationProfileStep[]);
    }
  };

  const checkExistingSession = async (controllerId: string) => {
    const { data } = await supabase
      .from('fermentation_sessions')
      .select(`
        controller_id,
        fermentation_profiles (name)
      `)
      .eq('controller_id', controllerId)
      .eq('status', 'running')
      .maybeSingle();
    
    if (data) {
      setExistingSession({
        controller_id: data.controller_id,
        profile_name: (data.fermentation_profiles as any)?.name || 'Okänd profil',
      });
    } else {
      setExistingSession(null);
    }
  };

  const handleStart = async () => {
    if (!selectedProfileId || !selectedControllerId) {
      toast({ title: "Fel", description: "Välj profil och controller", variant: "destructive" });
      return;
    }

    setStarting(true);
    
    try {
      // Check for existing session again
      const { data: existing } = await supabase
        .from('fermentation_sessions')
        .select('id')
        .eq('controller_id', selectedControllerId)
        .eq('status', 'running')
        .maybeSingle();

      if (existing) {
        toast({ 
          title: "Session finns redan", 
          description: "Avbryt den befintliga sessionen först", 
          variant: "destructive" 
        });
        setStarting(false);
        return;
      }

      // Create the session
      const { data: session, error } = await supabase
        .from('fermentation_sessions')
        .insert({
          profile_id: selectedProfileId,
          controller_id: selectedControllerId,
          brew_id: selectedBrewId || null,
          status: 'running',
          current_step_index: 0,
          step_started_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      // Log the start
      await supabase.from('fermentation_step_log').insert({
        session_id: session.id,
        step_index: 0,
        action: 'started',
        details: { message: 'Session started' },
      });

      // Trigger immediate processing
      await supabase.functions.invoke('process-fermentation-profiles');

      toast({ 
        title: "Session startad", 
        description: `Fermenteringsprofilen har startats för ${controllers.find(c => c.controller_id === selectedControllerId)?.name}` 
      });
      
      onOpenChange(false);
      
      // Reset form
      setSelectedProfileId("");
      setSelectedControllerId("");
      setSelectedBrewId("");
      
    } catch (error) {
      console.error('Error starting session:', error);
      toast({ title: "Fel", description: "Kunde inte starta session", variant: "destructive" });
    }
    
    setStarting(false);
  };

  const getStepIcon = (stepType: string) => {
    switch (stepType) {
      case 'ramp': return <ArrowDown className="h-3 w-3" />;
      case 'hold': return <Thermometer className="h-3 w-3" />;
      case 'wait_for_temp': return <Thermometer className="h-3 w-3" />;
      case 'wait_for_gravity_stable': return <Activity className="h-3 w-3" />;
      case 'wait_for_sg': return <Activity className="h-3 w-3" />;
      default: return <Clock className="h-3 w-3" />;
    }
  };

  const getStepDescription = (step: FermentationProfileStep) => {
    switch (step.step_type) {
      case 'hold':
        return `${step.target_temp}° i ${step.duration_hours}h`;
      case 'ramp':
        return `${step.ramp_type === 'immediate' ? '→' : '↘'} ${step.target_temp}°${step.duration_hours ? ` (${step.duration_hours}h)` : ''}`;
      case 'wait_for_temp':
        return `Vänta tills ${step.target_temp}°`;
      case 'wait_for_gravity_stable':
        return `Stabil SG ${step.gravity_stable_days}d`;
      case 'wait_for_sg':
        return `SG ${step.sg_comparison === 'at_or_below' ? '≤' : '≥'} ${step.target_sg}`;
      default:
        return '';
    }
  };

  const selectedProfile = profiles.find(p => p.id === selectedProfileId);
  const selectedController = controllers.find(c => c.controller_id === selectedControllerId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-5 w-5" />
            Starta fermenteringsprofil
          </DialogTitle>
          <DialogDescription>
            Välj en profil och controller för att starta automatisk temperaturstyrning.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-muted-foreground">Laddar...</div>
        ) : (
          <div className="space-y-4 py-4">
            {/* Profile selection */}
            <div className="space-y-2">
              <Label>Fermenteringsprofil</Label>
              <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
                <SelectTrigger>
                  <SelectValue placeholder="Välj profil..." />
                </SelectTrigger>
                <SelectContent className="bg-card border-border z-50">
                  {profiles.length === 0 ? (
                    <SelectItem value="none" disabled>Inga profiler skapade</SelectItem>
                  ) : (
                    profiles.map((profile) => (
                      <SelectItem key={profile.id} value={profile.id}>
                        {profile.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Profile steps preview */}
            {selectedProfile && steps.length > 0 && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-xs font-medium text-muted-foreground mb-2">Profil-steg:</div>
                <ScrollArea className="max-h-32">
                  <div className="flex flex-wrap gap-2">
                    {steps.map((step, index) => (
                      <div
                        key={step.id}
                        className="flex items-center gap-1 rounded-full bg-background px-2 py-1 text-xs border"
                      >
                        <span className="text-muted-foreground">{index + 1}.</span>
                        {getStepIcon(step.step_type)}
                        <span>{getStepDescription(step)}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* Controller selection */}
            <div className="space-y-2">
              <Label>Temperature Controller</Label>
              <Select value={selectedControllerId} onValueChange={setSelectedControllerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Välj controller..." />
                </SelectTrigger>
                <SelectContent className="bg-card border-border z-50">
                  {controllers.length === 0 ? (
                    <SelectItem value="none" disabled>Inga controllers tillgängliga</SelectItem>
                  ) : (
                    controllers.map((controller) => (
                      <SelectItem key={controller.controller_id} value={controller.controller_id}>
                        {controller.name} ({controller.current_temp?.toFixed(1) ?? '-'}° → {controller.target_temp?.toFixed(1) ?? '-'}°)
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Existing session warning */}
            {existingSession && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm">
                <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
                <div>
                  <div className="font-medium text-destructive">Aktiv session</div>
                  <div className="text-muted-foreground">
                    Denna controller kör redan profilen "{existingSession.profile_name}". 
                    Avbryt den sessionen först för att starta en ny.
                  </div>
                </div>
              </div>
            )}

            {/* Brew selection (optional) */}
            <div className="space-y-2">
              <Label>Koppla till bryggning (valfritt)</Label>
              <Select value={selectedBrewId || "none"} onValueChange={(value) => setSelectedBrewId(value === "none" ? "" : value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Ingen bryggning vald" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border z-50">
                  <SelectItem value="none">Ingen bryggning</SelectItem>
                  {brews.map((brew) => (
                    <SelectItem key={brew.id} value={brew.id}>
                      {brew.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Om du kopplar en bryggning kan profilen använda SG-data för villkorsstyrning.
              </p>
            </div>

            {/* Summary */}
            {selectedProfile && selectedController && !existingSession && (
              <div className="rounded-lg border bg-primary/5 p-3 text-sm">
                <div className="font-medium">Sammanfattning</div>
                <div className="text-muted-foreground mt-1">
                  Profilen "{selectedProfile.name}" ({steps.length} steg) kommer att styra 
                  temperaturen på {selectedController.name}.
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button 
            onClick={handleStart} 
            disabled={!selectedProfileId || !selectedControllerId || !!existingSession || starting}
          >
            {starting ? "Startar..." : "Starta session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
