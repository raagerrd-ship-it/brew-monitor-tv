
## Trimma etikettbilden vid sparning

### Problem
Canvasen renderar etiketten med 24px padding runt om. Nar bilden importeras i PrintMaster (Phomemo-appen) laggs ytterligare marginaler till, vilket ger for mycket vitt runt etiketten.

### Losning
Trimma bort vita pixlar fran canvasens kanter innan bilden sparas. Detta gors genom att skanna bildens pixeldata och hitta den faktiska "bounding box" for innehallet (allt som inte ar vitt).

### Tekniska detaljer

**`src/components/PrintLabelDialog.tsx`** - Uppdatera `handleDownload`:

1. Lasa canvasens pixeldata med `getImageData`
2. Skanna rad for rad och kolumn for kolumn for att hitta forsta/sista icke-vita pixeln i varje riktning
3. Skapa en ny trimmed canvas med bara det omrandet
4. Exportera den trimmade canvasen som PNG

Implementationen blir en hjalp-funktion `trimCanvas(canvas)` som returnerar en ny canvas utan vita marginaler. En liten marginal pa ca 4px kan behalles for att undvika att innehall klipps.

### Paverkan
- Bara `handleDownload` i `PrintLabelDialog.tsx` andras
- Sjalva label-renderingen (LabelCanvas.tsx) forblir oforandrad sa forhandsvisningen ser likadan ut
- BLE-utskrift anvander fortfarande den otrimmade canvasen (dar marginalerna behovs)
