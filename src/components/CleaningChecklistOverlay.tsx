import { memo } from 'react';
import { X, ShieldAlert, Droplets, FlaskConical } from 'lucide-react';
import { useCleaningChecklist, CleaningChecklistView } from '@/hooks/use-cleaning-checklist';

interface Section {
  num: string;
  title: string;
  hint?: string;
  items: string[];
  /** hue for the phase accent */
  hue: number;
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
      hue: 25,
      hint: 'CIP – samma vatten hela vägen',
      items: [
        'Fyll **10 L** vatten — täck elementet helt',
        'Värm till rätt temp, stäng sedan av värmen',
        'Tillsätt vald kemi — **1 dos**',
        'Cirkulera minst **20 min**',
      ],
    },
    {
      num: '02',
      title: 'Kokkärl',
      hue: 0,
      items: [
        'Pumpa över den heta lösningen',
        'Spola mäskkärlet med **10 L** → kokkärlet, nu **20 L**',
        'Tillsätt **1 dos** extra kemi, värm tillbaka (inbränd trub: egen fräsch sats)',
        'Cirkulera **20–30 min** genom pump och kylare',
      ],
    },
    {
      num: '03',
      title: 'Skölj',
      hue: 200,
      items: [
        'Töm smutsvattnet',
        'Skölj väggar och element med kranvatten',
        'Skölj pump, slangar och kylare tills vattnet är neutralt',
        'Låt allt rinna av och torka',
      ],
    },
    {
      num: '04',
      title: 'Avkalkning & sanitering',
      hue: 150,
      items: [
        'Citronsyra på ren utrustning: **200 ml per 10 L**, ca **65 °C**',
        'Cirkulera **15–20 min**, skölj bort syran (tar ölsten)',
        'Saniclean sist: **25 ml per 10 L**, kallt',
        'Cirkulera **5 min** — ingen eftersköljning, låt kylaren rinna tom',
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
      title: 'Förbered & demontera',
      hue: 25,
      hint: 'Varje kärl, varje gång',
      items: [
        'Skölj ur alla kärl direkt efter tömning',
        'Plocka isär allt — kulkopplingar med poppets, O-ringar, lock, PRV',
        'Pumpen och smådelarna i hon',
        'Flera kärl: renast först, fat före jäskärl',
      ],
    },
    {
      num: '02',
      title: 'Cirkulera & skölj',
      hue: 200,
      items: [
        'Stäng avloppet, fyll **15–20 L**, **55 °C**, lös Chemclean',
        'Cirkulera minst: fat **5 min** · jäskärl **20 min**',
        'Töm hon. Skölj kärl och delar',
        'Byt lösning om grumlig eller under **40 °C** — efter **3–4 kärl**',
      ],
    },
    {
      num: '03',
      title: 'Sanitera & förvara',
      hue: 150,
      items: [
        'Kalk eller ölsten: gör avkalkningen nu',
        'Ny kall sats: Saniclean **3 min** med delarna',
        'Skölj inte. Montera och stäng',
        'Förvaring: fyll fatet med Star San, tryck vidare med **CO₂**, lämna trycket kvar',
      ],
    },
    {
      num: '04',
      title: 'Underhåll',
      hue: 280,
      hint: 'Inte varje gång',
      items: [
        'Var 5:e körning: **200 ml citronsyra per 10 L**, **50 °C**, **15 min** (tung kalk: dubbel dos, **30 min**)',
        'Kolla O-ringar, packningar, PRV, spundingsäte — hårda eller ölluktande byts',
      ],
    },
  ],
  footer: ['Ingen kaustik på plast', 'Ingen eftersköljning'],
};

