import { memo } from 'react';
import { X, ShieldAlert, Droplets, FlaskConical } from 'lucide-react';
import { useCleaningChecklist, CleaningChecklistView } from '@/hooks/use-cleaning-checklist';

interface Group {
  label: string;
  /** overrides the card-level frequency for this sub-block */
  every?: boolean;
  freq?: string;
  items: string[];
}

interface Section {
  num: string;
  title: string;
  freq?: string;
  /** true = varje bryggdag, false = enstaka underhåll */
  every?: boolean;
  items?: string[];
  /** splits the phase into labelled sub-blocks, numbering continues across them */
  groups?: Group[];
  /** hue for the phase accent */
  hue: number;
}

const BREWHOUSE: { warning: string; chem: [string, string][]; sections: Section[]; footer: string[] } = {
  warning:
    'Glasögon och handskar på. Alltid kemin i vattnet. Aldrig lut och syra i samma kärl — kaustik aldrig på aluminium.',
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
      freq: 'Varje gång',
      every: true,
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
      freq: 'Varje gång',
      every: true,
      items: [
        'Pumpa över den heta lösningen',
        'Spola mäskkärlet med **10 L** → kokkärlet, nu **20 L**',
        'Tillsätt **1 dos** extra, värm tillbaka (inbränd: ny sats)',
        'Cirkulera **20–30 min** genom pump och kylare',
      ],
    },
    {
      num: '03',
      title: 'Skölj',
      hue: 200,
      freq: 'Varje gång',
      every: true,
      items: [
        'Töm smutsvattnet',
        'Skölj väggar och element med kranvatten',
        'Skölj pump, slangar och kylare till neutralt vatten',
        'Låt allt rinna av och torka',
      ],
    },
    {
      num: '04',
      title: 'Avkalkning & sanitering',
      hue: 150,
      groups: [
        {
          label: 'Avkalkning',
          every: false,
          freq: 'Vid behov',
          items: [
            'Citronsyra på ren utrustning, **200 ml per 10 L**',
            'Cirkulera **15–20 min**, ca **65 °C** — tar ölsten',
            'Skölj bort syran',
          ],
        },
        {
          label: 'Sanitering',
          every: true,
          freq: 'Varje gång',
          items: [
            'Saniclean sist: **25 ml per 10 L**, kallt',
            'Cirkulera **5 min**, låt kylaren rinna tom',
          ],
        },
      ],
    },
  ],
  footer: ['Ingen eftersköljning'],
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
      freq: 'Varje kärl',
      every: true,
      items: [
        'Skölj ur alla kärl direkt efter tömning',
        'Plocka isär: lock, PRV, poppets, O-ringar, slang',
        'Pumpen och smådelarna i hon',
        'Flera kärl: renast först, fat före jäskärl',
      ],
    },
    {
      num: '02',
      title: 'Cirkulera & skölj',
      hue: 200,
      freq: 'Varje gång',
      every: true,
      items: [
        'Stäng avloppet, fyll **15–20 L**, **55 °C**, Chemclean',
        'Cirkulera minst: fat **5 min** · jäskärl **20 min**',
        'Töm hon. Skölj kärl och delar',
        'Byt lösning: efter **3–4 kärl**, grumlig eller **<40 °C**',
      ],
    },
    {
      num: '03',
      title: 'Sanitera & förvara',
      hue: 150,
      freq: 'Varje gång',
      every: true,
      items: [
        'Kalk eller ölsten: gör avkalkningen nu',
        'Ny kall sats: Saniclean **3 min** med delarna',
        'Skölj inte. Montera och stäng',
        'Förvaring: Star San + **CO₂**-tryck i fatet, låt stå',
      ],
    },
    {
      num: '04',
      title: 'Underhåll',
      hue: 280,
      freq: 'Var 5:e körning',
      every: false,
      groups: [
        {
          label: 'Avkalkning',
          items: [
            'Citronsyra **200 ml per 10 L**',
            'Värm till **50 °C**, cirkulera **15 min**',
            'Tung kalk: **dubbel dos**, **30 min**',
          ],
        },
        {
          label: 'Slitdelar',
          items: [
            'Kolla O-ringar, packningar, PRV, spundingsäte',
            'Byt hårda, spruckna eller ölluktande delar',
          ],
        },
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
      className="fixed inset-0 z-[60] flex items-center justify-center p-2"
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
        <div className="flex flex-shrink-0 items-center gap-3 px-6 pb-1 pt-2.5">
          <div
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-primary/30"
            style={{ background: 'hsl(var(--primary) / 0.15)' }}
          >
            <Droplets className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[21px] font-bold leading-none tracking-tight text-foreground">
              {title}
              <span className="ml-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Dosering per 10 L vatten
              </span>
            </h2>
          </div>
          <button
            onClick={() => setChecklist(null)}
            className="flex-shrink-0 rounded-lg border border-white/15 p-1.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
            aria-label="Stäng checklista"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Chemicals */}
        <div className="flex flex-shrink-0 flex-wrap items-baseline gap-x-5 gap-y-0 px-6">
          {data.chem.map(([name, dose]) => (
            <p key={name} className="flex items-baseline gap-1.5 text-[14px] text-foreground/85">
              <FlaskConical className="h-3 w-3 flex-shrink-0 self-center text-primary/80" />
              <span className="font-bold uppercase tracking-wide text-primary">{name}</span>
              <span>{dose}</span>
            </p>
          ))}
        </div>

        {/* Phases */}
        <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-3 overflow-hidden px-6 py-2.5">
          {data.sections.map((s) => {
            const accent = `hsl(${s.hue} 90% 68%)`;
            const rows: Array<
              | { kind: 'label'; label: string; every?: boolean; freq?: string }
              | { kind: 'item'; text: string }
            > = s.groups
              ? s.groups.flatMap((g) => [
                  { kind: 'label' as const, label: g.label, every: g.every, freq: g.freq },
                  ...g.items.map((text) => ({ kind: 'item' as const, text })),
                ])
              : (s.items ?? []).map((text) => ({ kind: 'item' as const, text }));
            return (
              <div
                key={s.num}
                className="relative flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 p-3"
                style={{
                  background: `linear-gradient(135deg, hsl(${s.hue} 60% 50% / 0.16), hsl(222 20% 12% / 0.7) 55%)`,
                }}
              >
                <span
                  className="absolute inset-y-0 left-0 w-1"
                  style={{ background: accent, opacity: 0.8 }}
                />
                <div className="mb-1 flex flex-shrink-0 items-baseline gap-3 pl-2">
                  <h3 className="text-[20px] font-bold leading-tight text-foreground">
                    <span className="tabular-nums" style={{ color: accent }}>{s.num}</span> {s.title}
                  </h3>
                  {s.freq && (
                    <p
                      className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em]"
                      style={{ color: s.every ? 'hsl(150 65% 62%)' : 'hsl(38 95% 66%)' }}
                    >
                      <span
                        className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
                        style={{ background: s.every ? 'hsl(150 70% 55%)' : 'hsl(38 95% 60%)' }}
                      />
                      {s.freq}
                    </p>
                  )}
                </div>
                <ol className="flex min-h-0 flex-1 flex-col justify-evenly pl-2">
                  {rows.map((row, i) =>
                    row.kind === 'label' ? (
                      <li
                        key={`g${i}`}
                        className={`flex items-baseline gap-2 text-[13px] ${i > 0 ? 'mt-1 border-t border-white/10 pt-1' : ''}`}
                      >
                        <span className="font-bold uppercase tracking-[0.18em]" style={{ color: accent }}>
                          {row.label}
                        </span>
                        {row.freq && (
                          <span
                            className="flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em]"
                            style={{ color: row.every ? 'hsl(150 65% 62%)' : 'hsl(38 95% 66%)' }}
                          >
                            <span
                              className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
                              style={{ background: row.every ? 'hsl(150 70% 55%)' : 'hsl(38 95% 60%)' }}
                            />
                            {row.freq}
                          </span>
                        )}
                      </li>
                    ) : (
                      <li
                        key={i}
                        className="flex items-baseline gap-2.5 text-[22px] leading-tight text-foreground"
                      >
                        <span className="flex-shrink-0 font-bold tabular-nums" style={{ color: accent }}>
                          {rows.slice(0, i).filter((r) => r.kind === 'item').length + 1}.
                        </span>
                        <span>{highlightItem(row.text, accent)}</span>
                      </li>
                    ),
                  )}
                </ol>
              </div>
            );
          })}
        </div>

        {/* Footer — one warning line */}
        <div className="flex flex-shrink-0 items-center gap-2.5 border-t border-white/10 px-6 py-1.5">
          <ShieldAlert className="h-4 w-4 flex-shrink-0 text-amber-300" />
          <p className="whitespace-nowrap text-[14px] font-medium text-amber-100/90">
            {data.warning}{' '}
            <span className="font-bold uppercase tracking-wide text-amber-300">{data.footer.join(' · ')}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

export const CleaningChecklistOverlay = memo(CleaningChecklistOverlayComponent);
export type { CleaningChecklistView };
