

## Justera Bakgrundsoskärpa-sliderns intervall

Ändra max-värdet på blur-slidern från 100 till 25 i `src/components/sonos/SonosSettings.tsx`.

### Ändring

**`src/components/sonos/SonosSettings.tsx`** (rad ~236-237)

- Ändra `max={100}` till `max={25}`
- Ändra `step={5}` till `step={1}` för finare kontroll i det mindre intervallet

