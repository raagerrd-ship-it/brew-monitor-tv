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

export interface RecipeWaterAdjustment {
  name: string;
  amount: string;
  unit: string;
  target: "mäskkärl" | "lakkärl" | "kokkärl" | "övrigt";
}

export interface RecipeData {
  ingredients: RecipeIngredient[];
  mash_steps: RecipeMashStep[];
  boil_minutes: string;
  boil_additions: RecipeBoilAddition[];
  mash_water_liters: string;
  sparge_water_liters: string;
  water_adjustments: RecipeWaterAdjustment[];
  notes: string;
}

export const emptyRecipe = (): RecipeData => ({
  ingredients: [],
  mash_steps: [],
  boil_minutes: "",
  boil_additions: [],
  mash_water_liters: "",
  sparge_water_liters: "",
  water_adjustments: [],
  notes: "",
});

interface Props {
  value: RecipeData;
  onChange: (next: RecipeData) => void;
}

const INGREDIENT_UNITS = ["kg", "g", "l"];
const BOIL_UNITS = ["g", "kg", "tabletter", "st"];
const WATER_ADJ_UNITS = ["g", "ml", "tsk", "msk"];

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

      {/* Water volumes & adjustments */}
      <div className="grid gap-2">
        <Label className="text-xs text-muted-foreground">Vattenmängd</Label>
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1">
            <Label className="text-[11px] text-muted-foreground">Mäskkärl (L)</Label>
            <Input
              type="number"
              step="0.1"
              placeholder="t.ex. 18"
              value={value.mash_water_liters}
              onChange={(e) => patch({ mash_water_liters: e.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-[11px] text-muted-foreground">Lakkärl (L)</Label>
            <Input
              type="number"
              step="0.1"
              placeholder="t.ex. 14"
              value={value.sparge_water_liters}
              onChange={(e) => patch({ sparge_water_liters: e.target.value })}
            />
          </div>
        </div>
        <div className="flex items-center justify-between mt-1">
          <Label className="text-xs text-muted-foreground">Vattenjustering (salter/syra)</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() =>
              patch({
                water_adjustments: [
                  ...value.water_adjustments,
                  { name: "", amount: "", unit: "g", target: "mäskkärl" },
                ],
              })
            }
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Lägg till
          </Button>
        </div>
        {value.water_adjustments.map((adj, i) => (
          <div key={i} className="grid grid-cols-[1fr_70px_70px_100px_32px] gap-1.5 items-center">
            <Input
              placeholder="Ex: Gips (CaSO₄)"
              value={adj.name}
              onChange={(e) => {
                const next = [...value.water_adjustments];
                next[i] = { ...next[i], name: e.target.value };
                patch({ water_adjustments: next });
              }}
            />
            <Input
              placeholder="Mängd"
              type="number"
              step="0.1"
              value={adj.amount}
              onChange={(e) => {
                const next = [...value.water_adjustments];
                next[i] = { ...next[i], amount: e.target.value };
                patch({ water_adjustments: next });
              }}
            />
            <Select
              value={adj.unit}
              onValueChange={(v) => {
                const next = [...value.water_adjustments];
                next[i] = { ...next[i], unit: v };
                patch({ water_adjustments: next });
              }}
            >
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {WATER_ADJ_UNITS.map((u) => (
                  <SelectItem key={u} value={u}>{u}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={adj.target}
              onValueChange={(v) => {
                const next = [...value.water_adjustments];
                next[i] = { ...next[i], target: v as RecipeWaterAdjustment["target"] };
                patch({ water_adjustments: next });
              }}
            >
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="mäskkärl">Mäskkärl</SelectItem>
                <SelectItem value="lakkärl">Lakkärl</SelectItem>
                <SelectItem value="kokkärl">Kokkärl</SelectItem>
                <SelectItem value="övrigt">Övrigt</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => patch({ water_adjustments: value.water_adjustments.filter((_, j) => j !== i) })}
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