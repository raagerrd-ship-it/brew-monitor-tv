import { useState, useEffect } from "react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

interface BrewfatherBatch {
  _id: string;
  name: string;
  batchNo: number;
  brewDate?: string;
  recipe?: {
    name: string;
    style?: {
      name: string;
    };
  };
  status: string;
}

interface SelectedBrew {
  batch_id: string;
  display_order: number;
  is_visible: boolean;
}

export function BrewManagement() {
  const [batches, setBatches] = useState<BrewfatherBatch[]>([]);
  const [selectedBrews, setSelectedBrews] = useState<SelectedBrew[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);

      // Fetch all batches from Brewfather
      const { data: batchesData, error: batchesError } = await supabase.functions.invoke(
        'brewfather-batches',
        { body: {} }
      );

      if (batchesError) throw batchesError;
      
      // Sort batches by brewDate (newest first) or batchNo (highest first)
      const sortedBatches = (batchesData || []).sort((a: BrewfatherBatch, b: BrewfatherBatch) => {
        // Try to sort by brewDate first
        if (a.brewDate && b.brewDate) {
          return new Date(b.brewDate).getTime() - new Date(a.brewDate).getTime();
        }
        // Fallback to batchNo (higher number = newer)
        return (b.batchNo || 0) - (a.batchNo || 0);
      });
      
      setBatches(sortedBatches);

      // Fetch selected brews from database
      const { data: selectedData, error: selectedError } = await supabase
        .from('selected_brews')
        .select('*')
        .eq('is_visible', true)
        .order('display_order');

      if (selectedError) throw selectedError;
      setSelectedBrews(selectedData || []);

    } catch (error) {
      console.error('Error loading data:', error);
      toast({
        title: "Fel",
        description: "Kunde inte ladda data från Brewfather",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const isSelected = (batchId: string) => {
    return selectedBrews.some(brew => brew.batch_id === batchId);
  };

  const toggleBrew = (batchId: string) => {
    if (isSelected(batchId)) {
      setSelectedBrews(selectedBrews.filter(brew => brew.batch_id !== batchId));
    } else {
      if (selectedBrews.length >= 3) {
        toast({
          title: "Maximum 3 öl",
          description: "Du kan bara visa upp till 3 öl samtidigt",
          variant: "destructive",
        });
        return;
      }
      setSelectedBrews([
        ...selectedBrews,
        {
          batch_id: batchId,
          display_order: selectedBrews.length + 1,
          is_visible: true,
        },
      ]);
    }
  };

  const saveSelection = async () => {
    try {
      setSaving(true);

      // Delete all existing selections
      const { error: deleteError } = await supabase
        .from('selected_brews')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');

      if (deleteError) throw deleteError;

      // Insert new selections
      if (selectedBrews.length > 0) {
        const { error: insertError } = await supabase
          .from('selected_brews')
          .insert(
            selectedBrews.map((brew, index) => ({
              batch_id: brew.batch_id,
              display_order: index + 1,
              is_visible: true,
            }))
          );

        if (insertError) throw insertError;
      }

      toast({
        title: "Sparat!",
        description: "Dina val har sparats",
      });

      // Reload the page to show updated brews
      setTimeout(() => window.location.reload(), 1000);

    } catch (error) {
      console.error('Error saving selection:', error);
      toast({
        title: "Fel",
        description: "Kunde inte spara dina val",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Hantera Öl</h2>
        <p className="text-muted-foreground">
          Välj upp till 3 öl att visa på dashboarden
        </p>
      </div>

      <div className="grid gap-4">
        {batches.map((batch) => (
          <Card key={batch._id} className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <Checkbox
                  checked={isSelected(batch._id)}
                  onCheckedChange={() => toggleBrew(batch._id)}
                />
                <div>
                  <h3 className="font-semibold">
                    {batch.recipe?.name || batch.name}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Batch #{batch.batchNo} - {batch.status}
                  </p>
                  {batch.recipe?.style?.name && (
                    <p className="text-xs text-muted-foreground">
                      {batch.recipe.style.name}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="flex justify-between items-center pt-4 border-t">
        <p className="text-sm text-muted-foreground">
          {selectedBrews.length} av 3 öl valda
        </p>
        <Button
          onClick={saveSelection}
          disabled={saving || selectedBrews.length === 0}
        >
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Sparar...
            </>
          ) : (
            'Spara Val'
          )}
        </Button>
      </div>
    </div>
  );
}
