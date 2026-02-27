import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { FermentationProfile, FermentationProfileStep } from "@/types/fermentation";

export function useFermentationProfiles() {
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
    supabase.auth.getSession().then(({ data: { session } }) => setIsAuthenticated(!!session));
    loadProfiles();
  }, []);

  useEffect(() => {
    if (selectedProfile) {
      loadSteps(selectedProfile.id);
    } else {
      setSteps([]);
    }
  }, [selectedProfile]);

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('fermentation_profiles').select('*').order('name');
    if (error) {
      toast({ title: "Fel", description: "Kunde inte ladda profiler", variant: "destructive" });
    } else {
      setProfiles((data || []) as FermentationProfile[]);
    }
    setLoading(false);
  }, [toast]);

  const loadSteps = useCallback(async (profileId: string) => {
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
  }, [toast]);

  const openNewProfileDialog = useCallback(() => {
    setEditingProfile(null);
    setProfileName("");
    setProfileDescription("");
    setIsProfileDialogOpen(true);
  }, []);

  const openEditProfileDialog = useCallback((profile: FermentationProfile) => {
    setEditingProfile(profile);
    setProfileName(profile.name);
    setProfileDescription(profile.description || "");
    setIsProfileDialogOpen(true);
  }, []);

  const handleSaveProfile = useCallback(async () => {
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
  }, [editingProfile, profileName, profileDescription, toast, loadProfiles]);

  const handleDeleteProfile = useCallback(async () => {
    if (!deleteProfileId) return;
    const { error } = await supabase.from('fermentation_profiles').delete().eq('id', deleteProfileId);
    if (error) {
      toast({ title: "Fel", description: "Kunde inte ta bort profil", variant: "destructive" });
    } else {
      toast({ title: "Borttagen", description: "Profilen har tagits bort" });
      if (selectedProfile?.id === deleteProfileId) setSelectedProfile(null);
      loadProfiles();
    }
    setDeleteProfileId(null);
  }, [deleteProfileId, selectedProfile, toast, loadProfiles]);

  const openNewStepEditor = useCallback(() => {
    setEditingStep(null);
    setIsStepEditorOpen(true);
  }, []);

  const openEditStepEditor = useCallback((step: FermentationProfileStep) => {
    setEditingStep(step);
    setIsStepEditorOpen(true);
  }, []);

  const handleSaveStep = useCallback(async (stepData: Partial<FermentationProfileStep>) => {
    if (!selectedProfile) return;

    if (editingStep) {
      const { error } = await supabase.from('fermentation_profile_steps').update(stepData).eq('id', editingStep.id);
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
        min_ramp_hours: stepData.min_ramp_hours ?? null,
        ramp_curve: stepData.ramp_curve ?? null,
      };
      const { error } = await supabase.from('fermentation_profile_steps').insert(insertData);
      if (error) {
        toast({ title: "Fel", description: "Kunde inte skapa steg", variant: "destructive" });
      } else {
        toast({ title: "Tillagt", description: "Steget har lagts till" });
        loadSteps(selectedProfile.id);
      }
    }
    setIsStepEditorOpen(false);
  }, [selectedProfile, editingStep, steps, toast, loadSteps]);

  const handleDeleteStep = useCallback(async () => {
    if (!deleteStepId || !selectedProfile) return;
    const deletedStep = steps.find(s => s.id === deleteStepId);
    const { error } = await supabase.from('fermentation_profile_steps').delete().eq('id', deleteStepId);
    if (error) {
      toast({ title: "Fel", description: "Kunde inte ta bort steg", variant: "destructive" });
    } else {
      toast({ title: "Borttaget", description: "Steget har tagits bort" });
      if (deletedStep) {
        const remainingSteps = steps.filter(s => s.id !== deleteStepId).sort((a, b) => a.step_order - b.step_order);
        const updates = remainingSteps.map((step, index) => {
          if (step.step_order !== index) {
            return supabase.from('fermentation_profile_steps').update({ step_order: index }).eq('id', step.id);
          }
          return null;
        }).filter(Boolean);
        if (updates.length > 0) await Promise.all(updates);
      }
      loadSteps(selectedProfile.id);
    }
    setDeleteStepId(null);
  }, [deleteStepId, selectedProfile, steps, toast, loadSteps]);

  const moveStep = useCallback(async (stepId: string, direction: 'up' | 'down') => {
    if (!selectedProfile) return;
    const stepIndex = steps.findIndex(s => s.id === stepId);
    if (stepIndex === -1) return;
    if (direction === 'up' && stepIndex === 0) return;
    if (direction === 'down' && stepIndex === steps.length - 1) return;

    const swapIndex = direction === 'up' ? stepIndex - 1 : stepIndex + 1;
    const currentStep = steps[stepIndex];
    const swapStep = steps[swapIndex];

    const newSteps = [...steps];
    const tempOrder = currentStep.step_order;
    newSteps[stepIndex] = { ...currentStep, step_order: swapStep.step_order };
    newSteps[swapIndex] = { ...swapStep, step_order: tempOrder };
    newSteps.sort((a, b) => a.step_order - b.step_order);
    setSteps(newSteps);

    try {
      await Promise.all([
        supabase.from('fermentation_profile_steps').update({ step_order: swapStep.step_order }).eq('id', currentStep.id),
        supabase.from('fermentation_profile_steps').update({ step_order: currentStep.step_order }).eq('id', swapStep.id),
      ]);
    } catch {
      toast({ title: "Fel", description: "Kunde inte flytta steget", variant: "destructive" });
      loadSteps(selectedProfile.id);
    }
  }, [selectedProfile, steps, toast, loadSteps]);

  return {
    profiles,
    selectedProfile,
    setSelectedProfile,
    steps,
    loading,
    isAuthenticated,
    isProfileDialogOpen,
    setIsProfileDialogOpen,
    isStepEditorOpen,
    setIsStepEditorOpen,
    editingProfile,
    editingStep,
    deleteProfileId,
    setDeleteProfileId,
    deleteStepId,
    setDeleteStepId,
    profileName,
    setProfileName,
    profileDescription,
    setProfileDescription,
    openNewProfileDialog,
    openEditProfileDialog,
    handleSaveProfile,
    handleDeleteProfile,
    openNewStepEditor,
    openEditStepEditor,
    handleSaveStep,
    handleDeleteStep,
    moveStep,
  };
}
