import { Check, CircleHelp, Plus, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Drawer, ErrorNote, PageHeader, SectionTitle, Skeleton } from '../components/ui'
import { CATEGORIES, cap } from '../lib/format'
import { useApi, useRefresh, useToast } from '../lib/hooks'
import { api, ApiError, type LibraryProduct } from '../services/api'

function ProductDetail({ p, onAdd, onDelete }: { p: LibraryProduct; onAdd: () => void; onDelete?: () => void }) {
  return (
    <div className="space-y-5 text-sm">
      <div>
        <div className="text-grey">{p.brand}</div>
        <div className="font-serif text-2xl">{p.name}</div>
        <div className="mt-1 text-grey">{cap(p.category)}</div>
      </div>
      <dl className="grid gap-3 sm:grid-cols-[9rem_1fr]">
        <dt className="text-grey">Key actives</dt>
        <dd>{p.key_actives.length ? p.key_actives.map((a) => `${a.name}${a.concentration_percent != null ? ` ${a.concentration_percent}%` : ''}`).join(', ') : 'None stated'}</dd>
        <dt className="text-grey">Full ingredient list</dt>
        <dd>{p.full_ingredients.length ? p.full_ingredients.join(', ') : 'Not verified — check the product label.'}</dd>
        <dt className="text-grey">Marketed for</dt>
        <dd>{p.attributes.length ? p.attributes.join(', ') : '—'}</dd>
        <dt className="text-grey">Fragrance-free</dt>
        <dd>{p.fragrance_free == null ? 'Not verified' : p.fragrance_free ? 'Marketed as fragrance-free' : 'Contains fragrance'}</dd>
        <dt className="text-grey">Price</dt>
        <dd>{p.price != null ? `${p.price} ${p.currency} (${p.price_source})` : 'Not listed — not verified'}</dd>
        <dt className="text-grey">Directions</dt>
        <dd>{p.instructions || '—'}</dd>
        <dt className="text-grey">Source</dt>
        <dd>{p.source || '—'}</dd>
      </dl>
      <p className="rounded bg-ochre-pale/50 p-3">{p.limitations}</p>
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" onClick={onAdd}>
          <Plus className="size-4" /> Add to my routine
        </button>
        {onDelete && (
          <button className="btn btn-danger" onClick={onDelete}>
            Delete from library
          </button>
        )}
      </div>
    </div>
  )
}

function AddProductForm({ onDone }: { onDone: () => void }) {
  const toast = useToast()
  const { bump } = useRefresh()
  const [f, setF] = useState({ name: '', brand: '', category: 'serum', actives: '', price: '', currency: 'INR', price_source: '', fragrance_free: '', instructions: '' })
  const [err, setErr] = useState<ApiError | null>(null)
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault()
        try {
          await api.addProduct({
            name: f.name,
            brand: f.brand,
            category: f.category,
            key_actives: f.actives.split(',').map((s) => s.trim()).filter(Boolean).map((name) => ({ name })),
            price: f.price === '' ? null : Number(f.price),
            currency: f.price === '' ? null : f.currency,
            price_source: f.price_source,
            fragrance_free: f.fragrance_free === '' ? null : f.fragrance_free === 'yes',
            instructions: f.instructions,
          })
          toast('Added to the library')
          bump()
          onDone()
        } catch (x) {
          setErr(x as ApiError)
        }
      }}
    >
      <p className="text-sm text-grey">Add a product you’ve checked yourself. It’ll be marked as user-entered and unverified.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field">
          <span>Name</span>
          <input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <label className="field">
          <span>Brand</span>
          <input className="input" required value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} />
        </label>
        <label className="field">
          <span>Category</span>
          <select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {cap(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Fragrance-free?</span>
          <select className="input" value={f.fragrance_free} onChange={(e) => setF({ ...f, fragrance_free: e.target.value })}>
            <option value="">Don’t know</option>
            <option value="yes">Yes, per the label</option>
            <option value="no">No, contains fragrance</option>
          </select>
        </label>
        <label className="field sm:col-span-2">
          <span>
            Key actives <span className="hint">(comma-separated, from the label)</span>
          </span>
          <input className="input" value={f.actives} onChange={(e) => setF({ ...f, actives: e.target.value })} placeholder="niacinamide, zinc pca" />
        </label>
        <label className="field">
          <span>
            Price you saw <span className="hint">(optional)</span>
          </span>
          <input className="input" type="number" min={0} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
        </label>
        <label className="field">
          <span>Currency</span>
          <input className="input uppercase" maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} />
        </label>
        <label className="field sm:col-span-2">
          <span>Where you saw that price</span>
          <input className="input" value={f.price_source} onChange={(e) => setF({ ...f, price_source: e.target.value })} placeholder="e.g. Local pharmacy, 20 Oct 2026" />
        </label>
      </div>
      {err && <ErrorNote error={err} />}
      <button className="btn btn-primary">Add to library</button>
    </form>
  )
}

