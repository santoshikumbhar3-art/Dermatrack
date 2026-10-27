import { useState } from 'react'
import { useApi, useRefresh, useToast } from '../lib/hooks'
import { api, ApiError, type Guidance } from '../services/api'
import GuidanceCard from './GuidanceCard'
import { ErrorNote } from './ui'

const SYMPTOMS = ['irritation', 'redness', 'dryness', 'burning', 'itching', 'peeling', 'breakouts', 'swelling', 'discomfort']
const LEVELS = ['None', 'Mild', 'Moderate', 'Severe']
const CONFOUNDERS = ['Travel', 'More sun exposure', 'Weather change', 'Poor sleep', 'Stress', 'Illness', 'New medication', 'Wore makeup for the scan', 'Different scan lighting']

export default function CheckInForm() {
  const toast = useToast()
  const { bump } = useRefresh()
  const meta = useApi(() => api.checkins())
  const routine = useApi(() => api.routines())
  const [sym, setSym] = useState<Record<string, number>>({})
  const [flags, setFlags] = useState<string[]>([])
  const [conf, setConf] = useState<string[]>([])
  const [custom, setCustom] = useState('')
  const [suspects, setSuspects] = useState<number[]>([])
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<ApiError | null>(null)
  const [result, setResult] = useState<Guidance | null>(null)

  const flagLabels = meta.data?.red_flag_labels ?? {}
  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const r = await api.createCheckin({ symptoms: sym, red_flags: flags, confounders: conf, suspected_item_ids: suspects, notes })
      setResult(r.guidance)
      setSym({})
      setFlags([])
      setConf([])
      setSuspects([])
      setNotes('')
      bump()
      toast('Check-in saved')
    } catch (e) {
      setErr(e as ApiError)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="space-y-6">
        <fieldset>
          <legend className="mb-3 font-medium">How has your skin felt since your last check-in?</legend>
          <div className="grid gap-y-2.5">
            {SYMPTOMS.map((s) => (
              <div key={s} className="flex items-center justify-between gap-3">
                <span id={`sym-${s}`} className="text-sm capitalize">
                  {s}
                </span>
                <div role="radiogroup" aria-labelledby={`sym-${s}`} className="inline-flex overflow-hidden rounded-full border border-line bg-porcelain text-xs">
                  {LEVELS.map((l, i) => {
                    const on = (sym[s] ?? 0) === i
                    return (
                      <button
                        type="button"
                        key={l}
                        role="radio"
                        aria-checked={on}
                        onClick={() => setSym((x) => ({ ...x, [s]: i }))}
                        className={`px-2.5 py-1.5 ${on ? (i === 3 ? 'bg-alarm text-porcelain' : i === 0 ? 'bg-sage-pale text-forest' : 'bg-forest text-ivory') : 'text-grey hover:bg-ivory'}`}
                      >
                        {l}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </fieldset>

        <fieldset className="rounded-[6px] border border-alarm-pale p-4">
          <legend className="px-1 font-medium">Any of these warning signs?</legend>
          <p className="mb-3 text-sm text-grey">If you have trouble breathing or swelling of the face, lips or tongue, call 112 or go to an emergency department now.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(flagLabels).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-[#9B2C23]" checked={flags.includes(k)} onChange={() => setFlags((f) => toggle(f, k))} />
                <span className="first-letter:uppercase">{label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {routine.data && routine.data.items.length > 0 && (
          <fieldset>
            <legend className="mb-2 font-medium">
              Do you suspect a product? <span className="text-sm font-normal text-grey">(optional)</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {routine.data.items.map((i) => (
                <button type="button" key={i.id} aria-pressed={suspects.includes(i.id)} onClick={() => setSuspects((s) => (s.includes(i.id) ? s.filter((x) => x !== i.id) : [...s, i.id]))} className={`chip ${suspects.includes(i.id) ? 'border-forest bg-forest text-ivory' : 'hover:border-sage'}`}>
                  {i.name}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <fieldset>
          <legend className="mb-2 font-medium">
            Anything that could affect your skin or your scans? <span className="text-sm font-normal text-grey">(optional)</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {[...CONFOUNDERS, ...conf.filter((c) => !CONFOUNDERS.includes(c))].map((c) => (
              <button type="button" key={c} aria-pressed={conf.includes(c)} onClick={() => setConf((x) => toggle(x, c))} className={`chip ${conf.includes(c) ? 'border-forest bg-forest text-ivory' : 'hover:border-sage'}`}>
                {c}
              </button>
            ))}
          </div>
          <div className="mt-2 flex max-w-sm gap-2">
            <input className="input" placeholder="Something else" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Other factor" maxLength={60} />
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!custom.trim()}
              onClick={() => {
                setConf((c) => [...c, custom.trim()])
                setCustom('')
              }}
            >
              Add
            </button>
          </div>
        </fieldset>

        <label className="field">
          <span>Notes</span>
          <textarea className="input min-h-20" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} placeholder="Anything you noticed" />
        </label>

        {err && <ErrorNote error={err} />}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save check-in'}
        </button>
      </form>

      {result && (
        <div className="mt-8 space-y-3" aria-live="polite">
          <h3 className="text-xl">Based on this check-in</h3>
          {result.cards.length === 0 ? <p className="text-grey">Nothing to flag. Keep going as you are.</p> : result.cards.map((c) => <GuidanceCard key={c.id} card={c} />)}
        </div>
      )}
    </div>
  )
}
