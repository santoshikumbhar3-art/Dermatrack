import { Lock } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { GuidanceCard as G } from '../services/api'
import { LevelIcon } from './ui'

const TONE: Record<G['level'], string> = {
  urgent: 'border-alarm/40 bg-alarm-pale/50',
  caution: 'border-ochre/30 bg-ochre-pale/50',
  info: 'border-line bg-porcelain',
  ok: 'border-sage/50 bg-sage-pale/40',
}

const recordHref = (r: G['records'][number]) =>
  r.type === 'scan' ? `/app/progress?scan=${r.id}` : r.type === 'routine_item' ? `/app/routine#item-${r.id}` : r.type === 'checkin' ? '/app/progress#checkin' : '/app/routine'

export default function GuidanceCard({ card, compact }: { card: G; compact?: boolean }) {
  return (
    <article className={`rounded-[6px] border p-5 ${TONE[card.level]}`} aria-label={card.title}>
      <div className="flex items-start gap-3">
        <LevelIcon level={card.level} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-sans text-[1.02rem] font-semibold">{card.title}</h3>
            {card.safety_locked && (
              <span className="chip border-alarm/30 text-alarm" title="Safety rule — cannot be overridden by scan results or the assistant">
                <Lock className="size-3" aria-hidden /> Safety rule
              </span>
            )}
          </div>
          {card.observed.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {card.observed.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          )}
          {!compact && card.reasoning && <p className="mt-2 text-sm text-charcoal/75">{card.reasoning}</p>}
          {card.suggestions.length > 0 && (
            <ul className="mt-3 space-y-1.5 text-sm">
              {(compact ? card.suggestions.slice(0, 2) : card.suggestions).map((s) => (
                <li key={s} className="flex gap-2">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-forest" aria-hidden />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          )}
          {!compact && card.questions.length > 0 && (
            <div className="mt-3 text-sm">
              <span className="font-medium">To understand this better: </span>
              {card.questions.join(' ')}
            </div>
          )}
          {!compact && card.records.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {card.records.map((r) => (
                <Link key={`${r.type}-${r.id}`} to={recordHref(r)} className="chip hover:border-sage">
                  {r.label}
                </Link>
              ))}
            </div>
          )}
          <p className="meta mt-3">{card.id}</p>
        </div>
      </div>
    </article>
  )
}
