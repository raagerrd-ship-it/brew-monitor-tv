import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Plus, Trash2 } from "lucide-react";

export interface RecipeIngredient {
  name: string;
  amount: string;
  unit: string;
  type: "malt" | "humle" | "jäst" | "övrigt";
}

export interface RecipeMashStep {
  temp: string;
  minutes: string;
  note: string;
}

export interface RecipeBoilAddition {
  name: string;
  amount: string;
  unit: string;
  minutes: string;
}

export interface RecipeData {
  ingredients: RecipeIngredient[];
  mash_steps: RecipeMashStep[];
  boil_minutes: string;
  boil_additions: RecipeBoilAddition[];
  notes: string;
}

export const emptyRecipe = (): RecipeData => ({
  ingredients: [],
  mash_steps: [],
  boil_minutes: "",
  boil_additions: [],
  notes: "",
});

interface Props {
  value: RecipeData;
  onChange: (next: RecipeData) => void;
}

const INGREDIENT_UNITS = ["kg", "g", "l"];
const BOIL_UNITS = ["g", "kg", "tabletter", "st"];

export function RecipeEditor({ value, onChange }: Props) {
  const patch = (p: Partial<RecipeData>) => onChange({ ...value, ...p });

  return (
    <div className="grid gap-5 p-3 rounded-lg border bg-muted/30">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold">Recept</Label>
      </div>

      {/* Ingredients */}
      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Ingredienser</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() =>
              patch({
                ingredients: [
                  ...value.ingredients,
                  { name: "", amount: "", unit: "kg", type: "malt" },
                ],
              })
            }
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Lägg till
          </Button>
        </div>
        {value.ingredients.map((ing, i) => (
          <div key={i} className="grid grid-cols-[1fr_70px_70px_90px_32px] gap-1.5 items-center">
            <Input
              placeholder="Namn"
              value={ing.name}
              onChange={(e) => {
                const next = [...value.ingredients];
                next[i] = { ...next[i], name: e.target.value };
                patch({ ingredients: next });
              }}
            />
            <Input
              placeholder="Mängd"
              type="number"
              step="0.01"
              value={ing.amount}
              onChange={(e) => {
                const next = [...value.ingredients];
                next[i] = { ...next[i], amount: e.target.value };
                patch({ ingredients: next });
              }}
            />
            <Select
              value={ing.unit}
              onValueChange={(v) => {
                const next = [...value.ingredients];
                next[i] = { ...next[i], unit: v };
                patch({ ingredients: next });
              }}
            >
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {INGREDIENT_UNITS.map((u) => (
                  <SelectItem key={u} value={u}>{u}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={ing.type}
              onValueChange={(v) => {
                const next = [...value.ingredients];
                next[i] = { ...next[i], type: v as RecipeIngredient["type"] };
                patch({ ingredients: next });
              }}
            >
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="malt">Malt</SelectItem>
                <SelectItem value="humle">Humle</SelectItem>
                <SelectItem value="jäst">Jäst</SelectItem>
                <SelectItem value="övrigt">Övrigt</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => patch({ ingredients: value.ingredients.filter((_, j) => j !== i) })}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>

      {/* Mash steps */}
      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Mäsk-steg (temp & tid)</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() =>
              patch({ mash_steps: [...value.mash_steps, { temp: "", minutes: "", note: "" }] })
            }
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Lägg till
          </Button>
        </div>
        {value.mash_steps.map((step, i) => (
          <div key={i} className="grid grid-cols-[70px_70px_1fr_32px] gap-1.5 items-center">
            <Input
              placeholder="°C"
              type="number"
              step="0.1"
              value={step.temp}
              onChange={(e) => {
                const next = [...value.mash_steps];
                next[i] = { ...next[i], temp: e.target.value };
                patch({ mash_steps: next });
              }}
            />
            <Input
              placeholder="min"
              type="number"
              value={step.minutes}
              onChange={(e) => {
                const next = [...value.mash_steps];
                next[i] = { ...next[i], minutes: e.target.value };
                patch({ mash_steps: next });
              }}
            />
            <Input
              placeholder="Anteckning (valfritt)"
              value={step.note}
              onChange={(e) => {
                const next = [...value.mash_steps];
                next[i] = { ...next[i], note: e.target.value };
                patch({ mash_steps: next });
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => patch({ mash_steps: value.mash_steps.filter((_, j) => j !== i) })}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>

      {/* Boil */}
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs text-muted-foreground">Koktid (min)</Label>
          <Input
            className="h-8 w-24"
            placeholder="60"
            type="number"
            value={value.boil_minutes}
            onChange={(e) => patch({ boil_minutes: e.target.value })}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Kok-tillsatser</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() =>
              patch({
                boil_additions: [
                  ...value.boil_additions,
                  { name: "", amount: "", unit: "g", minutes: "" },
                ],
              })
            }
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Lägg till
          </Button>
        </div>
        {value.boil_additions.map((add, i) => (
          <div key={i} className="grid grid-cols-[1fr_70px_80px_70px_32px] gap-1.5 items-center">
            <Input
              placeholder="Namn"
              value={add.name}
              onChange={(e) => {
                const next = [...value.boil_additions];
                next[i] = { ...next[i], name: e.target.value };
                patch({ boil_additions: next });
              }}
            />
            <Input
              placeholder="Mängd"
              type="number"
              step="0.1"
              value={add.amount}
              onChange={(e) => {
                const next = [...value.boil_additions];
                next[i] = { ...next[i], amount: e.target.value };
                patch({ boil_additions: next });
              }}
            />
            <Select
              value={add.unit}
              onValueChange={(v) => {
                const next = [...value.boil_additions];
                next[i] = { ...next[i], unit: v };
                patch({ boil_additions: next });
              }}
            >
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {BOIL_UNITS.map((u) => (
                  <SelectItem key={u} value={u}>{u}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="@min"
              type="number"
              value={add.minutes}
              onChange={(e) => {
                const next = [...value.boil_additions];
                next[i] = { ...next[i], minutes: e.target.value };
                patch({ boil_additions: next });
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => patch({ boil_additions: value.boil_additions.filter((_, j) => j !== i) })}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>

      {/* Notes */}
      <div className="grid gap-2">
        <Label className="text-xs text-muted-foreground">Anteckningar (jäsning, vatten, övrigt)</Label>
        <Textarea
          rows={3}
          value={value.notes}
          onChange={(e) => patch({ notes: e.target.value })}
          placeholder="Ex: Jästemp 18°C, höjning till 20°C dag 5..."
          className="resize-none"
        />
      </div>
    </div>
  );
}