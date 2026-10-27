import { CalendarCheck, Check, FlaskConical, LineChart, Lock, ScanFace, ShieldCheck, Trash2, Waypoints } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Contour, Logo } from '../components/charts/Contour'

const LOOP = [
  {
    key: 'Analyze',
    icon: ScanFace,
    title: 'Analyze',
    body: 'Upload a front-facing photo. The YouCam Skin AI API returns scores for concerns like texture, pores, redness and moisture. We show exactly what the API returned — nothing added.',
  },
  {
    key: 'Understand',
    icon: FlaskConical,
    title: 'Understand',
    body: 'Each score is explained on its real scale: 1 to 100, higher is more favourable. Ingredient checks explain why a combination is flagged, where the guidance comes from, and what it can’t know.',
  },
  {
    key: 'Track',
    icon: LineChart,
    title: 'Track',
    body: 'Later scans, check-ins and every routine change land on one timeline, so you can see what happened in what order.',
  },
  {
    key: 'Review',
    icon: Waypoints,
    title: 'Review',
    body: 'Compare any two scans taken the same way. Small movements are labelled as “no clear change” rather than dressed up as progress.',
  },
  {
    key: 'Adapt',
    icon: CalendarCheck,
    title: 'Adapt',
    body: 'Rule-based guidance connects your symptoms, your routine and your scans. Sometimes it suggests pausing a product. Often it suggests buying nothing.',
  },
]

function HeroPreview() {
  const scans = [
    { x: 40, y: 92, label: '2 Oct' },
    { x: 140, y: 84, label: '10 Oct' },
    { x: 240, y: 70, label: '19 Oct' },
    { x: 340, y: 64, label: '26 Oct' },
  ]
  return (
    <figure className="relative">
      <div className="panel relative overflow-hidden p-5 shadow-[0_40px_80px_-50px_rgb(36_61_50/.55)] md:p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm text-grey">Texture · whole face</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-serif text-5xl">71.6</span>
              <span className="text-sm text-forest">+5.6 points since baseline</span>
            </div>
          </div>
          <span className="chip border-rose bg-rose-pale">Sample values</span>
        </div>
        <div className="relative -mx-2 mt-2 text-forest">
          <Contour animate rings={11} seed={23} accentIndex={6} className="h-56 w-full md:h-64" values={[66, 71, 63, 74, 70, 49, 69, 59]} />
        </div>
        <svg viewBox="0 0 380 120" className="w-full" aria-hidden>
          <line x1="20" x2="360" y1="104" y2="104" stroke="var(--color-line)" />
          <polyline points={scans.map((s) => `${s.x},${s.y}`).join(' ')} fill="none" stroke="var(--color-forest)" strokeWidth="1.5" />
          {scans.map((s) => (
            <g key={s.x}>
              <circle cx={s.x} cy={s.y} r="4.5" fill="var(--color-porcelain)" stroke="var(--color-forest)" strokeWidth="1.5" />
              <text x={s.x} y="118" textAnchor="middle" fontSize="10" fill="var(--color-grey)" fontFamily="JetBrains Mono">
                {s.label}
              </text>
            </g>
          ))}
          <line x1="190" x2="190" y1="22" y2="104" stroke="var(--color-rose)" strokeDasharray="3 3" />
          <rect x="196" y="14" width="118" height="22" rx="11" fill="var(--color-rose-pale)" />
          <text x="206" y="29" fontSize="11" fill="var(--color-charcoal)" fontFamily="Hanken Grotesk">
            Started retinol 0.5%
          </text>
        </svg>
        <div className="mt-3 rounded-[5px] border border-line bg-ivory p-3 text-[0.84rem]">
          <span className="font-medium">Temporal association, not proof.</span> Texture moved after the routine change. Lighting differed between two of these scans.
        </div>
      </div>
      <figcaption className="mt-3 text-xs text-grey">Interface preview with illustrative values.</figcaption>
    </figure>
  )
}

