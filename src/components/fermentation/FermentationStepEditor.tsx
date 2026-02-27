import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FermentationProfileStep,
  StepType,
  RampType,
  SgComparison,
  STEP_TYPE_LABELS,
  RAMP_TYPE_LABELS,
  SG_COMPARISON_LABELS,
} from "@/types/fermentation";

interface FermentationStepEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: FermentationProfileStep | null;
  onSave: (stepData: Partial<FermentationProfileStep>) => void;
}

export function FermentationStepEditor({
  open,
  onOpenChange,
  step,
  onSave,
}: FermentationStepEditorProps) {
  const [stepType, setStepType] = useState<StepType>("hold");
  const [targetTemp, setTargetTemp] = useState<string>("");
  const [durationHours, setDurationHours] = useState<string>("");
  const [rampType, setRampType] = useState<RampType>("linear");
  const [gravityStableDays, setGravityStableDays] = useState<string>("3");
  const [gravityThreshold, setGravityThreshold] = useState<string>("0.001");
  const [targetSg, setTargetSg] = useState<string>("");
  const [sgComparison, setSgComparison] = useState<SgComparison>("at_or_below");
  const [notes, setNotes] = useState<string>("");
  const [holdEndCondition, setHoldEndCondition] = useState<"time" | "sg" | "gravity_stable" | "temp_reached">("time");
  const [attenuationTrigger, setAttenuationTrigger] = useState<string>("75");
  const [activityTrigger, setActivityTrigger] = useState<string>("35");
  const [tempIncrease, setTempIncrease] = useState<string>("3");

  useEffect(() => {
    if (step) {
      setStepType(step.step_type);
      setTargetTemp(step.target_temp?.toString() || "");
      setDurationHours(step.duration_hours?.toString() || "");
      setRampType(step.ramp_type || "linear");
      setGravityStableDays(step.gravity_stable_days?.toString() || "3");
      setGravityThreshold(step.gravity_threshold?.toString() || "0.001");
      setTargetSg(step.target_sg?.toString() || "");
      setSgComparison(step.sg_comparison || "at_or_below");
      setNotes(step.notes || "");
      setAttenuationTrigger(step.attenuation_trigger?.toString() || "75");
      setActivityTrigger((step as any).activity_trigger?.toString() || "35");
      setTempIncrease(step.temp_increase?.toString() || "3");
      // Determine hold end condition based on existing step_type
      if (step.step_type === "wait_for_gravity_stable") {
        setStepType("hold");
        setHoldEndCondition("gravity_stable");
      } else if (step.step_type === "wait_for_sg") {
        setStepType("hold");
        setHoldEndCondition("sg");
      } else if (step.step_type === "wait_for_temp") {
        setStepType("hold");
        setHoldEndCondition("temp_reached");
      } else if (step.step_type === "hold" && step.target_sg !== null) {
        setHoldEndCondition("sg");
      } else {
        setHoldEndCondition("time");
      }
    } else {
      resetForm();
    }
  }, [step, open]);

  const resetForm = () => {
    setStepType("hold");
    setTargetTemp("");
    setDurationHours("");
    setRampType("linear");
    setGravityStableDays("3");
    setGravityThreshold("0.001");
    setTargetSg("");
    setSgComparison("at_or_below");
    setNotes("");
    setHoldEndCondition("time");
    setAttenuationTrigger("75");
    setTempIncrease("3");
  };

  const handleSave = () => {
    const stepData: Partial<FermentationProfileStep> = {
      step_type: stepType,
      notes: notes.trim() || null,
      // Clear all conditional fields first
      duration_hours: null,
      target_sg: null,
      sg_comparison: null,
      gravity_stable_days: null,
      gravity_threshold: null,
      ramp_type: null,
      target_temp: null,
    };

    switch (stepType) {
      case "hold":
        stepData.target_temp = targetTemp ? parseFloat(targetTemp) : null;
        if (holdEndCondition === "time") {
          stepData.step_type = "hold";
          stepData.duration_hours = durationHours ? parseInt(durationHours) : null;
        } else if (holdEndCondition === "sg") {
          stepData.step_type = "hold";
          stepData.target_sg = targetSg ? parseFloat(targetSg) : null;
          stepData.sg_comparison = sgComparison;
        } else if (holdEndCondition === "gravity_stable") {
          stepData.step_type = "wait_for_gravity_stable";
          stepData.gravity_stable_days = gravityStableDays ? parseInt(gravityStableDays) : null;
          stepData.gravity_threshold = gravityThreshold ? parseFloat(gravityThreshold) : null;
        } else if (holdEndCondition === "temp_reached") {
          stepData.step_type = "wait_for_temp";
        }
        break;
      case "ramp":
        stepData.target_temp = targetTemp ? parseFloat(targetTemp) : null;
        stepData.ramp_type = rampType;
        stepData.duration_hours = rampType === "linear" ? (durationHours ? parseInt(durationHours) : null) : null;
        break;
      case "wait_for_acknowledgement":
        break;
      case "diacetyl_rest":
        stepData.attenuation_trigger = attenuationTrigger ? parseFloat(attenuationTrigger) : 75;
        stepData.temp_increase = tempIncrease ? parseFloat(tempIncrease) : 3;
        stepData.gravity_stable_days = gravityStableDays ? parseInt(gravityStableDays) : 2;
        stepData.gravity_threshold = gravityThreshold ? parseFloat(gravityThreshold) : 0.001;
        break;
      case "gradual_ramp":
        stepData.activity_trigger = activityTrigger ? parseFloat(activityTrigger) : 35;
        stepData.temp_increase = tempIncrease ? parseFloat(tempIncrease) : 3;
        stepData.gravity_stable_days = gravityStableDays ? parseInt(gravityStableDays) : 2;
        stepData.gravity_threshold = gravityThreshold ? parseFloat(gravityThreshold) : 0.001;
        break;
    }

    onSave(stepData);
  };

  const renderStepTypeFields = () => {
    switch (stepType) {
      case "hold":
        return (
          <>
            <div className="space-y-2">
              <Label>Måltemperatur (°C)</Label>
              <Input
                type="number"
                step="0.5"
                value={targetTemp}
                onChange={(e) => setTargetTemp(e.target.value)}
                placeholder="20"
              />
            </div>
            
            <div className="space-y-2">
              <Label>Slutvillkor</Label>
              <Select value={holdEndCondition} onValueChange={(v) => setHoldEndCondition(v as "time" | "sg" | "gravity_stable" | "temp_reached")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border z-50">
                  <SelectItem value="time">Tid (antal timmar)</SelectItem>
                  <SelectItem value="sg">SG-värde uppnått</SelectItem>
                  <SelectItem value="gravity_stable">Stabil SG (antal dagar)</SelectItem>
                  <SelectItem value="temp_reached">Temperatur nådd</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {holdEndCondition === "time" && (
              <div className="space-y-2">
                <Label>Varaktighet (timmar)</Label>
                <Input
                  type="number"
                  value={durationHours}
                  onChange={(e) => setDurationHours(e.target.value)}
                  placeholder="48"
                />
              </div>
            )}

            {holdEndCondition === "sg" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Jämförelse</Label>
                  <Select value={sgComparison} onValueChange={(v) => setSgComparison(v as SgComparison)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border z-50">
                      {Object.entries(SG_COMPARISON_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Mål-SG</Label>
                  <Input
                    type="number"
                    step="0.001"
                    value={targetSg}
                    onChange={(e) => setTargetSg(e.target.value)}
                    placeholder="1.020"
                  />
                </div>
              </div>
            )}

            {holdEndCondition === "gravity_stable" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Antal dagar stabil</Label>
                  <Input
                    type="number"
                    value={gravityStableDays}
                    onChange={(e) => setGravityStableDays(e.target.value)}
                    placeholder="3"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Max SG-variation</Label>
                  <Input
                    type="number"
                    step="0.001"
                    value={gravityThreshold}
                    onChange={(e) => setGravityThreshold(e.target.value)}
                    placeholder="0.001"
                  />
                </div>
              </div>
            )}
            
            <p className="text-xs text-muted-foreground">
              {holdEndCondition === "time" && "Håll temperaturen under angiven tid innan nästa steg."}
              {holdEndCondition === "sg" && "Håll temperaturen tills SG-värdet når det angivna villkoret."}
              {holdEndCondition === "gravity_stable" && "Håll temperaturen tills SG-värdet har varit stabilt under det angivna antalet dagar."}
              {holdEndCondition === "temp_reached" && "Steget fortsätter automatiskt när controllerns temperatur når målvärdet (±0.5°C)."}
            </p>
          </>
        );

      case "ramp":
        return (
          <>
            <div className="space-y-2">
              <Label>Ramptyp</Label>
              <Select value={rampType} onValueChange={(v) => setRampType(v as RampType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(RAMP_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Måltemperatur (°C)</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={targetTemp}
                  onChange={(e) => setTargetTemp(e.target.value)}
                  placeholder="4"
                />
              </div>
              {rampType === "linear" && (
                <div className="space-y-2">
                  <Label>Tid för rampa (timmar)</Label>
                  <Input
                    type="number"
                    value={durationHours}
                    onChange={(e) => setDurationHours(e.target.value)}
                    placeholder="24"
                  />
                </div>
              )}
            </div>
          </>
        );

      case "wait_for_acknowledgement":
        return (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Steget pausar profilen och väntar på att du kvitterar manuellt innan nästa steg startar.
              Skriv i Anteckningar nedan vad som ska visas på TV:n, t.ex. "Torrhumla", "Klar" etc.
            </p>
          </div>
        );

      case "diacetyl_rest":
        return (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Utjäsningsnivå (%)</Label>
                <Input
                  type="number"
                  step="5"
                  value={attenuationTrigger}
                  onChange={(e) => setAttenuationTrigger(e.target.value)}
                  placeholder="75"
                />
              </div>
              <div className="space-y-2">
                <Label>Temperaturhöjning (°C)</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={tempIncrease}
                  onChange={(e) => setTempIncrease(e.target.value)}
                  placeholder="3"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Stabila dagar efter vila</Label>
                <Input
                  type="number"
                  value={gravityStableDays}
                  onChange={(e) => setGravityStableDays(e.target.value)}
                  placeholder="2"
                />
              </div>
              <div className="space-y-2">
                <Label>SG-tröskel</Label>
                <Input
                  type="number"
                  step="0.001"
                  value={gravityThreshold}
                  onChange={(e) => setGravityThreshold(e.target.value)}
                  placeholder="0.001"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Höjer temperaturen automatiskt när utjäsningen når angiven nivå. Väntar sedan på stabil SG innan nästa steg.
              Särskilt viktigt för lager för att bryta ned diacetyl.
            </p>
          </>
        );

      case "gradual_ramp":
        return (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Aktivitetströskel (%)</Label>
                <Input
                  type="number"
                  step="5"
                  value={activityTrigger}
                  onChange={(e) => setActivityTrigger(e.target.value)}
                  placeholder="35"
                />
                <p className="text-xs text-muted-foreground">Börjar rampa när aktiviteten sjunker under denna nivå</p>
              </div>
              <div className="space-y-2">
                <Label>Temperaturhöjning (°C)</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={tempIncrease}
                  onChange={(e) => setTempIncrease(e.target.value)}
                  placeholder="3"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Stabila dagar efter avslut</Label>
                <Input
                  type="number"
                  value={gravityStableDays}
                  onChange={(e) => setGravityStableDays(e.target.value)}
                  placeholder="2"
                />
              </div>
              <div className="space-y-2">
                <Label>SG-tröskel</Label>
                <Input
                  type="number"
                  step="0.001"
                  value={gravityThreshold}
                  onChange={(e) => setGravityThreshold(e.target.value)}
                  placeholder="0.001"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Börjar höja temperaturen gradvis när jäsningsaktiviteten sjunker under tröskeln. 
              Ju lägre aktivitet, desto högre temperatur (max +{tempIncrease || 3}°C).
              Avslutas när SG är stabil och aktiviteten är nära noll.
            </p>
          </>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{step ? "Redigera steg" : "Nytt steg"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Stegtyp</Label>
            <Select value={stepType} onValueChange={(v) => setStepType(v as StepType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['hold', 'ramp', 'wait_for_acknowledgement', 'diacetyl_rest', 'gradual_ramp'] as StepType[]).map((value) => (
                  <SelectItem key={value} value={value}>
                    {STEP_TYPE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {renderStepTypeFields()}

          <div className="space-y-2">
            <Label>Anteckningar (valfritt)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ytterligare information..."
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button onClick={handleSave}>
            {step ? "Spara" : "Lägg till"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
