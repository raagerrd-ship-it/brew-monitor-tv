---
name: Hold-drift mikro-aktuering
description: I hold-steg kicka mikro-duty (60% av ssFloor, eller 8% fallback) när temperaturdrift > 0.03°C/cykel mot fel sida för att förebygga 0%-till-hård-reaktion-pendel.
type: feature
---
I `pid-compensation.ts`: när `stepType==='hold'`, `|avgError| ≤ 0.15`, `needDrift > 0.03°C/cykel` (~15 min) och `need > -0.10`, sätt `integral = max(integral, ssFloor*0.60)` (eller 0.08 om floor okänt). Loggar `💧 hold-drift micro` med constraint `hold-drift-micro=Xm°/cyc`. Förhindrar att hold-fasen sitter på 0% duty medan ambient driver wort förbi target och tvingar fram en hård motreaktion.