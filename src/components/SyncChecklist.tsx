import { Check, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";

interface SyncStep {
  id: string;
  label: string;
  completed: boolean;
  inProgress: boolean;
}

interface SyncChecklistProps {
  steps: SyncStep[];
}

export const SyncChecklist = ({ steps }: SyncChecklistProps) => {
  return (
    <Card className="p-4 space-y-3">
      <h3 className="font-semibold text-sm">Synkroniseringsstatus</h3>
      <div className="space-y-2">
        {steps.map((step) => (
          <div key={step.id} className="flex items-center gap-2">
            {step.completed ? (
              <Check className="w-4 h-4 text-green-500 shrink-0" />
            ) : step.inProgress ? (
              <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
            ) : (
              <div className="w-4 h-4 rounded-full border-2 border-muted shrink-0" />
            )}
            <span className={`text-sm ${step.completed ? 'text-muted-foreground' : step.inProgress ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
              {step.label}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
};
