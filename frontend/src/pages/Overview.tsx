import { ArrowUpRight, CalendarCheck, ScanFace } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Contour } from '../components/charts/Contour'
import GuidanceCard from '../components/GuidanceCard'
import { EmptyState, ErrorNote, SectionTitle, SeverityBadge, Skeleton, SourceBadge } from '../components/ui'
import { cap, fmtDate, fmtDateTime, fmtShort, relativeDays } from '../lib/format'
import { useApi } from '../lib/hooks'
import { api, type RoutineItem } from '../services/api'

function RoutineColumn({ title, items }: { title: string; items: RoutineItem[] }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-grey">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-grey">Nothing recorded.</p>
      ) : (
        <ol className="space-y-1.5">
          {items.map((i, n) => (
            <li key={i.id} className="flex items-baseline gap-2 text-sm">
              <span className="meta w-4">{n + 1}</span>
              <span className="truncate">{i.name}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

export default function Overview() {
  const { data, error, loading, reload } = useApi(() => api.overview())

  if (loading && !data)
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-2/3" />
        <div className="grid gap-6 md:grid-cols-3">
          <Skeleton className="h-48 md:col-span-2" />
          <Skeleton className="h-48" />
        </div>
      </div>
    )
  if (error) return <ErrorNote error={error} onRetry={reload} />
  if (!data) return null

  const name = data.profile.display_name
  const scan = data.latest_scan
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const isEmpty = !scan && data.routine.total === 0 && data.recent_checkins.length === 0
  const lowest = scan
    ? [...scan.metrics].filter((m) => m.region == null || m.region === 'whole').sort((a, b) => (a.raw_score ?? 0) - (b.raw_score ?? 0)).slice(0, 4)
    : []
  const due = new Date(data.guidance.next_checkin_due)
  const urgent = data.guidance.cards.filter((c) => c.level === 'urgent' || c.level === 'caution')

  return (
    <div>
      <header className="mb-10 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-grey">{greeting}{name ? `, ${name}` : ''}.</p>
          <h1 className="mt-1 max-w-2xl text-[1.95rem] md:text-[2.9rem]">
            {isEmpty ? 'Let’s set your baseline.' : data.trend.summary.headline}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/app/analysis" className="btn btn-primary">
            <ScanFace className="size-4" /> Start a new scan
          </Link>
          <Link to="/app/routine" className="btn btn-ghost">
            Review my routine
          </Link>
        </div>
      </header>

      {data.analysis_source === 'dev_fixture' && (
        <p className="mb-6 rounded-[6px] border border-ochre/30 bg-ochre-pale/50 px-4 py-3 text-sm">
          Development mode: no YouCam API key is configured, so new scans use YouCam’s published sample response instead of analysing your photo.
        </p>
      )}

      {isEmpty ? (
        <EmptyState
          art={<Contour className="h-32 w-40 text-sage" rings={7} seed={3} accentIndex={2} />}
          title="No scans yet"
          body="Your first scan becomes the baseline every later scan is compared to. It takes about a minute. You can also add the products you use now, so later changes can be placed on your timeline."
          action={
            <div className="flex flex-wrap gap-2">
              <Link to="/app/analysis" className="btn btn-primary">
                Take my first scan
              </Link>
              <Link to="/app/routine" className="btn btn-ghost">
                Add my products
              </Link>
              <Link to="/app/settings#demo" className="btn btn-quiet">
                Explore with demonstration data
              </Link>
            </div>
          }
        />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1.6fr_1fr]">
          <div className="space-y-8">
            {urgent.length > 0 && (
              <section aria-label="Needs attention" className="space-y-3">
                {urgent.map((c) => (
                  <GuidanceCard key={c.id} card={c} compact />
                ))}
              </section>
            )}

            {/* Latest scan */}
            <section className="panel p-6">
              <SectionTitle aside={scan && <Link to={`/app/progress?scan=${scan.id}`} className="text-sm text-forest underline-offset-2 hover:underline">Full results</Link>}>
                Latest scan
              </SectionTitle>
              {scan ? (
                <>
                  <div className="flex flex-wrap items-center gap-3 text-sm text-grey">
                    <SourceBadge source={scan.source} />
                    <span className="meta">{fmtDateTime(scan.created_at)}</span>
                    <span>({relativeDays(scan.created_at)})</span>
                  </div>
                  <div className="mt-5 grid gap-6 sm:grid-cols-[auto_1fr]">
                    <div>
                      <div className="text-sm text-grey">Overall</div>
                      <div className="font-serif text-6xl leading-none">{scan.overall_score != null ? scan.overall_score.toFixed(0) : '—'}</div>
                      <div className="mt-1 text-xs text-grey">YouCam score, 1–100</div>
                    </div>
                    <div>
                      <div className="mb-2 text-sm text-grey">Lowest measurements this scan</div>
                      <ul className="space-y-2">
                        {lowest.map((m) => (
                          <li key={m.key} className="grid grid-cols-[6.5rem_1fr_3rem] items-center gap-3 text-sm">
                            <span>{m.label}</span>
                            <span className="h-1.5 rounded-full bg-sage-pale">
                              <span className="block h-full rounded-full bg-rose" style={{ width: `${m.raw_score}%` }} />
                            </span>
                            <span className="meta text-right">{m.raw_score?.toFixed(1)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-grey">No scans yet. <Link className="text-forest underline" to="/app/analysis">Take your first scan</Link> to set a baseline.</p>
              )}
            </section>

            {/* Trend */}
            <section className="panel p-6">
              <SectionTitle aside={<Link to="/app/progress" className="text-sm text-forest underline-offset-2 hover:underline">My Progress</Link>}>
                Overall score, last 30 days
              </SectionTitle>
              {data.trend.overall.length >= 2 ? (
                <div className="h-44" role="img" aria-label={`Overall score across ${data.trend.overall.length} scans`}>
                  <ResponsiveContainer>
                    <LineChart data={data.trend.overall.map((p) => ({ ...p, d: fmtShort(p.at) }))} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                      <XAxis dataKey="d" tick={{ fontSize: 11, fill: '#79796F' }} axisLine={{ stroke: '#E8E4DB' }} tickLine={false} />
                      <YAxis domain={[(m: number) => Math.floor(m - 4), (m: number) => Math.ceil(m + 4)]} allowDecimals={false} tickFormatter={(v) => String(Math.round(Number(v)))} tick={{ fontSize: 11, fill: '#79796F' }} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(v) => [Number(v).toFixed(1), 'Overall']} contentStyle={{ borderRadius: 6, border: '1px solid #E8E4DB', fontSize: 13 }} />
                      <Line type="monotone" dataKey="value" stroke="#243D32" strokeWidth={1.8} dot={{ r: 3.5, fill: '#FFFDF9', strokeWidth: 1.6 }} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-grey">A trend needs at least two comparable scans in the last 30 days.</p>
              )}
              {data.trend.summary.uncertain.length > 0 && (
                <ul className="mt-4 space-y-1 border-t border-line pt-4 text-sm text-grey">
                  {data.trend.summary.uncertain.map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              )}
            </section>

            {/* Alerts */}
            <section>
              <SectionTitle aside={<Link to="/app/routine#compatibility" className="text-sm text-forest underline-offset-2 hover:underline">All checks</Link>}>
                Ingredient alerts
              </SectionTitle>
              {data.alerts.length === 0 ? (
                <p className="text-sm text-grey">{data.routine.total ? 'No documented concerns or precautions in your current routine.' : 'Add products to your routine to check ingredient combinations.'}</p>
              ) : (
                <ul className="divide-y divide-line rounded-[6px] border border-line bg-porcelain">
                  {data.alerts.map((f) => (
                    <li key={f.rule_id + f.product_ids.join()} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="font-medium">{f.title}</div>
                        <div className="text-sm text-grey">{f.product_names.join(' + ')}</div>
                      </div>
                      <SeverityBadge s={f.severity} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <aside className="space-y-8">
            <section className="rounded-[6px] bg-forest p-6 text-ivory">
              <CalendarCheck className="size-5 text-rose" aria-hidden />
              <div className="mt-3 text-sm text-ivory/70">Next suggested check-in</div>
              <div className="font-serif text-3xl">{fmtDate(data.guidance.next_checkin_due, { day: 'numeric', month: 'long' })}</div>
              <div className="text-sm text-ivory/70">{due <= new Date() ? 'Due now' : relativeDays(data.guidance.next_checkin_due)}</div>
              <Link to="/app/progress#checkin" className="btn mt-4 bg-ivory text-forest hover:bg-porcelain">
                Check in now
              </Link>
            </section>

            <section className="panel p-6">
              <SectionTitle aside={<Link to="/app/routine" aria-label="Open routine"><ArrowUpRight className="size-4 text-forest" /></Link>}>Current routine</SectionTitle>
              <div className="grid grid-cols-2 gap-4">
                <RoutineColumn title="Morning" items={data.routine.am} />
                <RoutineColumn title="Evening" items={data.routine.pm} />
              </div>
              {data.routine.paused.length > 0 && <p className="mt-4 text-sm text-grey">Paused: {data.routine.paused.map((p) => p.name).join(', ')}</p>}
            </section>

            <section>
              <SectionTitle>Recent routine changes</SectionTitle>
              {data.recent_changes.length === 0 ? (
                <p className="text-sm text-grey">No changes recorded yet.</p>
              ) : (
                <ol className="relative space-y-4 border-l border-line pl-5">
                  {data.recent_changes.map((e) => (
                    <li key={e.id} className="relative">
                      <span className="absolute -left-[25px] top-1.5 size-2.5 rounded-full border border-forest bg-porcelain" aria-hidden />
                      <div className="text-sm">
                        <span className="font-medium">{cap(e.kind)}</span> {e.item_name}
                      </div>
                      <div className="meta">{fmtDate(e.created_at)}</div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section>
              <SectionTitle>What you’ve reported</SectionTitle>
              {data.recent_checkins.length === 0 && data.recent_reactions.length === 0 ? (
                <p className="text-sm text-grey">No check-ins or reactions yet.</p>
              ) : (
                <ul className="space-y-3 text-sm">
                  {data.recent_reactions.map((r) => (
                    <li key={r.created_at + r.item_id} className="rounded-[6px] border border-line bg-porcelain p-3">
                      <div className="font-medium">{r.item_name}</div>
                      <div>“{r.description}”</div>
                      <div className="meta mt-1">
                        {fmtDate(r.created_at)} · severity {r.severity}/3
                      </div>
                    </li>
                  ))}
                  {data.recent_checkins.map((c) => {
                    const s = Object.entries(c.symptoms).filter(([, v]) => v > 0)
                    return (
                      <li key={c.id} className="rounded-[6px] border border-line bg-porcelain p-3">
                        <div>{s.length ? s.map(([k, v]) => `${k} ${v}/3`).join(', ') : 'No symptoms reported'}</div>
                        {c.notes && <div className="text-grey">{c.notes}</div>}
                        <div className="meta mt-1">Check-in {fmtDate(c.created_at)}</div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </aside>
        </div>
      )}
    </div>
  )
}
