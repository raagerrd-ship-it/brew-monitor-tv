import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Plus, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface BrewEvent {
  id: string;
  brew_id: string;
  event_type: string;
  event_date: string;
  notes: string | null;
}

interface BrewEventDialogProps {
  brewId: string;
  brewName: string;
  events: BrewEvent[];
  onEventsChange: () => void;
}

const EVENT_TYPES = [
  { value: "diacetylrast", label: "Diacetylrast" },
  { value: "torrhumling", label: "Torrhumling" },
  { value: "coldcrash", label: "Coldcrash" },
  { value: "other", label: "Annat" },
];

export function BrewEventDialog({
  brewId,
  brewName,
  events,
  onEventsChange,
}: BrewEventDialogProps) {
  const [open, setOpen] = useState(false);
  const [eventType, setEventType] = useState<string>("");
  const [eventDate, setEventDate] = useState<Date>(new Date());
  const [eventTime, setEventTime] = useState<string>(() => {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  });
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const handleAddEvent = async () => {
    if (!eventType || !eventDate) {
      toast({
        title: "Obligatoriska fält",
        description: "Välj händelsetyp och datum",
        variant: "destructive",
      });
      return;
    }

    try {
      setSaving(true);

      // Combine date and time
      const [hours, minutes] = eventTime.split(':');
      const combinedDate = new Date(eventDate);
      combinedDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);

      const { error } = await supabase.from("brew_events").insert({
        brew_id: brewId,
        event_type: eventType,
        event_date: combinedDate.toISOString(),
        notes: notes || null,
      });

      if (error) throw error;

      toast({
        title: "Händelse tillagd!",
        description: "Händelsen har sparats",
      });

      // Reset form to current date/time
      setEventType("");
      setEventDate(new Date());
      const resetNow = new Date();
      const resetHours = resetNow.getHours().toString().padStart(2, '0');
      const resetMinutes = resetNow.getMinutes().toString().padStart(2, '0');
      setEventTime(`${resetHours}:${resetMinutes}`);
      setNotes("");
      
      // Close dialog
      setOpen(false);
      
      onEventsChange();
    } catch (error) {
      console.error("Error adding event:", error);
      toast({
        title: "Fel",
        description: "Kunde inte spara händelsen",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    try {
      const { error } = await supabase
        .from("brew_events")
        .delete()
        .eq("id", eventId);

      if (error) throw error;

      toast({
        title: "Händelse borttagen",
        description: "Händelsen har tagits bort",
      });

      onEventsChange();
    } catch (error) {
      console.error("Error deleting event:", error);
      toast({
        title: "Fel",
        description: "Kunde inte ta bort händelsen",
        variant: "destructive",
      });
    }
  };

  const getEventTypeLabel = (type: string) => {
    const eventType = EVENT_TYPES.find((et) => et.value === type);
    return eventType ? eventType.label : type;
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" className="h-8 w-8">
          <Plus className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Händelser - {brewName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Add new event */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Lägg till händelse</h3>
            
            <div className="space-y-2">
              <Label htmlFor="event-type">Händelsetyp</Label>
              <Select value={eventType} onValueChange={setEventType}>
                <SelectTrigger id="event-type">
                  <SelectValue placeholder="Välj händelsetyp" />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Datum</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !eventDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {eventDate ? (
                        format(eventDate, "d MMM yyyy", { locale: sv })
                      ) : (
                        "Välj datum"
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={eventDate}
                      onSelect={setEventDate}
                      initialFocus
                      locale={sv}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label htmlFor="event-time">Tid</Label>
                <Input
                  id="event-time"
                  type="time"
                  value={eventTime}
                  onChange={(e) => setEventTime(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Anteckningar (valfritt)</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="T.ex. mängd humle, temperatur..."
                rows={2}
              />
            </div>

            <Button onClick={handleAddEvent} disabled={saving} className="w-full">
              {saving ? "Sparar..." : "Lägg till händelse"}
            </Button>
          </div>

          {/* List existing events */}
          {events.length > 0 && (
            <div className="space-y-2 border-t pt-4">
              <h3 className="text-sm font-medium">Befintliga händelser</h3>
              <div className="space-y-2">
                {events
                  .sort(
                    (a, b) =>
                      new Date(a.event_date).getTime() -
                      new Date(b.event_date).getTime()
                  )
                  .map((event) => (
                    <div
                      key={event.id}
                      className="flex items-start justify-between p-3 bg-muted/30 rounded-lg"
                    >
                      <div className="flex-1">
                        <div className="font-medium">
                          {getEventTypeLabel(event.event_type)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {format(
                            new Date(event.event_date),
                            "d MMM yyyy HH:mm",
                            { locale: sv }
                          )}
                        </div>
                        {event.notes && (
                          <div className="text-sm text-muted-foreground mt-1">
                            {event.notes}
                          </div>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleDeleteEvent(event.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
