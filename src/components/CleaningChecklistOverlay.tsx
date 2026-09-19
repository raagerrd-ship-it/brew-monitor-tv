import { memo } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  X, ShieldAlert, Droplets, Flame, CookingPot, ShowerHead, Sparkles,
  Wrench, RefreshCw, CheckCircle2, Boxes, FlaskConical,
} from 'lucide-react';
import { useCleaningChecklist, CleaningChecklistView } from '@/hooks/use-cleaning-checklist';

interface Section {
  num: string;
  title: string;
  hint?: string;
  items: string[];
  icon: LucideIcon;
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
      icon: Flame,
      hue: 25,
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
      icon: CookingPot,
      hue: 0,
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
      icon: ShowerHead,
      hue: 200,
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
      icon: Sparkles,
      hue: 150,
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
      icon: Wrench,
      hue: 25,
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
      icon: RefreshCw,
      hue: 200,
      items: [
        'Stäng avloppet, fyll 15–20 L 55 °C, lös Chemclean',
        'Cirkulera minst: fat 5 min · jäskärl 20 min',
        'Töm hon. Skölj kärl och delar',
      ],
    },
    {
      num: '03',
      title: 'Avsluta',
      icon: CheckCircle2,
      hue: 150,
      items: [
        'Kalk eller ölsten: gör avkalkningen nu',
        'Ny kall sats: Saniclean 3 min med delarna',
        'Skölj inte. Montera och stäng',
      ],
    },
    {
      num: '04',
      title: 'Flera kärl, förvaring & slitdelar',
      icon: Boxes,
      hue: 280,
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
        <div className="flex items-center gap-5 px-8 pt-6 pb-4">
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

        {/* Safety banner */}
        <div
          className="mx-8 flex items-start gap-3 rounded-2xl border px-5 py-3"
          style={{ borderColor: 'hsl(38 92% 60% / 0.35)', background: 'hsl(38 92% 55% / 0.1)' }}
        >
          <ShieldAlert className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-300" />
          <p className="text-base font-medium leading-snug text-amber-100/90">{data.warning}</p>
        </div>

        {/* Chemicals */}
        <div className="flex flex-wrap gap-3 px-8 pt-4">
          {data.chem.map(([name, dose]) => (
            <div
              key={name}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5"
            >
              <FlaskConical className="h-5 w-5 flex-shrink-0 text-primary/80" />
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">{name}</p>
                <p className="text-sm font-medium text-foreground/85">{dose}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Phases */}
        <div className="grid flex-1 grid-cols-1 gap-5 overflow-auto px-8 py-5 lg:grid-cols-2">
          {data.sections.map((s) => {
            const Icon = s.icon;
            const accent = `hsl(${s.hue} 80% 62%)`;
            return (
              <div
                key={s.num}
                className="relative overflow-hidden rounded-2xl border border-white/10 p-5"
                style={{
                  background: `linear-gradient(135deg, hsl(${s.hue} 60% 50% / 0.1), hsl(222 20% 12% / 0.7) 55%)`,
                }}
              >
                <span
                  className="absolute inset-y-0 left-0 w-1.5"
                  style={{ background: accent, opacity: 0.8 }}
                />
                <div className="mb-4 flex items-center gap-4 pl-2">
                  <div
                    className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border"
                    style={{ borderColor: `${accent}55`, background: `hsl(${s.hue} 70% 55% / 0.16)` }}
                  >
                    <Icon className="h-6 w-6" style={{ color: accent }} />
                  </div>
                  <div className="min-w-0">
                    <p
                      className="text-[11px] font-bold uppercase tracking-[0.25em]"
                      style={{ color: accent }}
                    >
                      Steg {s.num}
                    </p>
                    <h3 className="text-2xl font-bold leading-tight text-foreground">{s.title}</h3>
                    {s.hint && (
                      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{s.hint}</p>
                    )}
                  </div>
                </div>
                <ol className="space-y-2.5 pl-2">
                  {s.items.map((item, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-3 rounded-xl bg-white/[0.04] px-3 py-2 text-[15px] leading-snug text-foreground/90"
                    >
                      <span
                        className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold"
                        style={{ background: `hsl(${s.hue} 70% 55% / 0.2)`, color: accent }}
                      >
                        {i + 1}
                      </span>
                      {item}
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap gap-3 border-t border-white/10 px-8 py-4">
          {data.footer.map((f) => (
            <span
              key={f}
              className="flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-1.5 text-sm font-bold uppercase tracking-[0.12em] text-amber-300"
            >
              <ShieldAlert className="h-4 w-4" />
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
