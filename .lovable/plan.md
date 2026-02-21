

# Optimera sekventiella DB-fragor i auto-adjust-cooling och process-fermentation-profiles

## Oversikt

Bada edge functions gor flera databasfragor inne i for-loopar (en per controller/session). Genom att batcha dessa till en eller tva fragor FORE loopen minskar vi antalet databas-roundtrips avsevart.

## auto-adjust-cooling/index.ts

### A. Batch cooloff-check (rad 252-265)

**Nu:** For varje session gors en separat fraga till `fermentation_step_log` for att kolla om profilen justerat temp senaste 30 min.

**Fix:** En enda fraga som hamtar alla `temp_adjusted`-loggar for alla session-IDs de senaste 30 min, sedan bygg cooloffSet fran resultatet i minnet.

### B. Batch profilsteg (rad 273-289)

**Nu:** For varje session gors en separat fraga till `fermentation_profile_steps` per `profile_id`.

**Fix:** Samla alla unika `profile_id` fran running sessions, gor EN fraga med `.in('profile_id', uniqueProfileIds)`, och gruppera stegen per profile_id i en Map.

### C. Batch overshoot cooldown (rad 587-602)

**Nu:** For varje controller i overshoot-loopen gors en separat fraga till `auto_cooling_adjustments` for att kolla 10-min cooldown.

**Fix:** Fore loopen, gor EN fraga som hamtar senaste overshoot-justering per controller (filtrerad pa `reason LIKE '...'` och alla followedControllerIds). Bygg en Map med senaste created_at per controller.

### D. Batch delta-historik (rad 937-942)

**Nu:** I delta-analysloopen gors en fraga per controller till `temp_delta_history`.

**Fix:** En fraga fore loopen: hamta de 5 senaste delta-posterna for ALLA followed controllers. Gruppera per controller_id i minnet. Alternativt: hamma senaste N per controller via en enda `.in()` med `.order().limit()` -- har begransas vi av Supabase (limit galler totalt, inte per grupp). Darfor hamtar vi alla senaste N timmar istallet och filtrerar i minnet.

### E. Batch existerande delta-alerts (rad 964-969)

**Nu:** Per controller kollas om det redan finns en ej kvitterad alert.

**Fix:** En fraga fore loopen: hamta alla okvitterade alerts for alla followed controllers. Bygg en Set med controller_ids som redan har alert.

## process-fermentation-profiles/index.ts

### F. Batch profilsteg (rad 119-123)

**Nu:** For varje session hamtas profil-stegen separat.

**Fix:** Samla unika profile_ids fran alla sessions, gor EN fraga, och gruppera i en Map.

### G. Batch controller-data (rad 151-155)

**Nu:** For varje session hamtas controller-data separat.

**Fix:** Samla alla unika controller_ids, gor EN fraga med `.in('controller_id', ids)`, bygg en Map.

### H. Batch pill-komp senaste justering (rad 160-166)

**Nu:** For varje session kollas senaste pill-komp-justering separat.

**Fix:** Gor EN fraga med `.in('cooler_controller_id', allControllerIds).like('reason', '...')`, hamta senaste per controller, bygg Map.

### I. Batch brew-data (rad 177-182)

**Nu:** For varje session med brew_id hamtas brew_readings separat.

**Fix:** Samla alla icke-null brew_ids, gor EN fraga med `.in('id', brewIds).select('id, sg_data')`, bygg Map.

## Teknisk sammanfattning

### auto-adjust-cooling/index.ts

5 optimeringar (A-E) som ersatter ca 5 * N sekventiella fragor med 5 batchade fragor (dar N ar antal controllers/sessions).

Ovrig looplogik (villkor, berakningar, API-anrop till RAPT) paverkas inte -- bara DB-reads batchas.

### process-fermentation-profiles/index.ts

4 optimeringar (F-I) som ersatter ca 4 * N sekventiella fragor med 4 batchade fragor fore session-loopen.

### Risker

- Batchade fragor returnerar ALLA rader for ALLA controllers/sessions, vilket kan vara mer data an nodvandigt om de flesta sessions inte behovde just den datan. Men med typiskt 1-5 aktiva sessions/controllers ar detta forsumbart.
- `temp_delta_history` saknar `.limit()` per grupp i batch-mode. Losningen ar att hamta senaste 24h och ta de 5 senaste per controller i minnet.

### Testning

- Deploya bada edge functions
- Kor run-automation och verifiera att loggarna visar samma resultat som fore
- Jamfor exekveringstid i `auto_cooling_decision_logs.duration_ms`

