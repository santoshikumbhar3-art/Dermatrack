import { useState } from 'react'
import type { Analysis } from '../services/api'
import { fmtDateTime } from '../lib/format'
import { SourceBadge } from './ui'

export default function ScanResults({ a, showMasks = true }: { a: Analysis; showMasks?: boolean }) {
  const [scale, setScale] = useState<'raw' | 'ui'>('raw')
  const whole = a.metrics.filter((m) => m.region == null || m.region === 'whole')
  const regional = a.metrics.filter((m) => m.region && m.region !== 'whole')
  const masks = Object.entries(a.mask_urls ?? {}).filter(([, v]) => v.length)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <SourceBadge source={a.source} />
        <span className="meta">
          scan #{a.id} · {fmtDateTime(a.created_at)} · {a.mode.toUpperCase()} · {a.api_version}
        </span>
      </div>
      {a.source !== 'youcam' && (
        <p className="rounded-[6px] border border-ochre/30 bg-ochre-pale/50 px-4 py-3 text-sm">
          {a.source === 'dev_fixture'
            ? 'These numbers are YouCam’s published documentation sample, returned because no API key is configured. They are not an analysis of your photo.'
            : 'Demonstration sample values. Not a real measurement.'}
        </p>
      )}

      <div className="grid gap-6 sm:grid-cols-[auto_1fr] sm:items-end">
        <div>
          <div className="text-sm text-grey">Overall skin score</div>
          <div className="font-serif text-7xl leading-none">{a.overall_score != null ? a.overall_score.toFixed(0) : '—'}</div>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          {a.skin_age != null && (
            <div>
              <div className="text-sm text-grey">AI-estimated skin age</div>
              <div className="font-serif text-3xl">{a.skin_age.toFixed(0)}</div>
            </div>
          )}
          <div role="radiogroup" aria-label="Score shown" className="inline-flex rounded-full border border-line bg-porcelain p-0.5 text-sm">
            {(['raw', 'ui'] as const).map((s) => (
              <button key={s} role="radio" aria-checked={scale === s} onClick={() => setScale(s)} className={`rounded-full px-3 py-1 ${scale === s ? 'bg-forest text-ivory' : 'text-grey'}`}>
                {s === 'raw' ? 'Raw score' : 'Display score'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="panel divide-y divide-line">
        {whole.map((m) => {
          const v = scale === 'raw' ? m.raw_score : m.ui_score
          return (
            <div key={m.key} className="grid grid-cols-[minmax(6rem,9rem)_1fr_3.5rem] items-center gap-4 px-4 py-3">
              <span className="text-sm">{m.label}</span>
              <span className="relative h-2 rounded-full bg-sage-pale" role="meter" aria-valuemin={1} aria-valuemax={100} aria-valuenow={v ?? undefined} aria-label={m.label}>
                <span className="absolute inset-y-0 left-0 rounded-full bg-forest" style={{ width: `${v ?? 0}%` }} />
              </span>
              <span className="text-right font-mono text-sm">{v != null ? (scale === 'raw' ? v.toFixed(1) : v) : '—'}</span>
            </div>
          )
        })}
      </div>

      {regional.length > 0 && (
        <details className="panel p-4">
          <summary className="cursor-pointer text-sm font-medium">Regional scores ({regional.length})</summary>
          <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
            {regional.map((m) => (
              <li key={m.key + m.region} className="flex justify-between gap-2">
                <span>
                  {m.label}, {m.region_label}
                </span>
                <span className="font-mono">{(scale === 'raw' ? m.raw_score?.toFixed(1) : m.ui_score) ?? '—'}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {showMasks && masks.length > 0 && (
        <div>
          <h3 className="mb-2 text-lg">Detection masks</h3>
          <p className="mb-3 text-sm text-grey">Returned by YouCam for this session only. These links expire and aren’t saved.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {masks.map(([k, urls]) => (
              <figure key={k}>
                <img src={urls[0]} alt={`${k} detection mask`} className="aspect-[3/4] w-full rounded-[4px] border border-line object-cover" loading="lazy" referrerPolicy="no-referrer" />
                <figcaption className="mt-1 text-xs text-grey">{k.replace(/_/g, ' ')}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 text-sm text-grey md:grid-cols-2">
        <p>
          <span className="font-medium text-charcoal">How to read this.</span> YouCam scores run from 1 to 100; higher means a more favourable reading for that concern. The raw score is the
          unadjusted measurement and is what DermaTrack uses for comparisons. YouCam documents that the display score is adjusted upwards to be encouraging.
        </p>
        <p>
          These are measurements of how features appear in this photo, affected by light, angle and makeup. They aren’t a diagnosis and don’t measure skin-barrier health.
          {a.unmapped_fields.length > 0 && <> The response also included fields we don’t display as scores: {a.unmapped_fields.join(', ')}.</>}
        </p>
      </div>
      {Object.keys(a.capture_conditions).length > 0 && (
        <p className="text-sm text-grey">
          Recorded conditions: {Object.entries(a.capture_conditions).map(([k, v]) => `${k.replace('_', ' ')} — ${v}`).join('; ')}
        </p>
      )}
    </div>
  )
}
