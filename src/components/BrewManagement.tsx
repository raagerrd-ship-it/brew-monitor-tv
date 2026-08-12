import { useNavigate } from "react-router-dom";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Loader2, Plus, Trash2, Pencil, Beer, Flame, Thermometer, GlassWater, Archive, FlaskConical, Send, Check, ExternalLink } from "lucide-react";
import { Badge } from "./ui/badge";
import { CustomBrewDialog } from "./CustomBrewDialog";
import { useBrewManagement } from "@/hooks";

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'Bryggning':
      return <Badge variant="outline" className="text-orange-400 border-orange-400/30 text-xs"><Flame className="h-3 w-3 mr-1" />Bryggning</Badge>;
    case 'Jäsning':
    case 'Fermenting':
      return <Badge variant="outline" className="text-green-400 border-green-400/30 text-xs"><FlaskConical className="h-3 w-3 mr-1" />Jäsning</Badge>;
    case 'Konditionering':
      return <Badge variant="outline" className="text-blue-400 border-blue-400/30 text-xs"><GlassWater className="h-3 w-3 mr-1" />Konditionering</Badge>;
    case 'Klar':
    case 'Completed':
      return <Badge variant="outline" className="text-muted-foreground border-muted text-xs">Klar</Badge>;
    default:
      return <Badge variant="outline" className="text-muted-foreground border-muted text-xs">{status}</Badge>;
  }
}

export function BrewManagement() {
  const navigate = useNavigate();
  const {
    customBrews, pills, controllers,
    loading, showCustomBrewDialog, editingBrew, prefillData,
    timerRecipeName, timerBeerStyle, timerBrewMatch,
    deleteCustomBrew,
    setPiPending,
    openCustomBrewDialog, openEditBrewDialog, closeCustomBrewDialog,
    setShowCustomBrewDialog, loadData,
  } = useBrewManagement();

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="space-y-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold">Hantera Öl</h2>
          <p className="text-sm text-muted-foreground">
            Dashboarden visar de bryggningar Pi:n rapporterar som aktiva
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {timerRecipeName && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                openCustomBrewDialog({
                  name: timerRecipeName || '',
                  style: timerBrewMatch?.style || timerBeerStyle || '',
                  description: timerBrewMatch?.description || undefined,
                  label_image_url: timerBrewMatch?.label_image_url || undefined,
                });
              }}
            >
              <Beer className="mr-1.5 h-3.5 w-3.5" />
              <span className="truncate max-w-[180px]">Lägg till {timerRecipeName}</span>
            </Button>
          )}
          <Button size="sm" onClick={() => openCustomBrewDialog()}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Skapa egen öl
          </Button>
        </div>
      </div>

      {/* Custom brews section */}
      {customBrews.filter(b => b.status !== 'Arkiverad').length > 0 && (
        <div className="space-y-2">
          <h3 className="text-lg font-semibold text-muted-foreground">Egna bryggningar</h3>
          <div className="grid gap-4">
            {customBrews
              .filter(b => b.status !== 'Arkiverad')
              .sort((a, b) => {
                const order: Record<string, number> = { 'Planering': 0, 'Bryggning': 1, 'Jäsning': 2, 'Fermenting': 2, 'Konditionering': 3, 'Klar': 4, 'Completed': 4 };
                return (order[a.status] ?? 5) - (order[b.status] ?? 5);
              })
              .map((brew) => (
              <Card key={brew.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{brew.name}</h3>
                        <StatusBadge status={brew.status} />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {brew.style || 'Custom'}
                        {brew.original_gravity ? ` · OG ${brew.original_gravity.toFixed(3)}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {brew.pi_pending_at ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPiPending(brew.id, false)}
                      >
                        <Check className="mr-1.5 h-3.5 w-3.5" />
                        Mottagen
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPiPending(brew.id, true)}
                      >
                        <Send className="mr-1.5 h-3.5 w-3.5" />
                        Skicka till Jäscontroller
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEditBrewDialog(brew)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteCustomBrew(brew.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}


      <CustomBrewDialog
        open={showCustomBrewDialog}
        onOpenChange={(open) => {
          if (!open) closeCustomBrewDialog();
          else setShowCustomBrewDialog(open);
        }}
        onBrewSaved={loadData}
        editBrew={editingBrew}
        prefill={prefillData}
        pills={pills}
        controllers={controllers}
      />
    </div>
  );
}
