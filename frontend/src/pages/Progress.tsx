import { ClipboardCheck, FlaskConical, ScanFace, Table2, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import CheckInForm from '../components/CheckInForm'
import GuidanceCard from '../components/GuidanceCard'
import ScanResults from '../components/ScanResults'
import { Confirm, Drawer, EmptyState, ErrorNote, PageHeader, SectionTitle, Skeleton, SourceBadge, Spinner } from '../components/ui'
import { Contour } from '../components/charts/Contour'
import { fmtDate, fmtDateTime, fmtShort, signed } from '../lib/format'
import { useApi, useRefresh, useToast } from '../lib/hooks'
import { api, type Analysis, type Comparison } from '../services/api'

const WINDOWS: { label: string; days: number | null }[] = [
  { label: '7 days', days: 7 },
  { label: '14 days', days: 14 },
  { label: '30 days', days: 30 },
  { label: 'All time', days: null },
]

const STATUS = {
  more_favourable: { label: 'More favourable', cls: 'text-forest' },
  less_favourable: { label: 'Less favourable', cls: 'text-alarm' },
  no_clear_change: { label: 'No clear change', cls: 'text-grey' },
}

function ComparisonTable({ c }: { c: Comparison }) {
  if (!c.comparable) return <p className="rounded-[6px] border border-ochre/30 bg-ochre-pale/50 p-4 text-sm">{c.reason}</p>
  return (
    <div>
      <p className="mb-3 text-sm text-grey">
        {fmtDate(c.baseline_at)} to {fmtDate(c.current_at)} · {c.days_between} days apart
      </p>
      <div className="overflow-x-auto rounded-[6px] border border-line bg-porcelain">
        <table className="w-full min-w-[34rem] text-sm">
          <caption className="sr-only">Change in raw AI scores between two scans</caption>
          <thead className="border-b border-line text-left text-grey">
            <tr>
              <th className="px-4 py-2.5 font-medium">Measurement</th>
              <th className="px-3 py-2.5 text-right font-medium">Earlier</th>
              <th className="px-3 py-2.5 text-right font-medium">Later</th>
              <th className="px-3 py-2.5 text-right font-medium">Change</th>
              <th className="px-3 py-2.5 text-right font-medium">Relative</th>
              <th className="px-4 py-2.5 font-medium">Reading</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {c.metrics.map((r) => (
              <tr key={r.canonical}>
                <th scope="row" className="px-4 py-2.5 text-left font-normal">
                  {r.label}
                </th>
                <td className="px-3 py-2.5 text-right font-mono">{r.baseline_raw.toFixed(1)}</td>
                <td className="px-3 py-2.5 text-right font-mono">{r.current_raw.toFixed(1)}</td>
                <td className={`px-3 py-2.5 text-right font-mono ${STATUS[r.status].cls}`}>{signed(r.delta_points)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-grey">{r.relative_change_percent != null ? `${signed(r.relative_change_percent)}%` : '—'}</td>
                <td className={`px-4 py-2.5 ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(c.condition_differences?.length ?? 0) > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-ochre">
          {c.condition_differences!.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function Progress() {
  const toast = useToast()
  const { bump } = useRefresh()
  const loc = useLocation()
  const [params, setParams] = useSearchParams()
  const [days, setDays] = useState<number | null>(30)
  const prog = useApi(() => api.progress(days), [days])
  const history = useApi(() => api.history())
  const guidance = useApi(() => api.guidance())
  const [metric, setMetric] = useState<string | null>(null)
  const [showTable, setShowTable] = useState(false)
  const [pair, setPair] = useState<[number | null, number | null]>([null, null])
  const [cmp, setCmp] = useState<Comparison | null>(null)
  const [cmpErr, setCmpErr] = useState<Error | null>(null)
  const [viewing, setViewing] = useState<Analysis | null>(null)
  const [toDelete, setToDelete] = useState<Analysis | null>(null)

  const scanParam = params.get('scan')
  useEffect(() => {
    if (!scanParam) return
    api.analysis(Number(scanParam)).then(setViewing).catch(() => toast('That scan no longer exists.', 'error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanParam])

  useEffect(() => {
    if (loc.hash === '#checkin') setTimeout(() => document.getElementById('checkin')?.scrollIntoView({ behavior: 'smooth' }), 200)
  }, [loc.hash])

  const p = prog.data
  const series = p?.series ?? []
  const active = series.find((s) => s.canonical === metric) ?? series[0]

  useEffect(() => {
    // Default to the same comparable pair the summary uses; fall back to oldest vs newest.
    const h = history.data
    if (pair[0] != null || !h || h.length < 2) return
    const c = prog.data?.comparison
    if (c?.comparable) setPair([c.baseline_id, c.current_id])
    else if (prog.data) setPair([h[h.length - 1].id, h[0].id])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.data, prog.data])

  useEffect(() => {
    if (pair[0] == null || pair[1] == null || pair[0] === pair[1]) return setCmp(null)
    setCmpErr(null)
    api.compare(pair[0], pair[1]).then(setCmp).catch(setCmpErr)
  }, [pair, prog.data])

  const chartData = useMemo(() => {
    if (!active) return []
    return active.points.map((pt) => ({ t: new Date(pt.at).getTime(), raw: pt.raw, ui: pt.ui, id: pt.analysis_id }))
  }, [active])
  const routineMarks = useMemo(() => (p?.timeline ?? []).filter((e) => e.kind === 'routine').map((e) => ({ t: new Date(e.at).getTime(), title: e.title })), [p])
  const baseline = chartData[0]?.raw
  const band = p?.method.noise_band_points ?? 3
  const tMin = chartData.length ? Math.min(chartData[0].t, ...routineMarks.map((r) => r.t)) : 0
  const tMax = chartData.length ? Math.max(chartData[chartData.length - 1].t, ...routineMarks.map((r) => r.t)) : 0

  const noScans = (history.data?.length ?? 0) === 0

  return (
    <div>
      <PageHeader
        title="My Progress"
        intro="Your scans, check-ins and routine changes on one timeline. Changes are in YouCam’s raw AI measurements, compared only between scans taken the same way."
        actions={
          <div role="tablist" aria-label="Time window" className="inline-flex rounded-full border border-line bg-porcelain p-0.5 text-sm">
            {WINDOWS.map((w) => (
              <button key={w.label} role="tab" aria-selected={days === w.days} onClick={() => setDays(w.days)} className={`rounded-full px-3 py-1.5 ${days === w.days ? 'bg-forest text-ivory' : 'text-grey hover:text-charcoal'}`}>
                {w.label}
              </button>
            ))}
          </div>
        }
      />

      {prog.error && <ErrorNote error={prog.error} onRetry={prog.reload} />}
      {prog.loading && !p && <Skeleton className="h-72" />}

      {p && (
        <div className="space-y-12">
          {noScans ? (
            <EmptyState
              art={<Contour className="h-28 w-36 text-sage" rings={6} seed={5} />}
              title="Your timeline starts with a baseline scan"
              body="Once you have a baseline, each later scan, check-in and routine change appears here in order."
              action={
                <Link to="/app/analysis" className="btn btn-primary">
                  Take my baseline scan
                </Link>
              }
            />
          ) : (
            <>
              {/* Summary */}
              <section className="grid gap-6 md:grid-cols-[1.3fr_1fr]">
                <div>
                  <p className="font-serif text-[1.7rem] leading-snug">{p.summary.headline}</p>
                  {p.summary.changed.length > 0 && (
                    <ul className="mt-4 space-y-1.5">
                      {p.summary.changed.map((c) => (
                        <li key={c} className="flex gap-2 text-[0.95rem]">
                          <span className="mt-2 size-1.5 shrink-0 rounded-full bg-forest" />
                          {c}
                        </li>
                      ))}
                    </ul>
                  )}
                  {p.group && p.group.data_class !== 'real' && (
                    <p className="mt-4 text-sm text-ochre">This view uses {p.group.data_class === 'demo' ? 'demonstration sample data' : 'development fixture data'}, not real measurements.</p>
                  )}
                  {p.excluded_scan_ids.length > 0 && <p className="mt-2 text-sm text-grey">{p.excluded_scan_ids.length} scan(s) in this window were left out because they used a different mode or data type.</p>}
                </div>
                <div className="rounded-[6px] border border-line bg-porcelain p-5">
                  <h2 className="font-sans text-sm font-semibold">What remains uncertain</h2>
                  {p.summary.uncertain.length ? (
                    <ul className="mt-2 space-y-1.5 text-sm text-charcoal/80">
                      {p.summary.uncertain.map((u) => (
                        <li key={u}>{u}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-grey">No confounding factors recorded.</p>
                  )}
                </div>
              </section>

              {/* Trend chart */}
              <section>
                <SectionTitle
                  aside={
                    <button className="btn btn-quiet text-sm" onClick={() => setShowTable((s) => !s)} aria-pressed={showTable}>
                      <Table2 className="size-4" /> {showTable ? 'Show chart' : 'Show as table'}
                    </button>
                  }
                >
                  Measurement trends
                </SectionTitle>
                {series.length === 0 ? (
                  <p className="text-grey">No scans in this window.</p>
                ) : (
                  <>
                    <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Measurement">
                      {series.map((s) => (
                        <button key={s.canonical} role="tab" aria-selected={active?.canonical === s.canonical} onClick={() => setMetric(s.canonical)} className={`chip ${active?.canonical === s.canonical ? 'border-forest bg-forest text-ivory' : 'hover:border-sage'}`}>
                          {s.label}
                        </button>
                      ))}
                    </div>
                    <div className="panel p-4 md:p-6">
                      {chartData.length < 2 && <p className="mb-3 text-sm text-grey">Only one scan in this window. Another scan is needed to show a trend.</p>}
                      {showTable ? (
                        <table className="w-full text-sm">
                          <caption className="sr-only">{active?.label} raw scores by scan</caption>
                          <thead className="text-left text-grey">
                            <tr>
                              <th className="py-1.5 font-medium">Scan</th>
                              <th className="py-1.5 font-medium">Date</th>
                              <th className="py-1.5 text-right font-medium">Raw</th>
                              <th className="py-1.5 text-right font-medium">Display</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line">
                            {chartData.map((d) => (
                              <tr key={d.id}>
                                <td className="py-1.5">#{d.id}</td>
                                <td className="py-1.5">{fmtDateTime(new Date(d.t).toISOString())}</td>
                                <td className="py-1.5 text-right font-mono">{d.raw.toFixed(1)}</td>
                                <td className="py-1.5 text-right font-mono">{d.ui ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="h-72" role="img" aria-label={`${active?.label} raw score over ${chartData.length} scans. Use “Show as table” for exact values.`}>
                          <ResponsiveContainer>
                            <LineChart data={chartData} margin={{ top: 28, right: 12, left: -18, bottom: 0 }}>
                              <CartesianGrid stroke="#E8E4DB" vertical={false} />
                              <XAxis dataKey="t" type="number" scale="time" domain={[tMin - 86400000, tMax + 86400000]} tickFormatter={(t) => fmtShort(new Date(t).toISOString())} tick={{ fontSize: 11, fill: '#79796F' }} axisLine={{ stroke: '#E8E4DB' }} tickLine={false} />
                              <YAxis domain={[(min: number) => Math.max(0, Math.floor(min - 8)), (max: number) => Math.min(100, Math.ceil(max + 8))]} tick={{ fontSize: 11, fill: '#79796F' }} axisLine={false} tickLine={false} />
                              {baseline != null && <ReferenceArea y1={baseline - band} y2={baseline + band} fill="#A8B7A0" fillOpacity={0.18} ifOverflow="visible" label={{ value: 'variation band around baseline', position: 'insideTopLeft', fontSize: 10, fill: '#243D32' }} />}
                              {routineMarks.map((r) => (
                                <ReferenceLine key={r.t + r.title} x={r.t} stroke="#D9A5A0" strokeDasharray="3 3" label={{ value: r.title.length > 26 ? r.title.slice(0, 25) + '…' : r.title, position: 'top', fontSize: 10, fill: '#262823' }} />
                              ))}
                              <Tooltip
                                labelFormatter={(t) => fmtDateTime(new Date(Number(t)).toISOString())}
                                formatter={(v, n) => [Number(v).toFixed(1), n === 'raw' ? 'Raw score' : 'Display score']}
                                contentStyle={{ borderRadius: 6, border: '1px solid #E8E4DB', fontSize: 13, background: '#FFFDF9' }}
                              />
                              <Line type="monotone" dataKey="raw" name="raw" stroke="#243D32" strokeWidth={2} dot={{ r: 4, fill: '#FFFDF9', strokeWidth: 1.8 }} activeDot={{ r: 6 }} isAnimationActive={false} />
                              <Line type="monotone" dataKey="ui" name="ui" stroke="#A8B7A0" strokeWidth={1.2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-grey">
                        <span className="flex items-center gap-1.5">
                          <i className="h-0.5 w-5 bg-forest" /> Raw score (used for comparisons)
                        </span>
                        <span className="flex items-center gap-1.5">
                          <i className="h-0 w-5 border-t border-dashed border-sage" /> Display score
                        </span>
                        <span className="flex items-center gap-1.5">
                          <i className="h-3 w-0 border-l border-dashed border-rose" /> Routine change
                        </span>
                        <span className="flex items-center gap-1.5">
                          <i className="h-2.5 w-4 bg-sage/30" /> ±{band} points of baseline
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </section>

              {/* Compare */}
              <section>
                <SectionTitle>Compare two scans</SectionTitle>
                {(history.data?.length ?? 0) < 2 ? (
                  <p className="text-grey">You need at least two scans to compare.</p>
                ) : (
                  <>
                    <div className="mb-4 grid max-w-xl gap-3 sm:grid-cols-2">
                      {(['Earlier scan', 'Later scan'] as const).map((label, idx) => (
                        <label key={label} className="field">
                          <span>{label}</span>
                          <select className="input" value={pair[idx] ?? ''} onChange={(e) => setPair((pp) => (idx === 0 ? [Number(e.target.value), pp[1]] : [pp[0], Number(e.target.value)]))}>
                            {history.data!.map((h) => (
                              <option key={h.id} value={h.id}>
                                #{h.id} · {fmtDateTime(h.created_at)}
                                {h.source !== 'youcam' ? ` (${h.source === 'demo_sample' ? 'demo' : 'fixture'})` : ''}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                    {pair[0] === pair[1] && <p className="text-sm text-grey">Choose two different scans.</p>}
                    {cmpErr && <ErrorNote error={cmpErr} />}
                    {cmp && <ComparisonTable c={cmp} />}
                  </>
                )}
                <details className="mt-4 max-w-3xl text-sm text-grey">
                  <summary className="cursor-pointer font-medium text-charcoal">How change is calculated</summary>
                  <div className="mt-2 space-y-2">
                    <p className="font-mono text-xs">{p.method.formula}</p>
                    <p>{p.method.direction} So a positive change means the AI measurement moved in the favourable direction.</p>
                    <p>{p.method.noise_band_note}</p>
                    <p>{p.method.label}</p>
                  </div>
                </details>
              </section>
            </>
          )}

          {/* Guidance */}
          {guidance.data && guidance.data.cards.length > 0 && (
            <section>
              <SectionTitle>Adaptive guidance</SectionTitle>
              <div className="grid gap-3 lg:grid-cols-2">
                {guidance.data.cards.map((c) => (
                  <GuidanceCard key={c.id} card={c} />
                ))}
              </div>
              <p className="mt-3 text-xs text-grey">{guidance.data.disclaimer}</p>
            </section>
          )}

          <div className="grid gap-12 lg:grid-cols-[1fr_1.15fr]">
            {/* Timeline */}
            <section>
              <SectionTitle>Timeline</SectionTitle>
              {p.timeline.length === 0 ? (
                <p className="text-grey">Nothing recorded in this window.</p>
              ) : (
                <ol className="relative space-y-5 border-l border-line pl-6">
                  {p.timeline.map((e) => {
                    const Icon = e.kind === 'scan' ? ScanFace : e.kind === 'checkin' ? ClipboardCheck : FlaskConical
                    return (
                      <li key={`${e.kind}-${e.id}`} className="relative">
                        <span className={`absolute -left-[37px] grid size-6 place-items-center rounded-full border bg-porcelain ${e.kind === 'routine' ? 'border-rose' : 'border-forest'}`}>
                          <Icon className={`size-3.5 ${e.kind === 'routine' ? 'text-charcoal' : 'text-forest'}`} aria-hidden />
                        </span>
                        <div className="flex flex-wrap items-baseline gap-x-3">
                          {e.kind === 'scan' ? (
                            <button className="font-medium underline-offset-2 hover:underline" onClick={() => setParams({ scan: String(e.id) })}>
                              {e.title}
                            </button>
                          ) : (
                            <span className="font-medium">{e.title}</span>
                          )}
                          <span className="meta">{fmtDateTime(e.at)}</span>
                          {e.is_demo && <span className="chip border-rose bg-rose-pale text-[0.7rem]">demo</span>}
                        </div>
                        <div className="text-sm text-charcoal/75">{e.detail}</div>
                        {e.confounders && e.confounders.length > 0 && <div className="text-sm text-ochre">Possible confounders: {e.confounders.join(', ')}</div>}
                      </li>
                    )
                  })}
                </ol>
              )}
            </section>

            {/* Check-in */}
            <section id="checkin" className="scroll-mt-24">
              <SectionTitle>Check in</SectionTitle>
              <div className="panel p-5 md:p-6">
                <CheckInForm />
              </div>
            </section>
          </div>

          {/* History */}
          <section>
            <SectionTitle>Scan history</SectionTitle>
            {history.loading ? (
              <Spinner />
            ) : noScans ? (
              <p className="text-grey">No scans yet.</p>
            ) : (
              <ul className="divide-y divide-line rounded-[6px] border border-line bg-porcelain">
                {history.data!.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-serif text-2xl">{h.overall_score?.toFixed(0) ?? '—'}</span>
                      <div>
                        <div className="text-sm">
                          Scan #{h.id} <span className="meta ml-1">{fmtDateTime(h.created_at)}</span>
                        </div>
                        <div className="mt-0.5">
                          <SourceBadge source={h.source} />
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button className="btn btn-ghost" onClick={() => setParams({ scan: String(h.id) })}>
                        View
                      </button>
                      <button className="btn btn-quiet text-alarm" onClick={() => setToDelete(h)} aria-label={`Delete scan ${h.id}`}>
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <Drawer
        open={!!viewing}
        wide
        title={viewing ? `Scan #${viewing.id}` : ''}
        onClose={() => {
          setViewing(null)
          params.delete('scan')
          setParams(params, { replace: true })
        }}
      >
        {viewing && <ScanResults a={viewing} showMasks={false} />}
        {viewing?.raw_response_redacted != null && (
          <details className="mt-6 text-sm">
            <summary className="cursor-pointer text-grey">Provider response (redacted, for debugging)</summary>
            <pre className="mt-2 max-h-72 overflow-auto rounded bg-ivory p-3 font-mono text-xs">{JSON.stringify(viewing.raw_response_redacted, null, 2)}</pre>
          </details>
        )}
      </Drawer>
      <Confirm
        open={!!toDelete}
        danger
        title="Delete this scan?"
        body={`Scan #${toDelete?.id} from ${fmtDate(toDelete?.created_at)} will be removed from your history and trends. This can’t be undone.`}
        confirmLabel="Delete scan"
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          try {
            await api.deleteAnalysis(toDelete!.id)
            toast('Scan deleted')
            bump()
          } catch (e) {
            toast((e as Error).message, 'error')
          }
          setToDelete(null)
        }}
      />
    </div>
  )
}
