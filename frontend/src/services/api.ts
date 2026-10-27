// Typed client for the DermaTrack backend. All requests go to same-origin /api
// (proxied by Vite in development). No secrets ever live in the browser.

export type Source = 'youcam' | 'dev_fixture' | 'demo_sample'

export interface Metric {
  key: string
  canonical: string
  label: string
  region: string | null
  region_label: string | null
  raw_score: number | null
  ui_score: number | null
  direction: 'higher_is_better'
  scale: string
}

export interface Analysis {
  id: number
  created_at: string
  source: Source
  mode: 'sd' | 'hd'
  api_version: string
  overall_score: number | null
  skin_age: number | null
  metrics: Metric[]
  unmapped_fields: string[]
  image_meta: { width?: number; height?: number; format?: string; bytes?: number }
  capture_conditions: Record<string, string>
  note: string
  is_demo: boolean
  raw_response_redacted?: unknown
  mask_urls?: Record<string, string[]>
}

export interface AnalysisConfig {
  source: 'youcam' | 'dev_fixture' | 'unavailable'
  mode: string
  min_short_side: number
  max_bytes: number
  formats: string[]
  provider: string
  fixture_notice: string | null
}

export interface Active { name: string; concentration_percent?: number | null }

export interface Reaction { id: number; created_at: string; description: string; severity: number; is_demo: boolean }

export type Slot = 'am' | 'pm' | 'both'
export type Frequency = 'daily' | 'alternate_days' | '2_3_week' | 'weekly' | 'as_needed'

export interface RoutineItemInput {
  name: string
  brand: string
  category: string
  slot: Slot
  step_order: number
  actives: Active[]
  ingredients_verified: boolean
  frequency: Frequency
  introduced_on: string | null
  instructions: string
  paused: boolean
  notes: string
  library_product_id?: number | null
}

export interface RoutineItem extends RoutineItemInput {
  id: number
  created_at: string
  updated_at: string
  is_demo: boolean
  reactions: Reaction[]
}

export type Severity = 'documented_concern' | 'precaution' | 'info' | 'incomplete'

export interface Finding {
  rule_id: string
  severity: Severity
  title: string
  explanation: string
  reference: string
  next_step: string
  limitations: string
  product_ids: (number | string)[]
  product_names: string[]
  slot: string | null
  frequency_note: string | null
  uncertainty: string[]
}

export interface Compatibility {
  findings: Finding[]
  counts: Record<Severity, number>
  evaluated_products: number
  total_active_products: number
  paused_products: number
  unrecognised_ingredients: { product_id: number; product_name: string; ingredient: string }[]
  summary: string
  disclaimer: string
}

export interface RoutineEvent { id: number; created_at: string; item_id: number | null; item_name: string; kind: string; detail: string; is_demo: boolean }

export interface CheckIn {
  id: number
  created_at: string
  symptoms: Record<string, number>
  red_flags: string[]
  suspected_item_ids: number[]
  confounders: string[]
  notes: string
  is_demo: boolean
}

export interface GuidanceCard {
  id: string
  level: 'urgent' | 'caution' | 'info' | 'ok'
  title: string
  observed: string[]
  reasoning: string
  suggestions: string[]
  questions: string[]
  records: { type: string; id: number | string; label: string }[]
  safety_locked: boolean
}

export interface Guidance {
  cards: GuidanceCard[]
  safety_active: boolean
  next_checkin_due: string
  checkin_interval_days: number
  disclaimer: string
}

export interface ComparisonRow {
  canonical: string
  label: string
  baseline_raw: number
  current_raw: number
  baseline_ui: number | null
  current_ui: number | null
  delta_points: number
  relative_change_percent: number | null
  status: 'more_favourable' | 'less_favourable' | 'no_clear_change'
}

export interface Comparison {
  comparable: boolean
  reason?: string
  baseline_id: number
  current_id: number
  baseline_at?: string
  current_at?: string
  days_between?: number
  metrics: ComparisonRow[]
  only_in_baseline?: string[]
  only_in_current?: string[]
  condition_differences?: string[]
  noise_band_points?: number
}

