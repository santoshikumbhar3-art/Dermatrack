export const fmtDate = (iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', opts) : '—'

export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

export const fmtShort = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

export function relativeDays(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const days = Math.round((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days === -1) return 'tomorrow'
  if (days < 0) return `in ${-days} days`
  return `${days} days ago`
}

export const signed = (n: number, digits = 1) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(digits)}`

export const FREQUENCY_LABEL: Record<string, string> = {
  daily: 'Daily',
  alternate_days: 'Alternate days',
  '2_3_week': '2–3× a week',
  weekly: 'Weekly',
  as_needed: 'As needed',
}

export const SLOT_LABEL: Record<string, string> = { am: 'Morning', pm: 'Evening', both: 'Morning & evening' }

export const CATEGORIES = ['cleanser', 'toner', 'serum', 'exfoliant', 'treatment', 'moisturiser', 'sunscreen', 'eye', 'mask', 'oil', 'other']

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export const SOURCE_LABEL: Record<string, string> = {
  youcam: 'YouCam Skin AI',
  dev_fixture: 'Development fixture',
  demo_sample: 'Demonstration sample',
}

export function today(): string {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}
