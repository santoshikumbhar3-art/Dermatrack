import { Moon, Pause, Pencil, Play, Plus, Sun, Trash2, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import FindingCard from '../components/FindingCard'
import ProductForm, { EMPTY_ITEM } from '../components/ProductForm'
import { Confirm, Drawer, EmptyState, ErrorNote, PageHeader, SectionTitle, Skeleton } from '../components/ui'
import { Contour } from '../components/charts/Contour'
import { FREQUENCY_LABEL, cap, fmtDate } from '../lib/format'
import { useApi, useRefresh, useToast } from '../lib/hooks'
import { api, ApiError, type RoutineItem, type RoutineItemInput } from '../services/api'

const toInput = (i: RoutineItem): RoutineItemInput => ({
  name: i.name,
  brand: i.brand,
  category: i.category,
  slot: i.slot,
  step_order: i.step_order,
  actives: i.actives,
  ingredients_verified: i.ingredients_verified,
  frequency: i.frequency,
  introduced_on: i.introduced_on,
  instructions: i.instructions,
  paused: i.paused,
  notes: i.notes,
  library_product_id: i.library_product_id,
})

function ItemRow({ i, onEdit, onToggle, onDelete, onReact, flagged }: { i: RoutineItem; onEdit: () => void; onToggle: () => void; onDelete: () => void; onReact: () => void; flagged: boolean }) {
  return (
    <li id={`item-${i.id}`} className={`scroll-mt-24 rounded-[6px] border bg-porcelain p-4 ${i.paused ? 'border-dashed border-line opacity-70' : 'border-line'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="meta">{i.step_order}</span>
            <h3 className="font-sans text-[1rem] font-semibold">{i.name}</h3>
            {i.paused && <span className="chip">Paused</span>}
            {flagged && !i.paused && (
              <span className="chip border-ochre-pale bg-ochre-pale text-ochre">
                <TriangleAlert className="size-3" aria-hidden /> Flagged
              </span>
            )}
            {i.is_demo && <span className="chip border-rose bg-rose-pale text-[0.7rem]">demo</span>}
          </div>
          <p className="text-sm text-grey">
            {[i.brand, cap(i.category), FREQUENCY_LABEL[i.frequency]].filter(Boolean).join(' · ')}
            {i.introduced_on && ` · since ${fmtDate(i.introduced_on)}`}
          </p>
          {i.actives.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {i.actives.map((a) => (
                <span key={a.name} className="chip bg-ivory">
                  {a.name}
                  {a.concentration_percent != null && <span className="meta">{a.concentration_percent}%</span>}
                </span>
              ))}
              {!i.ingredients_verified && <span className="text-xs text-grey">unverified</span>}
            </div>
          ) : (
            <p className="mt-2 text-xs text-ochre">No actives recorded — can’t be checked for combinations.</p>
          )}
          {i.reactions.length > 0 && (
            <p className="mt-2 text-sm">
              <span className="text-rose">●</span> {i.reactions.length} reaction{i.reactions.length > 1 ? 's' : ''} recorded, latest: “{i.reactions[i.reactions.length - 1].description}”
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1 border-t border-line pt-3">
        <button className="btn btn-quiet text-sm" onClick={onEdit}>
          <Pencil className="size-3.5" /> Edit
        </button>
        <button className="btn btn-quiet text-sm" onClick={onToggle}>
          {i.paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />} {i.paused ? 'Resume' : 'Pause'}
        </button>
        <button className="btn btn-quiet text-sm" onClick={onReact}>
          Record a reaction
        </button>
        <button className="btn btn-quiet ml-auto text-sm text-alarm" onClick={onDelete} aria-label={`Remove ${i.name}`}>
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </li>
  )
}

function ReactionForm({ item, onDone }: { item: RoutineItem; onDone: () => void }) {
  const toast = useToast()
  const { bump } = useRefresh()
  const [desc, setDesc] = useState('')
  const [sev, setSev] = useState(1)
  const [err, setErr] = useState<ApiError | null>(null)
  return (
    <div className="space-y-6">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault()
          if (desc.trim().length < 2) return setErr(new ApiError(422, 'v', 'Describe what you noticed.'))
          try {
            await api.addReaction(item.id, { description: desc.trim(), severity: sev })
            toast('Reaction recorded')
            bump()
            onDone()
          } catch (x) {
            setErr(x as ApiError)
          }
        }}
      >
        <label className="field">
          <span>What did you notice?</span>
          <textarea className="input min-h-20" value={desc} maxLength={500} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Stinging for a few minutes after applying" />
        </label>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">How severe?</legend>
          <div className="flex gap-2">
            {['Mild', 'Moderate', 'Severe'].map((l, n) => (
              <label key={l} className={`chip cursor-pointer ${sev === n + 1 ? (n === 2 ? 'border-alarm bg-alarm text-porcelain' : 'border-forest bg-forest text-ivory') : ''}`}>
                <input type="radio" name="sev" className="sr-only" checked={sev === n + 1} onChange={() => setSev(n + 1)} />
                {l}
              </label>
            ))}
          </div>
          {sev === 3 && <p className="mt-2 text-sm text-alarm">For a severe reaction, stop using the product and contact a doctor or pharmacist. For breathing difficulty or facial swelling, call 112.</p>}
        </fieldset>
        {err && <ErrorNote error={err} />}
        <button className="btn btn-primary">Save reaction</button>
      </form>
      {item.reactions.length > 0 && (
        <div>
          <h3 className="mb-2 font-sans text-sm font-semibold">Earlier reactions</h3>
          <ul className="space-y-2 text-sm">
            {item.reactions.map((r) => (
              <li key={r.id} className="flex justify-between gap-3 rounded border border-line p-2.5">
                <span>
                  “{r.description}” <span className="meta">{fmtDate(r.created_at)} · {r.severity}/3</span>
                </span>
                <button
                  className="text-xs text-alarm underline"
                  onClick={async () => {
                    await api.deleteReaction(item.id, r.id)
                    bump()
                    onDone()
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default function Routine() {
  const toast = useToast()
  const { bump } = useRefresh()
  const loc = useLocation()
  const [params, setParams] = useSearchParams()
  const { data, error, loading, reload } = useApi(() => api.routines())
  const changes = useApi(() => api.routineChanges())
  const [editing, setEditing] = useState<{ id?: number; initial: RoutineItemInput } | null>(null)
  const [reacting, setReacting] = useState<RoutineItem | null>(null)
  const [deleting, setDeleting] = useState<RoutineItem | null>(null)

  // Prefill from the Product Library (?add=<libraryId>)
  useEffect(() => {
    const add = params.get('add')
    if (!add) return
    api.products().then((ps) => {
      const p = ps.find((x) => x.id === Number(add))
      if (p)
        setEditing({
          initial: {
            ...EMPTY_ITEM,
            name: p.name,
            brand: p.brand,
            category: p.category,
            slot: p.category === 'sunscreen' ? 'am' : ['treatment', 'exfoliant'].includes(p.category) ? 'pm' : 'both',
            actives: p.key_actives,
            instructions: p.instructions,
            library_product_id: p.id,
          },
        })
      params.delete('add')
      setParams(params, { replace: true })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!data || !loc.hash) return
    setTimeout(() => document.querySelector(loc.hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150)
  }, [data, loc.hash])

  const items = data?.items ?? []
  const comp = data?.compatibility
  const flaggedIds = new Set((comp?.findings ?? []).filter((f) => f.severity === 'documented_concern' || f.severity === 'precaution').flatMap((f) => f.product_ids))
  const am = items.filter((i) => i.slot === 'am' || i.slot === 'both').sort((a, b) => a.step_order - b.step_order)
  const pm = items.filter((i) => i.slot === 'pm' || i.slot === 'both').sort((a, b) => a.step_order - b.step_order)

  async function toggle(i: RoutineItem) {
    try {
      await api.updateItem(i.id, { ...toInput(i), paused: !i.paused })
      toast(i.paused ? `${i.name} resumed` : `${i.name} paused`)
      bump()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  return (
    <div>
      <PageHeader
        title="My Routine"
        intro="Record what you use, when you started, and how often. Every change is logged so it can be placed on your progress timeline."
        actions={
          <button className="btn btn-primary" onClick={() => setEditing({ initial: { ...EMPTY_ITEM } })}>
            <Plus className="size-4" /> Add a product
          </button>
        }
      />

      {error && <ErrorNote error={error} onRetry={reload} />}
      {loading && !data && <Skeleton className="h-64" />}

      {data && items.length === 0 && (
        <EmptyState
          art={<Contour className="h-28 w-36 text-sage" rings={6} seed={9} />}
          title="Your routine is empty"
          body="Add the products you use now — even the simple ones. Start dates matter: they let DermaTrack line up routine changes with your scans."
          action={
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-primary" onClick={() => setEditing({ initial: { ...EMPTY_ITEM } })}>
                Add my first product
              </button>
              <Link to="/app/library" className="btn btn-ghost">
                Pick from the library
              </Link>
            </div>
          }
        />
      )}

      {data && items.length > 0 && (
        <div className="space-y-14">
          <div className="grid gap-8 lg:grid-cols-2">
            {[
              { title: 'Morning', icon: Sun, list: am },
              { title: 'Evening', icon: Moon, list: pm },
            ].map(({ title, icon: Icon, list }) => (
              <section key={title} aria-label={`${title} routine`}>
                <SectionTitle aside={<span className="text-sm text-grey">{list.filter((i) => !i.paused).length} active</span>}>
                  <span className="flex items-center gap-2">
                    <Icon className="size-5 text-forest" aria-hidden /> {title}
                  </span>
                </SectionTitle>
                {list.length === 0 ? (
                  <p className="rounded-[6px] border border-dashed border-line p-5 text-sm text-grey">Nothing in your {title.toLowerCase()} routine.</p>
                ) : (
                  <ol className="space-y-3">
                    {list.map((i) => (
                      <ItemRow
                        key={`${title}-${i.id}`}
                        i={i}
                        flagged={flaggedIds.has(i.id)}
                        onEdit={() => setEditing({ id: i.id, initial: toInput(i) })}
                        onToggle={() => toggle(i)}
                        onDelete={() => setDeleting(i)}
                        onReact={() => setReacting(i)}
                      />
                    ))}
                  </ol>
                )}
              </section>
            ))}
          </div>

          {comp && (
            <section id="compatibility" className="scroll-mt-24">
              <SectionTitle>Compatibility checks</SectionTitle>
              <p className="mb-4 max-w-2xl font-serif text-[1.35rem] leading-snug">{comp.summary}</p>
              <div className="mb-5 flex flex-wrap gap-4 text-sm text-grey">
                <span>{comp.evaluated_products} of {comp.total_active_products} active products evaluated</span>
                {comp.paused_products > 0 && <span>{comp.paused_products} paused product(s) excluded</span>}
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {comp.findings.map((f) => (
                  <FindingCard key={f.rule_id + f.product_ids.join()} f={f} />
                ))}
              </div>
              {comp.unrecognised_ingredients.length > 0 && (
                <p className="mt-4 text-sm text-grey">
                  Not recognised by the rules engine, so not checked: {comp.unrecognised_ingredients.map((u) => `${u.ingredient} (${u.product_name})`).join(', ')}.
                </p>
              )}
              <p className="mt-4 max-w-3xl text-xs text-grey">{comp.disclaimer}</p>
            </section>
          )}

          <section>
            <SectionTitle>What changed between your last two check-ins</SectionTitle>
            {changes.data?.from ? (
              <>
                <p className="mb-3 text-sm text-grey">
                  {fmtDate(changes.data.from.at)} to {fmtDate(changes.data.to!.at)}
                </p>
                {changes.data.events.length ? (
                  <ul className="divide-y divide-line rounded-[6px] border border-line bg-porcelain">
                    {changes.data.events.map((e) => (
                      <li key={e.id} className="flex flex-wrap justify-between gap-2 px-4 py-3 text-sm">
                        <span>
                          <span className="font-medium">{cap(e.kind)}</span> {e.item_name}
                          {e.detail && <span className="text-grey"> — {e.detail}</span>}
                        </span>
                        <span className="meta">{fmtDate(e.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-grey">{changes.data.message}</p>
                )}
              </>
            ) : (
              <p className="text-sm text-grey">
                {changes.data?.message ?? 'Loading…'} <Link to="/app/progress#checkin" className="text-forest underline">Check in</Link>
              </p>
            )}
          </section>
        </div>
      )}

      <Drawer open={!!editing} wide title={editing?.id ? 'Edit product' : 'Add a product'} onClose={() => setEditing(null)}>
        {editing && (
          <ProductForm
            initial={editing.initial}
            existing={items}
            editingId={editing.id}
            onCancel={() => setEditing(null)}
            onSaved={(i) => {
              toast(editing.id ? 'Changes saved' : `${i.name} added to your routine`)
              setEditing(null)
              bump()
            }}
          />
        )}
      </Drawer>
      <Drawer open={!!reacting} title={reacting ? `Reaction: ${reacting.name}` : ''} onClose={() => setReacting(null)}>
        {reacting && <ReactionForm item={reacting} onDone={() => setReacting(null)} />}
      </Drawer>
      <Confirm
        open={!!deleting}
        danger
        title={`Remove ${deleting?.name}?`}
        body="It will be removed from your routine. The removal is kept on your timeline. If you might use it again, pausing is usually better."
        confirmLabel="Remove"
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          try {
            await api.deleteItem(deleting!.id)
            toast('Removed')
            bump()
          } catch (e) {
            toast((e as Error).message, 'error')
          }
          setDeleting(null)
        }}
      />
    </div>
  )
}
