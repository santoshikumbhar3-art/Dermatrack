import { AlertTriangle, CircleAlert, Info, Loader2, ShieldAlert, X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import type { ApiError, Severity, Source } from '../../services/api'
import { SOURCE_LABEL } from '../../lib/format'

export function PageHeader({ title, intro, actions }: { title: string; intro?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-col gap-4 border-b border-line pb-6 md:flex-row md:items-end md:justify-between">
      <div className="max-w-2xl">
        <h1 className="text-[2.1rem] md:text-[2.6rem]">{title}</h1>
        {intro && <div className="mt-2 text-grey">{intro}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  )
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 className="text-[1.45rem]">{children}</h2>
      {aside}
    </div>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-grey" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden /> <span className="text-sm">{label}…</span>
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-line/70 ${className}`} aria-hidden />
}

export function ErrorNote({ error, onRetry }: { error: ApiError | Error | null; onRetry?: () => void }) {
  if (!error) return null
  return (
    <div className="flex items-start gap-3 rounded-[6px] border border-alarm-pale bg-alarm-pale/40 p-4 text-sm" role="alert">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-alarm" aria-hidden />
      <div className="flex-1">
        <p>{error.message}</p>
        {onRetry && (
          <button className="mt-2 font-medium text-alarm underline underline-offset-2" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    </div>
  )
}

export function EmptyState({ title, body, action, art }: { title: string; body: ReactNode; action?: ReactNode; art?: ReactNode }) {
  return (
    <div className="panel flex flex-col items-start gap-3 p-6 md:flex-row md:items-center md:gap-8 md:p-8">
      {art && <div className="shrink-0">{art}</div>}
      <div className="max-w-lg">
        <h3 className="text-xl">{title}</h3>
        <div className="mt-1 text-grey">{body}</div>
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  )
}

const SEV: Record<Severity, { label: string; cls: string }> = {
  documented_concern: { label: 'Documented concern', cls: 'bg-alarm-pale text-alarm border-alarm-pale' },
  precaution: { label: 'Precaution', cls: 'bg-ochre-pale text-ochre border-ochre-pale' },
  info: { label: 'Good to know', cls: 'bg-sage-pale text-forest border-sage-pale' },
  incomplete: { label: 'Not evaluated', cls: 'bg-ivory text-grey border-line' },
}
export function SeverityBadge({ s }: { s: Severity }) {
  return <span className={`chip ${SEV[s].cls}`}>{SEV[s].label}</span>
}

export function SourceBadge({ source }: { source: Source }) {
  const cls =
    source === 'youcam' ? 'border-sage text-forest' : source === 'dev_fixture' ? 'border-ochre/40 bg-ochre-pale text-ochre' : 'border-rose bg-rose-pale text-charcoal'
  return <span className={`chip ${cls}`}>{SOURCE_LABEL[source]}</span>
}

export function LevelIcon({ level }: { level: 'urgent' | 'caution' | 'info' | 'ok' }) {
  if (level === 'urgent') return <ShieldAlert className="size-5 text-alarm" aria-hidden />
  if (level === 'caution') return <AlertTriangle className="size-5 text-ochre" aria-hidden />
  return <Info className="size-5 text-forest" aria-hidden />
}

export function Drawer({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      prev?.focus()
    }
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-charcoal/30" aria-label="Close" onClick={onClose} tabIndex={-1} />
      <div ref={ref} className={`page-in relative flex h-full w-full flex-col bg-porcelain shadow-[-20px_0_40px_-24px_rgb(38_40_35/.4)] ${wide ? 'max-w-2xl' : 'max-w-lg'}`}>
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-2xl">{title}</h2>
          <button className="btn btn-quiet" onClick={onClose} aria-label="Close panel">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

export function Confirm({ open, title, body, confirmLabel, onConfirm, onCancel, danger }: { open: boolean; title: string; body: ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void; danger?: boolean }) {
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [open, onCancel])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[65] grid place-items-center p-4" role="alertdialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-charcoal/35" onClick={onCancel} />
      <div className="page-in panel relative w-full max-w-md p-6">
        <h2 className="text-2xl">{title}</h2>
        <div className="mt-2 text-grey">{body}</div>
        <div className="mt-6 flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function DemoBanner() {
  return (
    <div className="border-b border-rose/60 bg-rose-pale px-4 py-2 text-center text-[0.84rem]">
      You're viewing <strong className="font-semibold">demonstration data</strong>: sample values, not real measurements of anyone's skin.{' '}
      <Link to="/app/settings#demo" className="underline underline-offset-2">
        Manage
      </Link>
    </div>
  )
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div className="text-sm text-grey">{label}</div>
      <div className="mt-0.5 font-serif text-[2rem] leading-none">{value}</div>
      {sub && <div className="mt-1 text-xs text-grey">{sub}</div>}
    </div>
  )
}