export default function Library() {
  const nav = useNavigate()
  const toast = useToast()
  const { bump } = useRefresh()
  const recs = useApi(() => api.recommendations())
  const lib = useApi(() => api.products())
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [open, setOpen] = useState<LibraryProduct | null>(null)
  const [adding, setAdding] = useState(false)

  const filtered = useMemo(
    () =>
      (lib.data ?? []).filter(
        (p) => (cat === 'all' || p.category === cat) && `${p.brand} ${p.name} ${p.key_actives.map((a) => a.name).join(' ')}`.toLowerCase().includes(q.toLowerCase()),
      ),
    [lib.data, q, cat],
  )
  const cats = Array.from(new Set((lib.data ?? []).map((p) => p.category)))
  const r = recs.data

  return (
    <div>
      <PageHeader
        title="Product Library"
        intro="A small, honest library. Matches explain themselves — and often the best match is nothing new at all."
        actions={
          <button className="btn btn-ghost" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add a product you’ve checked
          </button>
        }
      />

      <section className="mb-14">
        {recs.error && <ErrorNote error={recs.error} onRetry={recs.reload} />}
        {recs.loading && !r && <Skeleton className="h-40" />}
        {r && (
          <>
            <div className="mb-6 grid gap-6 md:grid-cols-[1.2fr_1fr]">
              <div>
                <h2 className="text-[2rem]">{r.headline}</h2>
                {r.simplify_first && (
                  <ul className="mt-3 space-y-1.5 text-[0.95rem]">
                    {r.simplify_reasons.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                )}
                {r.simplify_first && (
                  <p className="mt-4 text-sm">
                    <Link to="/app/routine#compatibility" className="text-forest underline">
                      Review your routine
                    </Link>{' '}
                    first. {r.gaps.length > 0 ? 'Only essential gaps are shown below.' : 'Nothing is recommended while your routine settles.'}
                  </p>
                )}
              </div>
              <div className="rounded-[6px] border border-line bg-porcelain p-5 text-sm">
                <div className="font-semibold">What matching is based on</div>
                {r.focus.length ? (
                  <ul className="mt-2 space-y-1 text-charcoal/80">
                    {r.focus.map((f) => (
                      <li key={f.tag}>
                        <span className="font-medium">{f.tag}</span>: {f.why}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-grey">No scan or goals yet, so only routine gaps are considered.</p>
                )}
                {r.focus_notes.map((n) => (
                  <p key={n} className="mt-2 text-grey">
                    {n}
                  </p>
                ))}
                {r.based_on_scan && r.based_on_scan.source !== 'youcam' && <p className="mt-2 text-ochre">Based on a {r.based_on_scan.source === 'demo_sample' ? 'demonstration' : 'development-fixture'} scan.</p>}
              </div>
            </div>

            {r.matches.length === 0 ? (
              <p className="rounded-[6px] border border-dashed border-line p-6 text-grey">No matches to show. That’s fine — your existing products may already be enough.</p>
            ) : (
              <ol className="grid gap-4 md:grid-cols-2">
                {r.matches.map((m) => (
                  <li key={m.product.id} className="panel flex flex-col p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm text-grey">{m.product.brand}</div>
                        <h3 className="font-serif text-xl">{m.product.name}</h3>
                      </div>
                      <span className="meta" title="Match score — see method below">
                        score {m.score}
                      </span>
                    </div>
                    <ul className="mt-3 space-y-1 text-sm">
                      {m.reasons.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                    <ul className="mt-3 space-y-1 text-sm">
                      {m.checks.map((c) => (
                        <li key={c.label} className="flex gap-2">
                          {c.ok ? <Check className="mt-0.5 size-4 shrink-0 text-forest" /> : <X className="mt-0.5 size-4 shrink-0 text-ochre" />}
                          {c.label}
                        </li>
                      ))}
                      {m.missing_information.map((x) => (
                        <li key={x} className="flex gap-2 text-grey">
                          <CircleHelp className="mt-0.5 size-4 shrink-0" /> {x}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-auto flex gap-2 pt-4">
                      <button className="btn btn-ghost" onClick={() => setOpen(m.product)}>
                        Details
                      </button>
                      <button className="btn btn-quiet" onClick={() => nav(`/app/routine?add=${m.product.id}`)}>
                        Add to my routine
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {r.excluded.length > 0 && (
              <details className="mt-4 text-sm text-grey">
                <summary className="cursor-pointer">{r.excluded.length} product(s) left out</summary>
                <ul className="mt-2 space-y-1">
                  {r.excluded.map((x) => (
                    <li key={x.id}>
                      {x.name}: {x.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <p className="mt-4 max-w-3xl text-xs text-grey">{r.method}</p>
          </>
        )}
      </section>

      <section>
        <SectionTitle>All products</SectionTitle>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-grey" aria-hidden />
            <input className="input pl-9" placeholder="Search by name, brand or ingredient" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />
          </label>
          <select className="input sm:w-48" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
            <option value="all">All categories</option>
            {cats.map((c) => (
              <option key={c} value={c}>
                {cap(c)}
              </option>
            ))}
          </select>
        </div>
        {lib.error && <ErrorNote error={lib.error} onRetry={lib.reload} />}
        {lib.loading && !lib.data ? (
          <Skeleton className="h-60" />
        ) : filtered.length === 0 ? (
          <p className="text-grey">No products match that search.</p>
        ) : (
          <ul className="divide-y divide-line rounded-[6px] border border-line bg-porcelain">
            {filtered.map((p) => (
              <li key={p.id}>
                <button className="grid w-full gap-1 px-4 py-3 text-left hover:bg-ivory sm:grid-cols-[1fr_9rem_12rem] sm:items-center" onClick={() => setOpen(p)}>
                  <span>
                    <span className="font-medium">{p.name}</span> <span className="text-grey">— {p.brand}</span>
                    {p.user_added && <span className="chip ml-2 text-[0.7rem]">added by you</span>}
                  </span>
                  <span className="text-sm text-grey">{cap(p.category)}</span>
                  <span className="truncate text-sm text-grey">{p.key_actives.map((a) => a.name).join(', ') || '—'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-grey">Curated products list only the actives named on the product. Prices aren’t shown because we haven’t verified them. No product has paid for placement.</p>
      </section>

      <Drawer open={!!open} title="Product details" onClose={() => setOpen(null)}>
        {open && (
          <ProductDetail
            p={open}
            onAdd={() => nav(`/app/routine?add=${open.id}`)}
            onDelete={
              open.user_added
                ? async () => {
                    try {
                      await api.deleteProduct(open.id)
                      toast('Deleted')
                      setOpen(null)
                      bump()
                    } catch (e) {
                      toast((e as Error).message, 'error')
                    }
                  }
                : undefined
            }
          />
        )}
      </Drawer>
      <Drawer open={adding} title="Add a product" onClose={() => setAdding(false)}>
        <AddProductForm onDone={() => setAdding(false)} />
      </Drawer>
    </div>
  )
}
