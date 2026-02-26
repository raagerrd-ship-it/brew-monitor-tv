import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Edit2, Trash2, Thermometer, Clock, ArrowDown, ArrowUp, Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { FermentationProfile, FermentationProfileStep, STEP_TYPE_LABELS } from "@/types/fermentation";
import { FermentationStepEditor } from "./FermentationStepEditor";
import { FermentationProfileChart } from "./FermentationProfileChart";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function FermentationProfilesManagement() {
  const [profiles, setProfiles] = useState<FermentationProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<FermentationProfile | null>(null);
  const [steps, setSteps] = useState<FermentationProfileStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  
  // Dialog states
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false);
  const [isStepEditorOpen, setIsStepEditorOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<FermentationProfile | null>(null);
  const [editingStep, setEditingStep] = useState<FermentationProfileStep | null>(null);
  const [deleteProfileId, setDeleteProfileId] = useState<string | null>(null);
  const [deleteStepId, setDeleteStepId] = useState<string | null>(null);
  
  // Form state
  const [profileName, setProfileName] = useState("");
  const [profileDescription, setProfileDescription] = useState("");
  
  const { toast } = useToast();

  useEffect(() => {
    checkAuth();
    loadProfiles();
  }, []);

  useEffect(() => {
    if (selectedProfile) {
      loadSteps(selectedProfile.id);
    } else {
      setSteps([]);
    }
  }, [selectedProfile]);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setIsAuthenticated(!!session);
  };

  const loadProfiles = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('fermentation_profiles')
      .select('*')
      .order('name');
    
    if (error) {
      toast({ title: "Fel", description: "Kunde inte ladda profiler", variant: "destructive" });
    } else {
      setProfiles((data || []) as FermentationProfile[]);
    }
    setLoading(false);
  };

  const loadSteps = async (profileId: string) => {
    const { data, error } = await supabase
      .from('fermentation_profile_steps')
      .select('*')
      .eq('profile_id', profileId)
      .order('step_order');
    
    if (error) {
      toast({ title: "Fel", description: "Kunde inte ladda steg", variant: "destructive" });
    } else {
      setSteps((data || []) as FermentationProfileStep[]);
    }
  };

  const openNewProfileDialog = () => {
    setEditingProfile(null);
    setProfileName("");
    setProfileDescription("");
    setIsProfileDialogOpen(true);
  };

  const openEditProfileDialog = (profile: FermentationProfile) => {
    setEditingProfile(profile);
    setProfileName(profile.name);
    setProfileDescription(profile.description || "");
    setIsProfileDialogOpen(true);
  };

  const handleSaveProfile = async () => {
    if (!profileName.trim()) {
      toast({ title: "Fel", description: "Namn krävs", variant: "destructive" });
      return;
    }

    if (editingProfile) {
      const { error } = await supabase
        .from('fermentation_profiles')
        .update({ name: profileName.trim(), description: profileDescription.trim() || null })
        .eq('id', editingProfile.id);
      
      if (error) {
        toast({ title: "Fel", description: "Kunde inte uppdatera profil", variant: "destructive" });
      } else {
        toast({ title: "Sparad", description: "Profilen har uppdaterats" });
        loadProfiles();
      }
    } else {
      const { error } = await supabase
        .from('fermentation_profiles')
        .insert({ name: profileName.trim(), description: profileDescription.trim() || null });
      
      if (error) {
        toast({ title: "Fel", description: "Kunde inte skapa profil", variant: "destructive" });
      } else {
        toast({ title: "Skapad", description: "Profilen har skapats" });
        loadProfiles();
      }
    }
    setIsProfileDialogOpen(false);
  };

  const handleDeleteProfile = async () => {
    if (!deleteProfileId) return;

    const { error } = await supabase
      .from('fermentation_profiles')
      .delete()
      .eq('id', deleteProfileId);
    
    if (error) {
      toast({ title: "Fel", description: "Kunde inte ta bort profil", variant: "destructive" });
    } else {
      toast({ title: "Borttagen", description: "Profilen har tagits bort" });
      if (selectedProfile?.id === deleteProfileId) {
        setSelectedProfile(null);
      }
      loadProfiles();
    }
    setDeleteProfileId(null);
  };

  const openNewStepEditor = () => {
    setEditingStep(null);
    setIsStepEditorOpen(true);
  };

  const openEditStepEditor = (step: FermentationProfileStep) => {
    setEditingStep(step);
    setIsStepEditorOpen(true);
  };

  const handleSaveStep = async (stepData: Partial<FermentationProfileStep>) => {
    if (!selectedProfile) return;

    if (editingStep) {
      const { error } = await supabase
        .from('fermentation_profile_steps')
        .update(stepData)
        .eq('id', editingStep.id);
      
      if (error) {
        toast({ title: "Fel", description: "Kunde inte uppdatera steg", variant: "destructive" });
      } else {
        toast({ title: "Sparad", description: "Steget har uppdaterats" });
        loadSteps(selectedProfile.id);
      }
    } else {
      const nextOrder = steps.length > 0 ? Math.max(...steps.map(s => s.step_order)) + 1 : 0;
      const insertData = {
        step_type: stepData.step_type || 'hold',
        profile_id: selectedProfile.id,
        step_order: nextOrder,
        target_temp: stepData.target_temp ?? null,
        duration_hours: stepData.duration_hours ?? null,
        ramp_type: stepData.ramp_type ?? null,
        gravity_stable_days: stepData.gravity_stable_days ?? null,
        gravity_threshold: stepData.gravity_threshold ?? null,
        target_sg: stepData.target_sg ?? null,
        sg_comparison: stepData.sg_comparison ?? null,
        notes: stepData.notes ?? null,
        attenuation_trigger: stepData.attenuation_trigger ?? null,
        activity_trigger: stepData.activity_trigger ?? null,
        temp_increase: stepData.temp_increase ?? null,
      };
      const { error } = await supabase
        .from('fermentation_profile_steps')
        .insert(insertData);
      
      if (error) {
        toast({ title: "Fel", description: "Kunde inte skapa steg", variant: "destructive" });
      } else {
        toast({ title: "Tillagt", description: "Steget har lagts till" });
        loadSteps(selectedProfile.id);
      }
    }
    setIsStepEditorOpen(false);
  };

  const handleDeleteStep = async () => {
    if (!deleteStepId || !selectedProfile) return;

    const deletedStep = steps.find(s => s.id === deleteStepId);
    
    const { error } = await supabase
      .from('fermentation_profile_steps')
      .delete()
      .eq('id', deleteStepId);
    
    if (error) {
      toast({ title: "Fel", description: "Kunde inte ta bort steg", variant: "destructive" });
    } else {
      toast({ title: "Borttaget", description: "Steget har tagits bort" });
      
      // Re-number remaining steps to close gaps
      if (deletedStep) {
        const remainingSteps = steps
          .filter(s => s.id !== deleteStepId)
          .sort((a, b) => a.step_order - b.step_order);
        
        // Update step_order for all steps that come after the deleted one
        const updates = remainingSteps.map((step, index) => {
          if (step.step_order !== index) {
            return supabase
              .from('fermentation_profile_steps')
              .update({ step_order: index })
              .eq('id', step.id);
          }
          return null;
        }).filter(Boolean);
        
        if (updates.length > 0) {
          await Promise.all(updates);
        }
      }
      
      loadSteps(selectedProfile.id);
    }
    setDeleteStepId(null);
  };

  const moveStep = async (stepId: string, direction: 'up' | 'down') => {
    if (!selectedProfile) return;

    const stepIndex = steps.findIndex(s => s.id === stepId);
    if (stepIndex === -1) return;
    if (direction === 'up' && stepIndex === 0) return;
    if (direction === 'down' && stepIndex === steps.length - 1) return;

    const swapIndex = direction === 'up' ? stepIndex - 1 : stepIndex + 1;
    const currentStep = steps[stepIndex];
    const swapStep = steps[swapIndex];

    // Optimistic update - swap steps immediately in local state
    const newSteps = [...steps];
    const tempOrder = currentStep.step_order;
    newSteps[stepIndex] = { ...currentStep, step_order: swapStep.step_order };
    newSteps[swapIndex] = { ...swapStep, step_order: tempOrder };
    // Sort by step_order to reflect the new order
    newSteps.sort((a, b) => a.step_order - b.step_order);
    setSteps(newSteps);

    // Sync with database in background
    try {
      await Promise.all([
        supabase.from('fermentation_profile_steps').update({ step_order: swapStep.step_order }).eq('id', currentStep.id),
        supabase.from('fermentation_profile_steps').update({ step_order: currentStep.step_order }).eq('id', swapStep.id),
      ]);
    } catch (error) {
      // Revert on error
      toast({ title: "Fel", description: "Kunde inte flytta steget", variant: "destructive" });
      loadSteps(selectedProfile.id);
    }
  };

  const getStepIcon = (stepType: string) => {
    switch (stepType) {
      case 'ramp': return <ArrowDown className="h-4 w-4" />;
      case 'hold': return <Thermometer className="h-4 w-4" />;
      case 'wait_for_temp': return <Thermometer className="h-4 w-4" />;
      case 'wait_for_gravity_stable': return <Activity className="h-4 w-4" />;
      case 'wait_for_sg': return <Activity className="h-4 w-4" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

  const getStepDescription = (step: FermentationProfileStep) => {
    switch (step.step_type) {
      case 'hold':
        if (step.target_sg !== null) {
          return `Håll ${step.target_temp}° tills SG ${step.sg_comparison === 'at_or_below' ? '≤' : '≥'} ${step.target_sg}`;
        }
        return `Håll ${step.target_temp}° i ${step.duration_hours}h`;
      case 'ramp':
        return `${step.ramp_type === 'immediate' ? 'Ställ in' : 'Rampa till'} ${step.target_temp}°${step.duration_hours ? ` över ${step.duration_hours}h` : ''}`;
      case 'wait_for_temp':
        return `Vänta tills temp når ${step.target_temp}°`;
      case 'wait_for_gravity_stable':
        return `Vänta på stabil SG i ${step.gravity_stable_days} dagar (±${step.gravity_threshold})`;
      case 'wait_for_sg':
        return `Vänta tills SG ${step.sg_comparison === 'at_or_below' ? '≤' : '≥'} ${step.target_sg}`;
      default:
        return '';
    }
  };

  if (loading) {
    return <div className="text-center py-8 text-muted-foreground">Laddar profiler...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Profile selector */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Select 
            value={selectedProfile?.id || ""} 
            onValueChange={(value) => {
              const profile = profiles.find(p => p.id === value);
              setSelectedProfile(profile || null);
            }}
          >
            <SelectTrigger className="w-full bg-card">
              <SelectValue placeholder="Välj en fermenteringsprofil..." />
            </SelectTrigger>
            <SelectContent className="bg-card border-border z-50">
              {profiles.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  {profile.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isAuthenticated && (
          <Button onClick={openNewProfileDialog} size="icon" variant="outline">
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Selected profile actions */}
      {selectedProfile && isAuthenticated && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {selectedProfile.description || 'Ingen beskrivning'}
          </span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openEditProfileDialog(selectedProfile)}
            >
              <Edit2 className="h-4 w-4 mr-1" />
              Redigera
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteProfileId(selectedProfile.id)}
            >
              <Trash2 className="h-4 w-4 mr-1 text-destructive" />
              Ta bort
            </Button>
          </div>
        </div>
      )}

      {/* Steps for selected profile */}
      {selectedProfile && (
        <div className="space-y-4 pt-4 border-t border-border">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold">Steg i profilen</h3>
            {isAuthenticated && (
              <Button onClick={openNewStepEditor} size="sm" variant="outline">
                <Plus className="h-4 w-4 mr-1" /> Lägg till
              </Button>
            )}
          </div>
          
          {/* Profile Chart */}
          {steps.length > 0 && (
            <div className="rounded-lg border bg-card/50 p-3">
              <FermentationProfileChart 
                key={steps.map(s => `${s.id}-${s.step_order}`).join(',')} 
                steps={steps} 
              />
            </div>
          )}

          {steps.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">Inga steg tillagda ännu</p>
          ) : (
            <div className="space-y-2">
              {steps.map((step, index) => (
                <div
                  key={step.id}
                  className="flex items-center gap-2 p-3 rounded-lg border bg-card"
                >
                  {isAuthenticated && (
                    <div className="flex flex-col">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => moveStep(step.id, 'up')}
                        disabled={index === 0}
                      >
                        <ArrowUp className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => moveStep(step.id, 'down')}
                        disabled={index === steps.length - 1}
                      >
                        <ArrowDown className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                  <div className="p-2 rounded-full bg-muted shrink-0">
                    {getStepIcon(step.step_type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{STEP_TYPE_LABELS[step.step_type]}</div>
                    <div className="text-sm text-muted-foreground">{getStepDescription(step)}</div>
                    {step.notes && (
                      <div className="text-xs text-muted-foreground italic mt-1">{step.notes}</div>
                    )}
                  </div>
                  {isAuthenticated && (
                    <div className="flex flex-col gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEditStepEditor(step)}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setDeleteStepId(step.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Profile dialog */}
      <Dialog open={isProfileDialogOpen} onOpenChange={setIsProfileDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingProfile ? 'Redigera profil' : 'Ny profil'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="profile-name">Namn</Label>
              <Input
                id="profile-name"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="T.ex. Lager Profil"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-description">Beskrivning (valfritt)</Label>
              <Textarea
                id="profile-description"
                value={profileDescription}
                onChange={(e) => setProfileDescription(e.target.value)}
                placeholder="Beskrivning av profilen..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsProfileDialogOpen(false)}>
              Avbryt
            </Button>
            <Button onClick={handleSaveProfile}>
              {editingProfile ? 'Spara' : 'Skapa'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Step editor dialog */}
      <FermentationStepEditor
        open={isStepEditorOpen}
        onOpenChange={setIsStepEditorOpen}
        step={editingStep}
        onSave={handleSaveStep}
      />

      {/* Delete profile confirmation */}
      <AlertDialog open={!!deleteProfileId} onOpenChange={() => setDeleteProfileId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort profil?</AlertDialogTitle>
            <AlertDialogDescription>
              Detta kommer att ta bort profilen och alla dess steg. Åtgärden kan inte ångras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteProfile}>Ta bort</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete step confirmation */}
      <AlertDialog open={!!deleteStepId} onOpenChange={() => setDeleteStepId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort steg?</AlertDialogTitle>
            <AlertDialogDescription>
              Steget kommer att tas bort från profilen. Åtgärden kan inte ångras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteStep}>Ta bort</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