export interface TimelineEntry {
  kind: 'scan' | 'checkin' | 'routine'
  id: number
  at: string
  title: string
  detail: string
  source?: Source
  confounders?: string[]
  is_demo: boolean
}

export interface Progress {
  window_days: number | null
  scan_count: number
  comparable_scan_count: number
  excluded_scan_ids: number[]
  group: { mode: string; api_version: string; data_class: string } | null
  series: { canonical: string; label: string; points: { analysis_id: number; at: string; raw: number; ui: number | null }[] }[]
  overall: { analysis_id: number; at: string; value: number }[]
  comparison: Comparison | null
  timeline: TimelineEntry[]
  summary: { headline: string; changed: string[]; uncertain: string[] }
  method: { formula: string; direction: string; noise_band_points: number; noise_band_note: string; label: string }
}

export interface Profile {
  display_name: string
  skin_goals: string[]
  budget_max: number | null
  currency: string
  avoid_fragrance: boolean
  analysis_consent: boolean
  analysis_consent_at: string | null
  consent_version: string | null
  checkin_interval_days: number
}

export interface LibraryProduct {
  id: number
  name: string
  brand: string
  category: string
  key_actives: Active[]
  full_ingredients: string[]
  ingredients_verified: boolean
  attributes: string[]
  fragrance_free: boolean | null
  price: number | null
  currency: string | null
  price_source: string
  instructions: string
  source: string
  limitations: string
  user_added: boolean
}

export interface Recommendations {
  headline: string
  simplify_first: boolean
  simplify_reasons: string[]
  gaps: string[]
  focus: { tag: string; why: string }[]
  focus_notes: string[]
  based_on_scan: { id: number; source: Source } | null
  matches: { product: LibraryProduct; score: number; reasons: string[]; checks: { ok: boolean; label: string; rule_id?: string }[]; missing_information: string[] }[]
  excluded: { id: number; name: string; reason: string }[]
  method: string
}

export interface Overview {
  profile: Profile
  has_demo: boolean
  latest_scan: Analysis | null
  scan_count: number
  routine: { am: RoutineItem[]; pm: RoutineItem[]; paused: RoutineItem[]; total: number }
  recent_changes: RoutineEvent[]
  alerts: Finding[]
  alert_counts: Record<Severity, number>
  recent_checkins: CheckIn[]
  recent_reactions: { item_id: number; item_name: string; description: string; severity: number; created_at: string }[]
  guidance: Guidance
  trend: { overall: { analysis_id: number; at: string; value: number }[]; summary: Progress['summary']; group: Progress['group'] }
  analysis_source: AnalysisConfig['source']
}

export interface AssistantReply {
  intent: string
  mode: 'rule_based' | 'llm_phrased' | 'rule_based_llm_unavailable'
  text: string
  measured: string[]
  reported: string[]
  citations: { type: string; id: number | string; label: string }[]
  insufficient_data: boolean
  safety_notes: string[]
  suggestions: string[]
  at: string
}

export interface Health { status: string; analysis_source: AnalysisConfig['source']; youcam_configured: boolean; youcam_mode: string; assistant_mode: string }

export class ApiError extends Error {
  status: number
  code: string
  retryable: boolean
  fields?: { field: string; message: string }[]
  constructor(status: number, code: string, message: string, retryable = false, fields?: { field: string; message: string }[]) {
    super(message)
    this.status = status
    this.code = code
    this.retryable = retryable
    this.fields = fields
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, init)
  } catch {
    throw new ApiError(0, 'network_error', "Can't reach the DermaTrack server. Check that the backend is running, then try again.", true)
  }
  if (res.status === 204) return undefined as T
  let body: any = null
  try {
    body = await res.json()
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const d = body?.detail
    if (d && typeof d === 'object' && 'message' in d) throw new ApiError(res.status, d.code ?? 'error', d.message, !!d.retryable, d.fields)
    throw new ApiError(res.status, 'error', typeof d === 'string' ? d : `Request failed (${res.status}).`)
  }
  return body as T
}

