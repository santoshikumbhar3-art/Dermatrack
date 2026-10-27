import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { ApiError } from '../services/api'

/* ------------------------------------------------------------------ data refresh */
// A global "version" so that any mutation (a scan, a check-in, a routine edit)
// refreshes every view that depends on server data.
const RefreshCtx = createContext<{ version: number; bump: () => void }>({ version: 0, bump: () => {} })

export function RefreshProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((v) => v + 1), [])
  return <RefreshCtx.Provider value={{ version, bump }}>{children}</RefreshCtx.Provider>
}
export const useRefresh = () => useContext(RefreshCtx)

export function useApi<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const { version } = useRefresh()
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(true)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const [local, setLocal] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fnRef
      .current()
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e instanceof ApiError ? e : new ApiError(0, 'error', String(e))))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, local, ...deps])

  return { data, error, loading, reload: () => setLocal((n) => n + 1), setData }
}

/* ------------------------------------------------------------------------ toasts */
type Toast = { id: number; text: string; tone: 'ok' | 'error' }
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[70] flex flex-col items-center gap-2 px-4 lg:bottom-6" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`page-in pointer-events-auto max-w-md rounded-full px-4 py-2 text-sm shadow-[0_6px_24px_-8px_rgb(38_40_35/.35)] ${
              t.tone === 'error' ? 'bg-alarm text-porcelain' : 'bg-charcoal text-ivory'
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx)

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [q])
  return m
}