/** Renders **highlighted** segments (volumes, temps, doses) in the phase accent color. */
function highlightItem(text: string, accent: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-bold" style={{ color: accent }}>
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function CleaningChecklistOverlayComponent() {
  const { view, setChecklist } = useCleaningChecklist();
  if (!view) return null;

  const data = view === 'brewhouse' ? BREWHOUSE : VESSELS;
  const title = view === 'brewhouse' ? 'Bryggverksrengöring' : 'Fat- och jäskärlsrengöring';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-3"
      style={{ background: 'hsl(222 30% 3% / 0.88)', backdropFilter: 'blur(16px)' }}
    >
      <div
        className="relative flex h-full w-full max-w-[1800px] flex-col overflow-hidden rounded-3xl border border-white/10"
        style={{
          background:
            'radial-gradient(120% 90% at 10% 0%, hsl(200 40% 18% / 0.55), transparent 60%), hsl(222 20% 9% / 0.95)',
          boxShadow: '0 30px 90px hsl(222 30% 2% / 0.8)',
        }}
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center gap-4 px-8 pt-5 pb-3">
          <div
            className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl border border-primary/30"
            style={{ background: 'hsl(var(--primary) / 0.15)' }}
          >
            <Droplets className="h-7 w-7 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-3xl font-bold tracking-tight text-foreground">{title}</h2>
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Dosering per 10 L vatten
            </p>
          </div>
          <button
            onClick={() => setChecklist(null)}
            className="flex-shrink-0 rounded-xl border border-white/15 p-2.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
            aria-label="Stäng checklista"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Chemicals */}
        <div className="flex flex-shrink-0 flex-wrap items-baseline gap-x-6 gap-y-1 px-8 pt-1">
          {data.chem.map(([name, dose]) => (
            <p key={name} className="flex items-baseline gap-2 text-foreground/85" style={{ fontSize: 'clamp(14px, 1.1vw, 20px)' }}>
              <FlaskConical className="h-4 w-4 flex-shrink-0 self-center text-primary/80" />
              <span className="font-bold uppercase tracking-wide text-primary">{name}</span>
              <span>{dose}</span>
            </p>
          ))}
        </div>

        {/* Phases */}
        <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-4 overflow-hidden px-8 py-4">
          {data.sections.map((s) => {
            const accent = `hsl(${s.hue} 90% 68%)`;
            return (
              <div
                key={s.num}
                className="relative flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 p-4"
                style={{
                  background: `linear-gradient(135deg, hsl(${s.hue} 60% 50% / 0.16), hsl(222 20% 12% / 0.7) 55%)`,
                }}
              >
                <span
                  className="absolute inset-y-0 left-0 w-1.5"
                  style={{ background: accent, opacity: 0.8 }}
                />
                <div className="mb-2 flex flex-shrink-0 items-baseline gap-3 pl-2">
                  <h3 className="font-bold leading-tight text-foreground" style={{ fontSize: 'clamp(18px, 1.6vw, 30px)' }}>
                    <span className="tabular-nums" style={{ color: accent }}>{s.num}</span> {s.title}
                  </h3>
                  {s.hint && (
                    <p className="text-sm uppercase tracking-[0.16em] text-muted-foreground">{s.hint}</p>
                  )}
                </div>
                <ol className="flex min-h-0 flex-1 flex-col justify-evenly pl-2">
                  {s.items.map((item, i) => (
                    <li
                      key={i}
                      className="flex items-baseline gap-3 leading-snug text-foreground"
                      style={{ fontSize: 'clamp(15px, 1.35vw, 24px)' }}
                    >
                      <span className="flex-shrink-0 font-bold tabular-nums" style={{ color: accent }}>
                        {i + 1}.
                      </span>
                      <span>{highlightItem(item, accent)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </div>

        {/* Footer — one warning line */}
        <div className="flex flex-shrink-0 items-center gap-3 border-t border-white/10 px-8 py-2.5">
          <ShieldAlert className="h-5 w-5 flex-shrink-0 text-amber-300" />
          <p className="whitespace-nowrap text-sm font-medium text-amber-100/90" style={{ fontSize: 'clamp(12px, 0.95vw, 17px)' }}>
            {data.warning} <span className="font-bold uppercase tracking-wide text-amber-300">{data.footer.join(' · ')}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

export const CleaningChecklistOverlay = memo(CleaningChecklistOverlayComponent);
export type { CleaningChecklistView };
