import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import type { Finding } from '../services/api'
import { SLOT_LABEL } from '../lib/format'
import { SeverityBadge } from './ui'

export default function FindingCard({ f, defaultOpen = false }: { f: Finding; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <article className="rounded-[6px] border border-line bg-porcelain">
      <button className="flex w-full items-start justify-between gap-4 p-4 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge s={f.severity} />
            {f.slot && <span className="text-xs text-grey">{SLOT_LABEL[f.slot]} routine</span>}
          </div>
          <h3 className="mt-2 font-sans text-[1rem] font-semibold">{f.title}</h3>
          <p className="text-sm text-grey">{f.product_names.join(' + ')}</p>
        </div>
        <ChevronDown className={`mt-1 size-5 shrink-0 text-grey transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="space-y-3 border-t border-line px-4 pb-4 pt-3 text-sm">
          <p>{f.explanation}</p>
          {f.frequency_note && <p className="rounded bg-sage-pale/60 p-2.5">{f.frequency_note}</p>}
          <p>
            <span className="font-medium">Suggested next step: </span>
            {f.next_step}
          </p>
          {f.uncertainty.length > 0 && (
            <div>
              <span className="font-medium">Uncertainty: </span>
              {f.uncertainty.join(' ')}
            </div>
          )}
          <dl className="grid gap-2 text-grey sm:grid-cols-[7rem_1fr]">
            <dt>Source</dt>
            <dd>{f.reference}</dd>
            <dt>Limitations</dt>
            <dd>{f.limitations}</dd>
            <dt>Rule</dt>
            <dd className="meta">{f.rule_id}</dd>
          </dl>
        </div>
      )}
    </article>
  )
}
