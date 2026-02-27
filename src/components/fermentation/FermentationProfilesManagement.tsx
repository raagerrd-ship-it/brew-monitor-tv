import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Edit2, Trash2, Thermometer, Clock, ArrowDown, ArrowUp, Activity } from "lucide-react";
import { STEP_TYPE_LABELS } from "@/types/fermentation";
import { FermentationStepEditor } from "./FermentationStepEditor";
import { FermentationProfileChart } from "./FermentationProfileChart";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useFermentationProfiles } from "@/hooks/use-fermentation-profiles";
import { FermentationProfileStep } from "@/types/fermentation";

export function FermentationProfilesManagement() {
  const {
    profiles, selectedProfile, setSelectedProfile, steps, loading, isAuthenticated,
    isProfileDialogOpen, setIsProfileDialogOpen, isStepEditorOpen, setIsStepEditorOpen,
    editingProfile, editingStep, deleteProfileId, setDeleteProfileId,
    deleteStepId, setDeleteStepId, profileName, setProfileName,
    profileDescription, setProfileDescription,
    openNewProfileDialog, openEditProfileDialog, handleSaveProfile, handleDeleteProfile,
    openNewStepEditor, openEditStepEditor, handleSaveStep, handleDeleteStep, moveStep,
  } = useFermentationProfiles();

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
        if (step.target_sg !== null) return `Håll ${step.target_temp}° tills SG ${step.sg_comparison === 'at_or_below' ? '≤' : '≥'} ${step.target_sg}`;
        return `Håll ${step.target_temp}° i ${step.duration_hours}h`;
      case 'ramp':
        return `${step.ramp_type === 'immediate' ? 'Ställ in' : 'Rampa till'} ${step.target_temp}°${step.duration_hours ? ` över ${step.duration_hours}h` : ''}`;
      case 'wait_for_temp': return `Vänta tills temp når ${step.target_temp}°`;
      case 'wait_for_gravity_stable': return `Vänta på stabil SG i ${step.gravity_stable_days} dagar (±${step.gravity_threshold})`;
      case 'wait_for_sg': return `Vänta tills SG ${step.sg_comparison === 'at_or_below' ? '≤' : '≥'} ${step.target_sg}`;
      default: return '';
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
          <Select value={selectedProfile?.id || ""} onValueChange={(value) => {
            const profile = profiles.find(p => p.id === value);
            setSelectedProfile(profile || null);
          }}>
            <SelectTrigger className="w-full bg-card">
              <SelectValue placeholder="Välj en fermenteringsprofil..." />
            </SelectTrigger>
            <SelectContent className="bg-card border-border z-50">
              {profiles.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>
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
          <span className="text-muted-foreground">{selectedProfile.description || 'Ingen beskrivning'}</span>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => openEditProfileDialog(selectedProfile)}>
              <Edit2 className="h-4 w-4 mr-1" />Redigera
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDeleteProfileId(selectedProfile.id)}>
              <Trash2 className="h-4 w-4 mr-1 text-destructive" />Ta bort
            </Button>
          </div>
        </div>
      )}

      {/* Steps */}
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

          {steps.length > 0 && (
            <div className="rounded-lg border bg-card/50 p-3">
              <FermentationProfileChart key={steps.map(s => `${s.id}-${s.step_order}`).join(',')} steps={steps} />
            </div>
          )}

          {steps.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">Inga steg tillagda ännu</p>
          ) : (
            <div className="space-y-2">
              {steps.map((step, index) => (
                <div key={step.id} className="flex items-center gap-2 p-3 rounded-lg border bg-card">
                  {isAuthenticated && (
                    <div className="flex flex-col">
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => moveStep(step.id, 'up')} disabled={index === 0}>
                        <ArrowUp className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => moveStep(step.id, 'down')} disabled={index === steps.length - 1}>
                        <ArrowDown className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                  <div className="p-2 rounded-full bg-muted shrink-0">{getStepIcon(step.step_type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{STEP_TYPE_LABELS[step.step_type]}</div>
                    <div className="text-sm text-muted-foreground">{getStepDescription(step)}</div>
                    {step.notes && <div className="text-xs text-muted-foreground italic mt-1">{step.notes}</div>}
                  </div>
                  {isAuthenticated && (
                    <div className="flex flex-col gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditStepEditor(step)}>
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDeleteStepId(step.id)}>
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

      {/* Dialogs */}
      <Dialog open={isProfileDialogOpen} onOpenChange={setIsProfileDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingProfile ? 'Redigera profil' : 'Ny profil'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="profile-name">Namn</Label>
              <Input id="profile-name" value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="T.ex. Lager Profil" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-description">Beskrivning (valfritt)</Label>
              <Textarea id="profile-description" value={profileDescription} onChange={(e) => setProfileDescription(e.target.value)} placeholder="Beskrivning av profilen..." rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsProfileDialogOpen(false)}>Avbryt</Button>
            <Button onClick={handleSaveProfile}>{editingProfile ? 'Spara' : 'Skapa'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FermentationStepEditor open={isStepEditorOpen} onOpenChange={setIsStepEditorOpen} step={editingStep} onSave={handleSaveStep} />

      <AlertDialog open={!!deleteProfileId} onOpenChange={() => setDeleteProfileId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort profil?</AlertDialogTitle>
            <AlertDialogDescription>Detta kommer att ta bort profilen och alla dess steg. Åtgärden kan inte ångras.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteProfile}>Ta bort</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteStepId} onOpenChange={() => setDeleteStepId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort steg?</AlertDialogTitle>
            <AlertDialogDescription>Steget kommer att tas bort från profilen. Åtgärden kan inte ångras.</AlertDialogDescription>
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
