import { memo } from 'react';
import { X, ShieldAlert, Droplets } from 'lucide-react';
import { useCleaningChecklist, CleaningChecklistView } from '@/hooks/use-cleaning-checklist';

interface Section {
  num: string;
  title: string;
  hint?: string;
  items: string[];
}

const BREWHOUSE: { warning: string; chem: [string, string][]; sections: Section[]; footer: string[] } = {
  warning:
    'Glasögon och handskar på. Alltid kemin i vattnet — aldrig tvärtom. Aldrig lut och syra i samma kärl. Kaustiksoda aldrig på aluminium.',
  chem: [
    ['Kaustiksoda', '100 g · 60–70 °C · endast rostfritt'],
    ['Chemipro CIP', '25–40 ml · 60–70 °C · skummar inte'],
    ['Chemclean', '50 g · max 55 °C · löddrar i pumpen'],
  ],
  sections: [
    {
      num: '01',
      title: 'Mäskkärl',
      hint: 'CIP – samma vatten hela vägen',
      items: [
        'Fyll 10 L vatten — täck elementet helt',
        'Värm till rätt temp, stäng sedan av värmen',
        'Tillsätt vald kemi — 1 dos',
        'Cirkulera minst 20 min',
      ],
    },
    {
      num: '02',
      title: 'Kokkärl',
      items: [
        'Pumpa över den heta lösningen',
        'Spola mäskkärlet med 10 L vatten → kokkärlet, nu 20 L',
        'Tillsätt 1 dos extra kemi, värm tillbaka (inbränd trub: kör egen fräsch sats)',
        'Cirkulera 20–30 min genom pump och kylare',
      ],
    },
    {
      num: '03',
      title: 'Skölj',
      items: [
        'Töm smutsvattnet',
        'Skölj väggar och element med kranvatten',
        'Skölj pump, slangar, kylare tills sköljvattnet är neutralt',
        'Låt utrustningen rinna av och torka',
      ],
    },
    {
      num: '04',
      title: 'Avkalkning & sanitering',
      items: [
        'Citronsyra efter CIP på ren utrustning: 200 ml per 10 L · 60–70 °C',
        'Cirkulera 15–20 min, skölj bort syran (tar ölsten även i mjukt vatten)',
        'Saniclean sist, bara på ren sköljd utrustning: 25–30 ml per 10 L · kallt',
        'Cirkulera 5 min genom pump och kylare — ingen eftersköljning, låt kylaren rinna tom',
      ],
    },
  ],
  footer: ['Kemin i vattnet', 'Ingen eftersköljning'],
};

const VESSELS: { warning: string; chem: [string, string][]; sections: Section[]; footer: string[] } = {
  warning:
    'Aldrig kaustiksoda eller Chemipro CIP på plast — ger sprickor. Max 55 °C. Inga borstar inuti.',
  chem: [
    ['Chemclean', '25 g · 55 °C'],
    ['Citronsyra', '200 ml · 50 °C'],
    ['Saniclean', '25–30 ml · pump'],
    ['Star San', '15 ml · fat'],
  ],
  sections: [
    {
      num: '01',
      title: 'Förbered',
      hint: 'Varje kärl, varje gång',
      items: [
        'Skölj ur alla kärl direkt efter tömning',
        'Plocka isär allt — kulkopplingar med poppets, O-ringar, lock, PRV',
        'Pumpen och smådelarna i hon',
      ],
    },
    {
      num: '02',
      title: 'Cirkulera',
      items: [
        'Stäng avloppet, fyll 15–20 L 55 °C, lös Chemclean',
        'Cirkulera minst: fat 5 min · jäskärl 20 min',
        'Töm hon. Skölj kärl och delar',
      ],
    },
    {
      num: '03',
      title: 'Avsluta',
      items: [
        'Kalk eller ölsten: gör avkalkningen nu',
        'Ny kall sats: Saniclean 3 min med delarna',
        'Skölj inte. Montera och stäng',
      ],
    },
    {
      num: '04',
      title: 'Flera kärl, förvaring & slitdelar',
      items: [
        'Renast först: fat före jäskärl, mest jästkaka sist',
        'Byt lösning när den är grumlig eller under 40 °C — efter 3–4 kärl',
        'Fat till förvaring: fyll helt med Star San, tryck vidare med CO₂, lämna trycket kvar',
        'Var 5:e körning: 200 ml citronsyra per 10 L, 50 °C, cirkulera 15 min (tung kalk: dubbel dos, 30 min)',
        'Kolla O-ringar, packningar, PRV, spundingsäte — hårda eller ölluktande byts',
      ],
    },
  ],
  footer: ['Ingen kaustik på plast', 'Ingen eftersköljning'],
};

function CleaningChecklistOverlayComponent() {
  const { view, setChecklist } = useCleaningChecklist();
  if (!view) return null;

  const data = view === 'brewhouse' ? BREWHOUSE : VESSELS;
  const title = view === 'brewhouse' ? 'Bryggverksrengöring' : 'Fat- och jäskärlsrengöring';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'hsl(222 30% 4% / 0.82)', backdropFilter: 'blur(14px)' }}
    >
      <div
        className="relative flex h-full w-full max-w-[1500px] flex-col overflow-hidden rounded-2xl border border-white/15"
        style={{
          background: 'hsl(222 18% 13% / 0.92)',
          boxShadow: '0 20px 60px hsl(222 30% 2% / 0.7)',
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
              <Droplets className="h-6 w-6 text-primary" />
              {title}
            </h2>
            <p className="mt-2 flex items-start gap-2 text-sm font-medium text-amber-300/90">
              <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
              {data.warning}
            </p>
          </div>
          <button
            onClick={() => setChecklist(null)}
            className="flex-shrink-0 rounded-md border border-white/15 p-2 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
            aria-label="Stäng checklista"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Chemicals */}
        <div className="flex flex-wrap gap-2 border-b border-white/10 px-6 py-3">
          {data.chem.map(([name, dose]) => (
            <div
              key={name}
              className="rounded-lg border border-primary/25 bg-primary/10 px-3 py-1.5"
            >
              <p className="text-[11px] font-bold uppercase tracking-wider text-primary">{name}</p>
              <p className="text-sm text-foreground/85">{dose}</p>
            </div>
          ))}
          <p className="ml-auto self-center text-[11px] uppercase tracking-wider text-muted-foreground">
            Dosering per 10 L vatten
          </p>
        </div>

        {/* Sections */}
        <div className="grid flex-1 grid-cols-1 gap-4 overflow-auto px-6 py-4 md:grid-cols-2 xl:grid-cols-4">
          {data.sections.map((s) => (
            <div key={s.num} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="mb-3 flex items-baseline gap-2">
                <span className="text-xs font-bold text-primary/70">{s.num}</span>
                <h3 className="text-lg font-semibold text-foreground">{s.title}</h3>
              </div>
              {s.hint && (
                <p className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">{s.hint}</p>
              )}
              <ol className="space-y-2">
                {s.items.map((item, i) => (
                  <li key={i} className="flex gap-2 text-sm leading-snug text-foreground/90">
                    <span className="mt-[3px] flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border border-white/25 text-[10px] text-muted-foreground">
                      {i + 1}
                    </span>
                    {item}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap gap-3 border-t border-white/10 px-6 py-3">
          {data.footer.map((f) => (
            <span
              key={f}
              className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-300"
            >
              {f}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export const CleaningChecklistOverlay = memo(CleaningChecklistOverlayComponent);
export type { CleaningChecklistView };