const json = (method: string, data?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: data === undefined ? undefined : JSON.stringify(data),
})

export const api = {
  health: () => request<Health>('/health'),
  overview: () => request<Overview>('/overview'),

  analysisConfig: () => request<AnalysisConfig>('/analysis/config'),
  analyze: (form: FormData, signal?: AbortSignal) => request<Analysis>('/analyze', { method: 'POST', body: form, signal }),
  history: () => request<Analysis[]>('/analysis/history'),
  analysis: (id: number) => request<Analysis>(`/analysis/${id}`),
  deleteAnalysis: (id: number) => request<void>(`/analysis/${id}`, { method: 'DELETE' }),
  deleteAllAnalyses: () => request<void>('/analysis', { method: 'DELETE' }),
  compare: (a: number, b: number) => request<Comparison>(`/analysis/compare?a=${a}&b=${b}`),

  progress: (days?: number | null) => request<Progress>(`/progress${days ? `?days=${days}` : ''}`),
  checkins: () => request<{ checkins: CheckIn[]; symptom_labels: Record<string, string>; red_flag_labels: Record<string, string> }>('/checkins'),
  createCheckin: (data: Partial<CheckIn>) => request<{ checkin: CheckIn; guidance: Guidance }>('/checkins', json('POST', data)),
  deleteCheckin: (id: number) => request<void>(`/checkins/${id}`, { method: 'DELETE' }),
  guidance: () => request<Guidance>('/guidance'),

  routines: () => request<{ items: RoutineItem[]; compatibility: Compatibility }>('/routines'),
  createItem: (d: RoutineItemInput) => request<RoutineItem>('/routines', json('POST', d)),
  updateItem: (id: number, d: RoutineItemInput) => request<RoutineItem>(`/routines/${id}`, json('PUT', d)),
  deleteItem: (id: number) => request<void>(`/routines/${id}`, { method: 'DELETE' }),
  addReaction: (id: number, d: { description: string; severity: number }) => request<RoutineItem>(`/routines/${id}/reactions`, json('POST', d)),
  deleteReaction: (id: number, rid: number) => request<void>(`/routines/${id}/reactions/${rid}`, { method: 'DELETE' }),
  previewCompat: (items: RoutineItemInput[]) => request<Compatibility>('/routines/compatibility/preview', json('POST', { items })),
  routineChanges: () => request<{ from: { id: number; at: string } | null; to: { id: number; at: string } | null; events: RoutineEvent[]; message: string | null }>('/routines/changes'),
  routineEvents: () => request<RoutineEvent[]>('/routines/events'),
  rules: () => request<any[]>('/rules'),

  products: () => request<LibraryProduct[]>('/products'),
  addProduct: (d: Partial<LibraryProduct>) => request<LibraryProduct>('/products', json('POST', d)),
  deleteProduct: (id: number) => request<void>(`/products/${id}`, { method: 'DELETE' }),
  recommendations: () => request<Recommendations>('/products/recommendations'),

  assistantStatus: () => request<{ mode: string; description: string; capabilities: string[] }>('/assistant/status'),
  ask: (message: string) => request<AssistantReply>('/assistant/message', json('POST', { message })),

  profile: () => request<Profile>('/profile'),
  saveProfile: (p: Partial<Profile>) => request<Profile>('/profile', json('PUT', p)),
  setConsent: (v: boolean) => request<Profile>('/consent', json('PUT', { analysis_consent: v })),
  exportData: () => request<unknown>('/export'),
  deleteAll: () => request<void>('/data', { method: 'DELETE' }),
  loadDemo: () => request<{ loaded: boolean }>('/demo/load', { method: 'POST' }),
  clearDemo: () => request<void>('/demo', { method: 'DELETE' }),
}
