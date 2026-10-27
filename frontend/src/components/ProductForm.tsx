import { Camera, Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, ApiError, type Compatibility, type RoutineItem, type RoutineItemInput } from '../services/api'
import { CATEGORIES, FREQUENCY_LABEL, SLOT_LABEL, cap, today } from '../lib/format'
import FindingCard from './FindingCard'
import { ErrorNote } from './ui'

export const EMPTY_ITEM: RoutineItemInput = {
  name: '',
  brand: '',
  category: 'serum',
  slot: 'pm',
  step_order: 1,
  actives: [],
  ingredients_verified: false,
  frequency: 'daily',
  introduced_on: today(),
  instructions: '',
  paused: false,
  notes: '',
}

export default function ProductForm({ initial, existing, editingId, onSaved, onCancel }: { initial: RoutineItemInput; existing: RoutineItem[]; editingId?: number; onSaved: (i: RoutineItem) => void; onCancel: () => void }) {
  const [f, setF] = useState<RoutineItemInput>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [err, setErr] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<Compatibility | null>(null)
  const [recog, setRecog] = useState<Record<string, string | null>>({})

  const set = <K extends keyof RoutineItemInput>(k: K, v: RoutineItemInput[K]) => setF((x) => ({ ...x, [k]: v }))

  // Live compatibility preview of the routine with this draft applied.
  useEffect(() => {
    const t = setTimeout(() => {
      if (!f.name.trim()) return setPreview(null)
      const others = existing.filter((i) => i.id !== editingId)
      const draft = { ...f, actives: f.actives.filter((a) => a.name.trim()) }
      api
        .previewCompat([...others, draft])
        .then(setPreview)
        .catch(() => setPreview(null))
    }, 450)
    return () => clearTimeout(t)
  }, [f, existing, editingId])

  // Recognition feedback for each active ingredient.
  useEffect(() => {
    const t = setTimeout(() => {
      f.actives.forEach((a) => {
        const n = a.name.trim()
        if (!n || n in recog) return
        fetch(`/api/ingredients/resolve?name=${encodeURIComponent(n)}`)
          .then((r) => r.json())
          .then((d) => setRecog((x) => ({ ...x, [n]: d.recognised ? d.canonical : null })))
          .catch(() => {})
      })
    }, 400)
    return () => clearTimeout(t)
  }, [f.actives, recog])

  const draftIndex = existing.filter((i) => i.id !== editingId).length
  const draftFindings = (preview?.findings ?? []).filter((x) => x.product_ids.includes(`draft-${draftIndex}`))

  function validate() {
    const e: Record<string, string> = {}
    if (!f.name.trim()) e.name = 'Enter the product name.'
    f.actives.forEach((a, i) => {
      if (!a.name.trim()) e[`active-${i}`] = 'Enter an ingredient name or remove this row.'
      if (a.concentration_percent != null && (a.concentration_percent < 0 || a.concentration_percent > 100)) e[`conc-${i}`] = 'Use a percentage between 0 and 100.'
    })
    if (f.introduced_on && f.introduced_on > today()) e.introduced_on = 'The start date can’t be in the future.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function save(ev: React.FormEvent) {
    ev.preventDefault()
    if (!validate()) return
    setBusy(true)
    setErr(null)
    try {
      const body = { ...f, actives: f.actives.map((a) => ({ name: a.name.trim(), concentration_percent: a.concentration_percent ?? null })) }
      const saved = editingId ? await api.updateItem(editingId, body) : await api.createItem(body)
      onSaved(saved)
    } catch (e) {
      const ae = e as ApiError
      setErr(ae)
      if (ae.fields) setErrors(Object.fromEntries(ae.fields.map((x) => [x.field, x.message])))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-5" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field sm:col-span-2">
          <span>Product name</span>
          <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} aria-invalid={!!errors.name} maxLength={160} required />
          {errors.name && <span className="text-sm text-alarm">{errors.name}</span>}
        </label>
        <label className="field">
          <span>Brand</span>
          <input className="input" value={f.brand} onChange={(e) => set('brand', e.target.value)} maxLength={120} />
        </label>
        <label className="field">
          <span>Category</span>
          <select className="input" value={f.category} onChange={(e) => set('category', e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {cap(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>When you use it</span>
          <select className="input" value={f.slot} onChange={(e) => set('slot', e.target.value as RoutineItemInput['slot'])}>
            {Object.entries(SLOT_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>How often</span>
          <select className="input" value={f.frequency} onChange={(e) => set('frequency', e.target.value as RoutineItemInput['frequency'])}>
            {Object.entries(FREQUENCY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Started using it on</span>
          <input type="date" className="input" max={today()} value={f.introduced_on ?? ''} onChange={(e) => set('introduced_on', e.target.value || null)} aria-invalid={!!errors.introduced_on} />
          {errors.introduced_on && <span className="text-sm text-alarm">{errors.introduced_on}</span>}
        </label>
        <label className="field">
          <span>Step order</span>
          <input type="number" min={0} max={50} className="input" value={f.step_order} onChange={(e) => set('step_order', Math.max(0, Math.min(50, Number(e.target.value) || 0)))} />
        </label>
      </div>

      <fieldset>
        <legend className="mb-1 font-medium">Active ingredients</legend>
        <p className="mb-3 text-sm text-grey">Copy them from the label. Only add a percentage if the label states it — DermaTrack never guesses concentrations.</p>
        <div className="space-y-2">
          {f.actives.map((a, i) => {
            const n = a.name.trim()
            const r = n ? recog[n] : undefined
            return (
              <div key={i}>
                <div className="flex gap-2">
                  <input
                    className="input"
                    placeholder="e.g. salicylic acid"
                    value={a.name}
                    aria-label={`Ingredient ${i + 1}`}
                    aria-invalid={!!errors[`active-${i}`]}
                    onChange={(e) => set('actives', f.actives.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  />
                  <input
                    className="input w-24"
                    type="number"
                    step="0.01"
                    min={0}
                    max={100}
                    placeholder="%"
                    aria-label={`Concentration of ingredient ${i + 1}, percent`}
                    value={a.concentration_percent ?? ''}
                    onChange={(e) => set('actives', f.actives.map((x, j) => (j === i ? { ...x, concentration_percent: e.target.value === '' ? null : Number(e.target.value) } : x)))}
                  />
                  <button type="button" className="btn btn-quiet" aria-label={`Remove ingredient ${i + 1}`} onClick={() => set('actives', f.actives.filter((_, j) => j !== i))}>
                    <X className="size-4" />
                  </button>
                </div>
                {errors[`active-${i}`] && <p className="mt-1 text-sm text-alarm">{errors[`active-${i}`]}</p>}
                {n && r !== undefined && <p className={`mt-1 text-xs ${r ? 'text-forest' : 'text-ochre'}`}>{r ? `Recognised as ${r}` : 'Not in the rules engine’s list — it won’t be checked for combinations.'}</p>}
              </div>
            )
          })}
        </div>
        <button type="button" className="btn btn-ghost mt-3" onClick={() => set('actives', [...f.actives, { name: '', concentration_percent: null }])}>
          <Plus className="size-4" /> Add ingredient
        </button>
        <label className="mt-4 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-[#243D32]" checked={f.ingredients_verified} onChange={(e) => set('ingredients_verified', e.target.checked)} />
          I checked these against the product’s physical label or official ingredient list.
        </label>
        <p className="mt-3 flex items-start gap-2 rounded bg-ivory p-3 text-xs text-grey">
          <Camera className="size-4 shrink-0" aria-hidden />
          Reading ingredients from a label photo isn’t available in this build because no OCR service is configured. A shelf photo also can’t reliably reveal a full ingredient list.
        </p>
      </fieldset>

      <label className="field">
        <span>
          Product instructions <span className="hint">(from the label)</span>
        </span>
        <textarea className="input min-h-16" value={f.instructions} maxLength={1000} onChange={(e) => set('instructions', e.target.value)} placeholder="e.g. Use in the evening, start 2–3 times a week" />
      </label>
      <label className="field">
        <span>Notes</span>
        <textarea className="input min-h-16" value={f.notes} maxLength={1000} onChange={(e) => set('notes', e.target.value)} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-[#243D32]" checked={f.paused} onChange={(e) => set('paused', e.target.checked)} />
        Temporarily paused
      </label>

      {f.name.trim() && (
        <div className="space-y-2" aria-live="polite">
          <h3 className="font-sans text-sm font-semibold">Compatibility with your routine</h3>
          {draftFindings.length === 0 ? (
            <p className="text-sm text-grey">{f.actives.some((a) => a.name.trim()) ? 'No combination rules flagged for this product.' : 'Add active ingredients to check this product.'}</p>
          ) : (
            draftFindings.map((x) => <FindingCard key={x.rule_id + x.product_ids.join()} f={x} />)
          )}
        </div>
      )}

      {err && !err.fields && <ErrorNote error={err} />}
      <div className="sticky bottom-0 -mx-6 flex gap-2 border-t border-line bg-porcelain px-6 py-4">
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : editingId ? 'Save changes' : 'Add to routine'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
