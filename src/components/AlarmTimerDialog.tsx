import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAlarmTimer } from '@/contexts/AlarmTimerContext';
import { Timer, AlarmClock, X } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AlarmTimerDialog({ open, onOpenChange }: Props) {
  const { entry, startTimer, setAlarm, cancel } = useAlarmTimer();

  // Timer state
  const [timerMinutes, setTimerMinutes] = useState(15);
  const [timerAlertText, setTimerAlertText] = useState('Tiden är ute!');
  const [timerAlertDuration, setTimerAlertDuration] = useState(10);

  // Alarm state
  const [alarmTime, setAlarmTime] = useState('');
  const [alarmAlertText, setAlarmAlertText] = useState('Alarm!');
  const [alarmAlertDuration, setAlarmAlertDuration] = useState(10);

  const handleStartTimer = () => {
    if (timerMinutes <= 0) return;
    startTimer(timerMinutes, timerAlertText, timerAlertDuration);
    onOpenChange(false);
  };

  const handleSetAlarm = () => {
    if (!alarmTime) return;
    setAlarm(alarmTime, alarmAlertText, alarmAlertDuration);
    onOpenChange(false);
  };

  const handleCancel = () => {
    cancel();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Timer className="w-5 h-5 text-primary" />
            Timer & Alarm
          </DialogTitle>
        </DialogHeader>

        {/* Show active entry */}
        {entry && !entry.fired && (
          <div className="flex items-center justify-between p-3 rounded-lg bg-primary/10 border border-primary/20 mb-2">
            <div className="flex items-center gap-2 text-sm">
              {entry.type === 'timer' ? <Timer className="w-4 h-4 text-primary" /> : <AlarmClock className="w-4 h-4 text-primary" />}
              <span className="font-medium">{entry.label}</span>
            </div>
            <Button variant="ghost" size="icon" onClick={handleCancel} className="w-7 h-7">
              <X className="w-4 h-4" />
            </Button>
          </div>
        )}

        <Tabs defaultValue="timer" className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="timer" className="flex-1 gap-1.5">
              <Timer className="w-4 h-4" /> Timer
            </TabsTrigger>
            <TabsTrigger value="alarm" className="flex-1 gap-1.5">
              <AlarmClock className="w-4 h-4" /> Alarm
            </TabsTrigger>
          </TabsList>

          <TabsContent value="timer" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="timer-min">Minuter</Label>
              <Input
                id="timer-min"
                type="number"
                min={1}
                max={999}
                value={timerMinutes}
                onChange={e => setTimerMinutes(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="timer-text">Alert-text</Label>
              <Input
                id="timer-text"
                value={timerAlertText}
                onChange={e => setTimerAlertText(e.target.value)}
                placeholder="Tiden är ute!"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="timer-dur">Visa alert i (sekunder)</Label>
              <Input
                id="timer-dur"
                type="number"
                min={3}
                max={300}
                value={timerAlertDuration}
                onChange={e => setTimerAlertDuration(Number(e.target.value))}
              />
            </div>
            <Button onClick={handleStartTimer} className="w-full" disabled={timerMinutes <= 0 || !!entry}>
              Starta timer
            </Button>
          </TabsContent>

          <TabsContent value="alarm" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="alarm-time">Tidpunkt</Label>
              <Input
                id="alarm-time"
                type="time"
                value={alarmTime}
                onChange={e => setAlarmTime(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="alarm-text">Alert-text</Label>
              <Input
                id="alarm-text"
                value={alarmAlertText}
                onChange={e => setAlarmAlertText(e.target.value)}
                placeholder="Alarm!"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="alarm-dur">Visa alert i (sekunder)</Label>
              <Input
                id="alarm-dur"
                type="number"
                min={3}
                max={300}
                value={alarmAlertDuration}
                onChange={e => setAlarmAlertDuration(Number(e.target.value))}
              />
            </div>
            <Button onClick={handleSetAlarm} className="w-full" disabled={!alarmTime || !!entry}>
              Sätt alarm
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
