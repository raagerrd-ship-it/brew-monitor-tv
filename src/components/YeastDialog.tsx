import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export interface YeastEntry {
  name: string;
  lab: string | null;
  min_temp: number | null;
  max_temp: number | null;
  attenuation: number | null;
}

interface Props {
  open: boolean;
  brewName: string;
  onOpenChange: (open: boolean) => void;
  onSave: (yeast: YeastEntry) => void;
}

/** Jäst saknas på receptet — måste fyllas i innan bryggden får gå till Pi:n. */
export function YeastDialog({ open, brewName, onOpenChange, onSave }: Props) {
  const [name, setName] = useState("");
  const [lab, setLab] = useState("");
  const [minTemp, setMinTemp] = useState("");
  const [maxTemp, setMaxTemp] = useState("");

  const valid = name.trim() && minTemp !== "" && maxTemp !== "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Jäst för {brewName}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Jäscontrollern behöver jästens temperaturspann för att kunna varna och reglera.
        </p>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="yeast-name">Namn</Label>
            <Input id="yeast-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="NovaLager" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="yeast-lab">Labb</Label>
            <Input id="yeast-lab" value={lab} onChange={(e) => setLab(e.target.value)} placeholder="Lallemand" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="yeast-min">Min °C</Label>
              <Input id="yeast-min" type="number" step="0.1" value={minTemp} onChange={(e) => setMinTemp(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="yeast-max">Max °C</Label>
              <Input id="yeast-max" type="number" step="0.1" value={maxTemp} onChange={(e) => setMaxTemp(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!valid}
            onClick={() =>
              onSave({
                name: name.trim(),
                lab: lab.trim() || null,
                min_temp: Number(minTemp),
                max_temp: Number(maxTemp),
                attenuation: null,
              })
            }
          >
            Spara och skicka
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