function LoopDemo() {
  const [i, setI] = useState(0)
  const step = LOOP[i]
  const R = 120
  return (
    <div className="grid items-center gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="relative mx-auto aspect-square w-full max-w-[22rem]">
        <svg viewBox="-160 -160 320 320" className="absolute inset-0 h-full w-full" aria-hidden>
          <circle r={R} fill="none" stroke="var(--color-line)" strokeWidth="1" />
          <circle
            r={R}
            fill="none"
            stroke="var(--color-forest)"
            strokeWidth="2"
            strokeDasharray={`${((i + 1) / LOOP.length) * 2 * Math.PI * R} ${2 * Math.PI * R}`}
            transform="rotate(-90)"
            style={{ transition: 'stroke-dasharray .5s ease' }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center">
            <div className="font-serif text-3xl">{step.title}</div>
            <div className="meta mt-1">
              step {i + 1} of {LOOP.length}
            </div>
          </div>
        </div>
        {LOOP.map((s, k) => {
          const a = (k / LOOP.length) * Math.PI * 2 - Math.PI / 2
          const x = 50 + (Math.cos(a) * R * 100) / 320
          const y = 50 + (Math.sin(a) * R * 100) / 320
          const Icon = s.icon
          return (
            <button
              key={s.key}
              onClick={() => setI(k)}
              aria-pressed={k === i}
              aria-label={s.title}
              className={`absolute grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border transition-colors ${
                k === i ? 'border-forest bg-forest text-ivory' : k < i ? 'border-forest bg-porcelain text-forest' : 'border-line bg-porcelain text-grey hover:border-sage'
              }`}
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <Icon className="size-5" />
            </button>
          )
        })}
      </div>
      <div>
        <ol className="mb-6 flex flex-wrap gap-2" aria-label="Feedback loop steps">
          {LOOP.map((s, k) => (
            <li key={s.key}>
              <button onClick={() => setI(k)} className={`chip ${k === i ? 'border-forest bg-forest text-ivory' : 'hover:border-sage'}`} aria-current={k === i ? 'step' : undefined}>
                {k + 1}. {s.title}
              </button>
            </li>
          ))}
        </ol>
        <p key={i} className="page-in max-w-md font-serif text-[1.45rem] leading-snug">
          {step.body}
        </p>
        <div className="mt-6 flex gap-2">
          <button className="btn btn-ghost" onClick={() => setI((i - 1 + LOOP.length) % LOOP.length)}>
            Previous
          </button>
          <button className="btn btn-primary" onClick={() => setI((i + 1) % LOOP.length)}>
            {i === LOOP.length - 1 ? 'Back to Analyze' : `Next: ${LOOP[i + 1].title}`}
          </button>
        </div>
      </div>
    </div>
  )
}

function Feature({ title, body, children, flip }: { title: string; body: string; children: React.ReactNode; flip?: boolean }) {
  return (
    <div className={`grid items-center gap-8 md:grid-cols-2 md:gap-16 ${flip ? 'md:[&>*:first-child]:order-2' : ''}`}>
      <div className="max-w-md">
        <h3 className="text-[1.9rem]">{title}</h3>
        <p className="mt-3 text-[1.02rem] text-charcoal/80">{body}</p>
      </div>
      <div>{children}</div>
    </div>
  )
}

export default function Landing() {
  return (
    <div className="bg-ivory">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 md:px-8">
        <Link to="/" className="flex items-center gap-2.5">
          <Logo />
          <span className="font-serif text-xl">DermaTrack & Adapt</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm" aria-label="Site">
          <a href="#how" className="btn btn-quiet hidden sm:inline-flex">
            How it works
          </a>
          <a href="#privacy" className="btn btn-quiet hidden sm:inline-flex">
            Privacy
          </a>
          <Link to="/app" className="btn btn-ghost">
            Open the app
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-8 md:grid-cols-[1.05fr_1fr] md:px-8 md:pb-28 md:pt-14">
        <div>
          <p className="text-forest">Your skin evolves. Your routine should too.</p>
          <h1 className="mt-4 text-[3rem] leading-[1.02] tracking-[-0.025em] md:text-[4.6rem]">Your skin has a story. Start understanding it.</h1>
          <p className="mt-6 max-w-lg text-[1.1rem] text-charcoal/80">
            Connect your skin scans, skincare routine, and daily check-ins to understand changes over time and make more informed decisions about what comes next.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/app/analysis" className="btn btn-primary min-h-12 px-6 text-base">
              Start my skin journey
            </Link>
            <a href="#how" className="btn btn-ghost min-h-12 px-6 text-base">
              Explore how it works
            </a>
          </div>
          <p className="mt-6 text-sm text-grey">Skin analysis by the YouCam AI Skin Analysis API. Informational, not a medical device.</p>
        </div>
        <HeroPreview />
      </section>

      {/* Problem */}
      <section className="border-y border-line bg-porcelain">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-20 md:grid-cols-[1fr_1.2fr] md:px-8">
          <h2 className="text-[2.2rem] md:text-[2.8rem]">A single scan can’t tell you whether your routine is working.</h2>
          <div className="space-y-5 text-[1.05rem] text-charcoal/85">
            <p>People buy expensive products without knowing whether they suit them, and layer actives without knowing which combinations tend to irritate.</p>
            <p>Most tools stop at a score or a product suggestion. They don’t remember what you changed, when your skin reacted, or whether last week’s photo was taken in different light.</p>
            <p>So it’s hard to tell genuine change from normal day-to-day variation — and easy to buy something new when nothing needed to change.</p>
          </div>
        </div>
      </section>

      {/* Loop */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-8 px-5 py-24 md:px-8">
        <div className="mb-12 max-w-xl">
          <h2 className="text-[2.4rem]">One feedback loop, not five separate tools.</h2>
          <p className="mt-3 text-grey">Every part of DermaTrack feeds the next. Select a step to see what it does.</p>
        </div>
        <LoopDemo />
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl space-y-24 px-5 pb-24 md:px-8">
        <Feature title="Skin analysis that shows its work" body="Real YouCam results, on their documented scale. We store the scores, not your photo, and we say which scores the API did and didn’t return.">
          <div className="panel p-5">
            {[
              ['Pores', 88.4, 84],
              ['Texture', 80.1, 76],
              ['Moisture', 48.7, 70],
              ['Redness', 72.0, 77],
            ].map(([l, raw, ui]) => (
              <div key={l as string} className="grid grid-cols-[6rem_1fr_auto] items-center gap-3 border-b border-line py-2.5 last:border-0">
                <span className="text-sm">{l}</span>
                <span className="h-1.5 rounded-full bg-sage-pale">
                  <span className="block h-full rounded-full bg-forest" style={{ width: `${raw}%` }} />
                </span>
                <span className="meta">
                  raw {raw} · display {ui}
                </span>
              </div>
            ))}
            <p className="mt-3 text-xs text-grey">Sample values from YouCam’s public documentation.</p>
          </div>
        </Feature>

        <Feature flip title="Progress you can trust" body="Scans are only compared when they were taken the same way. Changes under three points are shown as “no clear change”, and every number is labelled as a change in an AI measurement — not a percentage of biological improvement.">
          <div className="panel p-5">
            <svg viewBox="0 0 360 150" className="w-full" aria-hidden>
              <rect x="0" y="40" width="360" height="40" fill="var(--color-sage-pale)" opacity=".7" />
              <text x="6" y="54" fontSize="10" fill="var(--color-forest)" fontFamily="Hanken Grotesk">
                variation band
              </text>
              <polyline points="20,70 110,64 200,58 290,46 340,42" fill="none" stroke="var(--color-forest)" strokeWidth="1.6" />
              <polyline points="20,96 110,92 200,112 290,104 340,100" fill="none" stroke="var(--color-rose)" strokeWidth="1.6" />
              <line x1="155" x2="155" y1="10" y2="135" stroke="var(--color-charcoal)" strokeDasharray="2 4" opacity=".5" />
              <text x="160" y="20" fontSize="10" fill="var(--color-charcoal)" fontFamily="Hanken Grotesk">
                Glycolic acid introduced
              </text>
            </svg>
            <div className="mt-2 flex gap-4 text-xs text-grey">
              <span className="flex items-center gap-1.5">
                <i className="h-0.5 w-4 bg-forest" /> Texture
              </span>
              <span className="flex items-center gap-1.5">
                <i className="h-0.5 w-4 bg-rose" /> Redness
              </span>
            </div>
          </div>
        </Feature>

        <Feature title="Routine intelligence without scare tactics" body="A transparent rules engine checks your products. It separates documented concerns from precautions, accounts for how often you use each product, and tells you when it couldn’t evaluate something.">
          <div className="panel p-5">
            <span className="chip border-ochre-pale bg-ochre-pale text-ochre">Precaution</span>
            <h4 className="mt-3 font-serif text-xl">Retinoid and acid exfoliant in the same application</h4>
            <p className="mt-2 text-sm text-charcoal/80">Both can cause dryness or stinging; layering them can add up. This isn’t a rule that they can never be combined.</p>
            <p className="mt-3 text-sm">
              <span className="font-medium">Next step:</span> consider alternate evenings.
            </p>
            <p className="meta mt-4">rule R-RET-ACID-01</p>
          </div>
        </Feature>

        <Feature flip title="Guidance that knows its limits" body="Deterministic rules connect your symptoms, routine history and scans. Severe reactions always come first and are never outweighed by a reassuring scan. And there’s a companion that answers from your records, citing each one.">
          <div className="panel space-y-3 p-5 text-sm">
            <div className="ml-auto w-fit max-w-[85%] rounded-[12px] rounded-br-sm bg-forest px-3.5 py-2 text-ivory">What changed since my last scan?</div>
            <div className="max-w-[90%] rounded-[12px] rounded-bl-sm border border-line bg-ivory px-3.5 py-2.5">
              No measurement moved beyond the variation band, so there’s no clear change. One routine change happened in between; that’s a timing overlap, not evidence of cause.
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="chip">Scan #3</span>
                <span className="chip">Scan #4</span>
              </div>
            </div>
          </div>
        </Feature>
      </section>

      {/* Privacy */}
      <section id="privacy" className="scroll-mt-8 bg-forest text-ivory">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 md:grid-cols-[1fr_1.3fr] md:px-8">
          <div>
            <h2 className="text-[2.4rem]">Your face is not our data set.</h2>
            <p className="mt-4 text-ivory/75">Here is exactly what happens to a photo you upload.</p>
          </div>
          <ul className="space-y-5">
            {[
              [Lock, 'The photo goes from our server to YouCam for analysis, and nowhere else.', 'API keys stay on the server. Your browser never sees them.'],
              [ShieldCheck, 'We keep the scores, not the photo.', 'Detection-mask links from YouCam expire and are never stored.'],
              [Check, 'Analysis only runs after you consent.', 'You can withdraw consent at any time in Settings.'],
              [Trash2, 'Export or delete everything.', 'One button downloads your records; another erases them.'],
            ].map(([Icon, t, s]) => {
              const I = Icon as typeof Lock
              return (
                <li key={t as string} className="flex gap-4">
                  <I className="mt-1 size-5 shrink-0 text-rose" aria-hidden />
                  <div>
                    <div className="text-[1.05rem]">{t as string}</div>
                    <div className="text-sm text-ivory/65">{s as string}</div>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden">
        <Contour className="pointer-events-none absolute -right-24 -top-10 h-[28rem] w-[36rem] text-sage" rings={12} seed={41} />
        <div className="relative mx-auto max-w-6xl px-5 py-24 md:px-8">
          <h2 className="max-w-xl text-[2.6rem] md:text-[3.2rem]">Set your baseline today. See what’s real in a few weeks.</h2>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/app/analysis" className="btn btn-primary min-h-12 px-6 text-base">
              Start my skin journey
            </Link>
            <Link to="/app/settings#demo" className="btn btn-ghost min-h-12 px-6 text-base">
              Try the demonstration data
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-line bg-porcelain">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 text-sm text-grey md:grid-cols-3 md:px-8">
          <div>
            <div className="flex items-center gap-2 text-charcoal">
              <Logo className="size-6" />
              <span className="font-serif text-lg">DermaTrack & Adapt</span>
            </div>
            <p className="mt-3">A project for the YouCam API Skin AI & eCommerce VTO Hackathon, 2026.</p>
          </div>
          <div>
            <p className="font-medium text-charcoal">Not medical advice</p>
            <p className="mt-2">
              DermaTrack is informational. It doesn’t diagnose, treat or prevent any condition. AI skin scores measure how features appear in a photo. For reactions or concerns, consult a qualified healthcare professional.
            </p>
          </div>
          <div>
            <p className="font-medium text-charcoal">About the technology</p>
            <p className="mt-2">Skin analysis is provided by the YouCam AI Skin Analysis API from Perfect Corp. Ingredient checks and guidance are rule-based. Product information is unverified unless marked otherwise.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
