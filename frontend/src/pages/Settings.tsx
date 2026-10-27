import { Download, FlaskConical, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Confirm, ErrorNote, PageHeader, SectionTitle, Spinner } from '../components/ui'
import { fmtDateTime } from '../lib/format'
import { useApi, useRefresh, useToast } from '../lib/hooks'
import { api, ApiError, type Profile } from '../services/api'

const GOALS = ['hydration', 'breakouts', 'oil-control', 'even-tone', 'texture', 'fine-lines', 'sun-protection', 'simplify']

function Row({ title, body, children }: { title: string; body?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid gap-4 border-b border-line py-6 last:border-0 md:grid-cols-[1fr_1.4fr]">
      <div>
        <h3 className="font-sans text-[1rem] font-semibold">{title}</h3>
        {body && <div className="mt-1 text-sm text-grey">{body}</div>}
      </div>
      <div>{children}</div>
    </div>
  )
}

export default function Settings() {
  const toast = useToast()
  const { bump } = useRefresh()
  const loc = useLocation()
  const prof = useApi(() => api.profile())
  const health = useApi(() => api.health())
  const overview = useApi(() => api.overview())
  const [f, setF] = useState<Profile | null>(null)
  const [err, setErr] = useState<ApiError | null>(null)
  const [confirm, setConfirm] = useState<null | 'all' | 'scans' | 'consent'>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (prof.data) setF(prof.data)
  }, [prof.data])
  useEffect(() => {
    if (loc.hash && f) setTimeout(() => document.querySelector(loc.hash)?.scrollIntoView({ behavior: 'smooth' }), 150)
  }, [loc.hash, f])

  if (prof.loading && !f) return <Spinner />
  if (prof.error) return <ErrorNote error={prof.error} onRetry={prof.reload} />
  if (!f) return null

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    try {
      const p = await api.saveProfile({
        display_name: f!.display_name,
        skin_goals: f!.skin_goals,
        budget_max: f!.budget_max,
        currency: f!.currency,
        avoid_fragrance: f!.avoid_fragrance,
        checkin_interval_days: f!.checkin_interval_days,
      })
      setF(p)
      toast('Profile saved')
      bump()
    } catch (x) {
      setErr(x as ApiError)
    }
  }

  async function exportData() {
    const data = await api.exportData()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `dermatrack-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    toast('Export downloaded')
  }

  const h = health.data
  const hasDemo = overview.data?.has_demo

  return (
    <div>
      <PageHeader title="Settings" intro="Your profile, consent and data. This prototype runs a single local profile with no account sign-in." />

      <section className="mb-12">
        <SectionTitle>Profile</SectionTitle>
        <form onSubmit={saveProfile} className="panel px-5 md:px-6">
          <Row title="Name" body="Used only for greetings.">
            <label className="field">
              <span className="sr-only">Display name</span>
              <input className="input max-w-sm" value={f.display_name} maxLength={80} onChange={(e) => setF({ ...f, display_name: e.target.value })} />
            </label>
          </Row>
          <Row title="Skin goals" body="Used by product matching. Select any that apply.">
            <div className="flex flex-wrap gap-2">
              {GOALS.map((g) => {
                const on = f.skin_goals.includes(g)
                return (
                  <button type="button" key={g} aria-pressed={on} onClick={() => setF({ ...f, skin_goals: on ? f.skin_goals.filter((x) => x !== g) : [...f.skin_goals, g] })} className={`chip ${on ? 'border-forest bg-forest text-ivory' : 'hover:border-sage'}`}>
                    {g.replace('-', ' ')}
                  </button>
                )
              })}
            </div>
          </Row>
          <Row title="Budget per product" body="Only applied to products with a price you’ve verified.">
            <div className="flex max-w-sm gap-2">
              <input className="input" type="number" min={0} placeholder="No limit" value={f.budget_max ?? ''} onChange={(e) => setF({ ...f, budget_max: e.target.value === '' ? null : Number(e.target.value) })} aria-label="Budget" />
              <input className="input w-24 uppercase" maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} aria-label="Currency" />
            </div>
          </Row>
          <Row title="Fragrance" body="Exclude products that contain fragrance from matches.">
            <label className="flex items-center gap-2">
              <input type="checkbox" className="size-4 accent-[#243D32]" checked={f.avoid_fragrance} onChange={(e) => setF({ ...f, avoid_fragrance: e.target.checked })} /> Avoid fragrance
            </label>
          </Row>
          <Row title="Check-in reminder" body="How often DermaTrack suggests a check-in.">
            <select className="input max-w-xs" value={f.checkin_interval_days} onChange={(e) => setF({ ...f, checkin_interval_days: Number(e.target.value) })}>
              {[3, 7, 14, 28].map((d) => (
                <option key={d} value={d}>
                  Every {d} days
                </option>
              ))}
            </select>
          </Row>
          <div className="py-5">
            {err && (
              <div className="mb-3">
                <ErrorNote error={err} />
              </div>
            )}
            <button className="btn btn-primary">Save profile</button>
          </div>
        </form>
      </section>

      <section className="mb-12">
        <SectionTitle>Privacy and consent</SectionTitle>
        <div className="panel px-5 md:px-6">
          <Row title="Photo analysis consent" body="Required before a photo is sent to YouCam.">
            {f.analysis_consent ? (
              <div className="space-y-2">
                <p>
                  Given {fmtDateTime(f.analysis_consent_at)} <span className="meta">v{f.consent_version}</span>
                </p>
                <button className="btn btn-ghost" onClick={() => setConfirm('consent')}>
                  Withdraw consent
                </button>
              </div>
            ) : (
              <p className="text-grey">Not given. You’ll be asked before your next scan.</p>
            )}
          </Row>
          <Row title="How your data is handled">
            <ul className="space-y-2 text-sm">
              <li>Photos are sent from this app’s server to the YouCam AI Skin Analysis API (Perfect Corp.) and are not stored by DermaTrack.</li>
              <li>YouCam keeps task results for 24 hours after processing, under its own privacy policy and terms of service.</li>
              <li>DermaTrack stores scores, check-ins and routine records in a local database on the server you run.</li>
              <li>A copy of each provider response is kept with every link removed, for debugging. Image links from YouCam expire and are never saved.</li>
              <li>API keys are kept on the server. Nothing in your browser can read them.</li>
            </ul>
          </Row>
          <Row title="Photo guidance">
            <p className="text-sm">Face the camera, forehead visible, even front lighting, no makeup if possible. Use the same spot, light and time of day each time so scans can be compared.</p>
          </Row>
          <Row title="Service status">
            {h ? (
              <ul className="space-y-1 text-sm">
                <li>
                  Skin analysis:{' '}
                  {h.analysis_source === 'youcam' ? (
                    <span className="text-forest">YouCam API connected ({h.youcam_mode.toUpperCase()} mode)</span>
                  ) : h.analysis_source === 'dev_fixture' ? (
                    <span className="text-ochre">Development fixture (no API key configured)</span>
                  ) : (
                    <span className="text-alarm">Not configured</span>
                  )}
                </li>
                <li>Companion: {h.assistant_mode === 'llm_phrased' ? 'Rule-based, phrased by a language model' : 'Rule-based (no language model)'}</li>
              </ul>
            ) : (
              <Spinner label="Checking" />
            )}
          </Row>
        </div>
      </section>

      <section id="demo" className="mb-12 scroll-mt-24">
        <SectionTitle>Demonstration data</SectionTitle>
        <div className="panel flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between md:p-6">
          <div className="max-w-xl">
            <p className="flex items-center gap-2 font-medium">
              <FlaskConical className="size-4 text-rose" /> {hasDemo ? 'Demonstration data is loaded' : 'Explore with a sample dataset'}
            </p>
            <p className="mt-1 text-sm text-grey">
              Four sample scans, a routine with a retinol and glycolic acid overlap, and a few check-ins. Every sample record is labelled and can be removed without touching your own data. The values are not real measurements.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {hasDemo ? (
              <button
                className="btn btn-ghost"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  await api.clearDemo().catch((e) => toast(e.message, 'error'))
                  setBusy(false)
                  toast('Demonstration data removed')
                  bump()
                }}
              >
                Remove demonstration data
              </button>
            ) : (
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  await api.loadDemo().catch((e) => toast(e.message, 'error'))
                  setBusy(false)
                  toast('Demonstration data loaded')
                  bump()
                }}
              >
                Load demonstration data
              </button>
            )}
          </div>
        </div>
      </section>

      <section>
        <SectionTitle>Your data</SectionTitle>
        <div className="panel px-5 md:px-6">
          <Row title="Export" body="Everything DermaTrack stores about you, as JSON. Photos aren’t included because they’re never stored.">
            <button className="btn btn-ghost" onClick={() => exportData().catch((e) => toast(e.message, 'error'))}>
              <Download className="size-4" /> Download my data
            </button>
          </Row>
          <Row title="Scan history" body="Delete every scan but keep your routine and check-ins.">
            <button className="btn btn-danger" onClick={() => setConfirm('scans')}>
              Delete all scans
            </button>
          </Row>
          <Row title="Delete everything" body="Erase your profile, consent, scans, check-ins, routine and products you added.">
            <button className="btn btn-danger" onClick={() => setConfirm('all')}>
              <Trash2 className="size-4" /> Delete all my data
            </button>
          </Row>
        </div>
      </section>

      <Confirm
        open={confirm !== null}
        danger
        title={confirm === 'all' ? 'Delete all your data?' : confirm === 'scans' ? 'Delete all scans?' : 'Withdraw consent?'}
        body={
          confirm === 'all'
            ? 'This permanently erases everything stored in DermaTrack. It can’t be undone. Consider downloading an export first.'
            : confirm === 'scans'
              ? 'Every scan and its scores will be permanently deleted. Your routine and check-ins stay.'
              : 'You won’t be able to scan until you consent again. Existing scans aren’t deleted — use “Delete all scans” for that.'
        }
        confirmLabel={confirm === 'all' ? 'Delete everything' : confirm === 'scans' ? 'Delete scans' : 'Withdraw'}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          try {
            if (confirm === 'all') await api.deleteAll()
            if (confirm === 'scans') await api.deleteAllAnalyses()
            if (confirm === 'consent') await api.setConsent(false)
            toast(confirm === 'all' ? 'All data deleted' : confirm === 'scans' ? 'Scans deleted' : 'Consent withdrawn')
            bump()
          } catch (e) {
            toast((e as Error).message, 'error')
          }
          setConfirm(null)
        }}
      />
    </div>
  )
}
