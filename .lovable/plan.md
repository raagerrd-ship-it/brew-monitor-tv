

## Gruppera profilloggar per controller i beslutsloggen

Idag loggas profil-relaterade beslut (PROFILE_TARGET, PROFILE_OWNED, COOLOFF, ORIGINAL_TARGET) som separata rader med controller-ID, utspridda i loggfloden. Med flera controllers blir det svart att se vilken info som hor till vilken.

### Andring

**Fil: `supabase/functions/auto-adjust-cooling/index.ts`** (rad 250-326)

Istallet for att logga PROFILE_TARGET, PROFILE_OWNED, COOLOFF och ORIGINAL_TARGET som separata rader, samla all profilinfo per controller i EN loggpost per controller:

**Fran (4 separata rader per controller):**
```
PROFILE_TARGET: Controller abc123: profil-mal=14degC (steg 2)
PROFILE_OWNED: Controller abc123 har aktiv fermenteringsprofil...
COOLOFF: Controller abc123 i 30-min cooloff...
ORIGINAL_TARGET: Skipping originalTargetMap for profile-owned controller: Svart
```

**Till (1 samlad rad per controller):**
```
PROFILE_STATUS: Svart (abc123): profil-mal=14degC, steg 2, cooloff=ja, stall=skippad, overshoot=tillats
```

Konkret:
1. Samla profil-info i en temporar map (`controllerId -> { name, profileTarget, stepIndex, hasCooloff, isProfileOwned }`) under sessionsloopen
2. Gor cooloff-kontrollen i samma loop (den itererar redan over sessions)
3. Logga originalTarget-skip som del av samma sammanslagning
4. Efter hela loopen: logga EN `PROFILE_STATUS`-rad per controller med all relevant info

Rad ~257-305: Flytta ihop sessionsloopen sa att profil-target-uppslag, PROFILE_OWNED-flagga, och cooloff-kontroll hamnar i samma iteration. Lagra resultaten i en map.

Rad ~308-326: originalTargetMap-loopen behalls men loggen `ORIGINAL_TARGET` skrivs inte langre separat -- den inkluderas i sammanfattningsraden.

Ny loggning efter rad 306 (efter looparna ar klara):
```typescript
// Log one consolidated line per profile-owned controller
for (const [cId, info] of profileStatusMap) {
  const controllerName = followedControllersFullData.find(c => c.controller_id === cId)?.name ?? cId;
  const parts = [`profil-mal=${info.profileTarget}degC`, `steg ${info.stepIndex}`];
  if (info.hasCooloff) parts.push('cooloff=ja');
  parts.push('stall=skippad', 'overshoot=tillats');
  log('PROFILE_STATUS', 'info', `${controllerName}: ${parts.join(', ')}`);
}
```

**Fil: `src/components/AutoCoolingDecisionLogs.tsx`** (rad 446-464, besluts-visning)

Ingen andring behovs i UI-koden -- den visar redan `decision.step` och `decision.message` rakt av. Den nya `PROFILE_STATUS`-steg-taggen renderas automatiskt som en rad i beslutsloggen. Men loggen blir mycket mer lasbar tack vare farre rader per controller.

### Resultat

- Varje controller med aktiv profil far EN tydlig sammanfattningsrad istallet for 3-4 spridda rader
- Controller-namn (inte bara ID) anvands i meddelandet
- All relevant info (mal, steg, cooloff-status, vad som skippas) samlas pa ett stalle

