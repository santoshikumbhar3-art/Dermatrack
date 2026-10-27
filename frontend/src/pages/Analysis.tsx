import { Camera, Check, ImageUp, Loader2, RefreshCcw, ShieldCheck, Sun, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Contour } from '../components/charts/Contour'
import ScanResults from '../components/ScanResults'
import { ErrorNote, PageHeader, Spinner } from '../components/ui'
import { useApi, useRefresh, useToast } from '../lib/hooks'
import { api, ApiError, type Analysis as A } from '../services/api'

type Stage = 'consent' | 'upload' | 'conditions' | 'running' | 'done'
const STEPS: { key: Stage; label: string }[] = [
  { key: 'consent', label: 'Consent' },
  { key: 'upload', label: 'Photo' },
  { key: 'conditions', label: 'Conditions' },
  { key: 'running', label: 'Analysis' },
  { key: 'done', label: 'Results' },
]

const CONDITION_OPTIONS = {
  lighting: ['Window daylight', 'Indoor white light', 'Indoor warm light', 'Outdoors', 'Mixed'],
  makeup: ['None', 'Sunscreen only', 'Light makeup', 'Full makeup'],
  time_of_day: ['Morning', 'Afternoon', 'Evening'],
  distance: ['Arm’s length', 'Closer than arm’s length', 'Tripod / fixed'],
}

interface Picked {
  file: File
  url: string
  width: number
  height: number
  note?: string
}

async function readDims(file: File): Promise<{ width: number; height: number; img: HTMLImageElement }> {
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.src = url
  await img.decode()
  return { width: img.naturalWidth, height: img.naturalHeight, img }
}

// Downscale very large photos in the browser so they fit YouCam's 10 MB limit.
// YouCam itself resizes anything above 2560px on the long side, so this loses nothing it would use.
async function shrink(img: HTMLImageElement): Promise<File> {
  const scale = Math.min(1, 2560 / Math.max(img.naturalWidth, img.naturalHeight))
  const c = document.createElement('canvas')
  c.width = Math.round(img.naturalWidth * scale)
  c.height = Math.round(img.naturalHeight * scale)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.92))
  return new File([blob], 'scan.jpg', { type: 'image/jpeg' })
}

const RUN_MESSAGES = ['Sending your photo securely to YouCam', 'Creating the skin-analysis task', 'Waiting for YouCam to finish analysing', 'Normalising and saving the scores']

export default function Analysis() {
  const toast = useToast()
  const { bump } = useRefresh()
  const cfg = useApi(() => api.analysisConfig())
  const profile = useApi(() => api.profile())
  const [stage, setStage] = useState<Stage>('consent')
  const [agree, setAgree] = useState(false)
  const [picked, setPicked] = useState<Picked | null>(null)
  const [pickError, setPickError] = useState<string | null>(null)
  const [conds, setConds] = useState<Record<string, string>>({ lighting: '', makeup: '', time_of_day: '', distance: '' })
  const [note, setNote] = useState('')
  const [result, setResult] = useState<A | null>(null)
  const [runError, setRunError] = useState<ApiError | null>(null)
  const [runStep, setRunStep] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const camRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (profile.data?.analysis_consent && stage === 'consent') setStage('upload')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.data])

  useEffect(() => () => {
    if (picked) URL.revokeObjectURL(picked.url)
  }, [picked])

  useEffect(() => {
    if (stage !== 'running') return
    setRunStep(0)
    const t = [setTimeout(() => setRunStep(1), 1800), setTimeout(() => setRunStep(2), 4000)]
    return () => t.forEach(clearTimeout)
  }, [stage])

  if (cfg.loading || profile.loading) return <Spinner />
  if (cfg.error) return <ErrorNote error={cfg.error} onRetry={cfg.reload} />
  const config = cfg.data!
  const minSide = config.min_short_side

  async function choose(file: File | undefined) {
    setPickError(null)
    if (!file) return
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setPickError('Please choose a JPG or PNG photo. HEIC and other formats aren’t supported by the analysis service.')
      return
    }
    try {
      let { width, height, img } = await readDims(file)
      let f = file
      let note: string | undefined
      if (Math.min(width, height) < minSide) {
        setPickError(`This photo is ${width}×${height}px. The shorter side needs to be at least ${minSide}px. Try your phone’s main camera at full resolution.`)
        return
      }
      if (file.size >= config.max_bytes || Math.max(width, height) > 4000) {
        f = await shrink(img)
        const d = await readDims(f)
        width = d.width
        height = d.height
        note = `Resized from ${(file.size / 1048576).toFixed(1)} MB to ${(f.size / 1048576).toFixed(1)} MB to fit the 10 MB limit.`
        if (Math.min(width, height) < minSide) {
          setPickError('This photo is too narrow to resize under 10 MB while keeping enough detail. Try a different photo.')
          return
        }
      }
      if (width > height) note = (note ? note + ' ' : '') + 'Tip: YouCam recommends portrait photos for skin analysis.'
      setPicked({ file: f, url: URL.createObjectURL(f), width, height, note })
    } catch {
      setPickError('That image couldn’t be read. Please try a different JPG or PNG.')
    }
  }

  async function run() {
    if (!picked) return
    setStage('running')
    setRunError(null)
    const fd = new FormData()
    fd.append('image', picked.file, picked.file.name)
    fd.append('consent', 'true')
    Object.entries(conds).forEach(([k, v]) => v && fd.append(k, v))
    if (note.trim()) fd.append('note', note.trim())
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const a = await api.analyze(fd, ctrl.signal)
      setRunStep(3)
      setResult(a)
      setStage('done')
      bump()
      toast('Scan saved')
    } catch (e) {
      if (ctrl.signal.aborted) {
        setStage('conditions')
        toast('Scan cancelled. Nothing was saved.')
        return
      }
      setRunError(e instanceof ApiError ? e : new ApiError(0, 'error', 'Something went wrong.'))
      setStage('conditions')
    }
  }

  function restart() {
    setResult(null)
    setPicked(null)
    setNote('')
    setRunError(null)
    setStage('upload')
  }

  const stepIndex = STEPS.findIndex((s) => s.key === stage)

  return (
    <div>
      <PageHeader title="Skin Analysis" intro="One front-facing photo, analysed by the YouCam AI Skin Analysis API. We save the scores, never the photo." />

      {config.source === 'dev_fixture' && <p className="mb-6 rounded-[6px] border border-ochre/30 bg-ochre-pale/50 px-4 py-3 text-sm">{config.fixture_notice}</p>}
      {config.source === 'unavailable' && (
        <ErrorNote error={new Error('Skin analysis isn’t configured on this server. Add YOUCAM_API_KEY to the backend .env file and restart it.')} />
      )}

      <ol className="mb-8 flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label="Scan steps">
        {STEPS.map((s, i) => (
          <li key={s.key} className={`flex items-center gap-2 ${i === stepIndex ? 'font-medium text-forest' : i < stepIndex ? 'text-charcoal' : 'text-grey'}`} aria-current={i === stepIndex ? 'step' : undefined}>
            <span className={`grid size-6 place-items-center rounded-full border text-xs ${i < stepIndex ? 'border-forest bg-forest text-ivory' : i === stepIndex ? 'border-forest' : 'border-line'}`}>
              {i < stepIndex ? <Check className="size-3.5" /> : i + 1}
            </span>
            {s.label}
          </li>
        ))}
      </ol>

      {stage === 'consent' && (
        <section className="grid gap-8 md:grid-cols-[1.3fr_1fr]">
          <div className="panel p-6 md:p-8">
            <h2 className="text-2xl">Before you scan</h2>
            <ul className="mt-4 space-y-3 text-[0.95rem]">
              {[
                'Your photo is sent from our server to the YouCam AI Skin Analysis API (Perfect Corp.) to be analysed. It isn’t sent anywhere else.',
                'DermaTrack stores the resulting scores and when they were taken. It does not store your photo.',
                'YouCam keeps task results for 24 hours after processing, under its own privacy policy and terms.',
                'Results describe how skin features appear in a photo. They are not a medical diagnosis.',
                'You can withdraw this consent and delete your scans at any time in Settings.',
              ].map((t) => (
                <li key={t} className="flex gap-3">
                  <ShieldCheck className="mt-0.5 size-5 shrink-0 text-forest" aria-hidden /> {t}
                </li>
              ))}
            </ul>
            <label className="mt-6 flex items-start gap-3 rounded-[6px] border border-line bg-ivory p-4">
              <input type="checkbox" className="mt-1 size-4 accent-[#243D32]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>I’m 18 or older, this is a photo of me, and I agree to it being analysed as described above.</span>
            </label>
            <button
              className="btn btn-primary mt-5"
              disabled={!agree || config.source === 'unavailable'}
              onClick={async () => {
                try {
                  await api.setConsent(true)
                  setStage('upload')
                  bump()
                } catch (e) {
                  toast((e as Error).message, 'error')
                }
              }}
            >
              Agree and continue
            </button>
          </div>
          <Contour className="hidden h-auto w-full text-sage md:block" rings={9} seed={11} accentIndex={4} />
        </section>
      )}

      {stage === 'upload' && (
        <section className="grid gap-8 md:grid-cols-[1.2fr_1fr]">
          <div>
            {!picked ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver(false)
                  choose(e.dataTransfer.files[0])
                }}
                className={`flex aspect-[4/5] max-h-[34rem] w-full flex-col items-center justify-center gap-4 rounded-[6px] border border-dashed p-6 text-center transition-colors ${
                  dragOver ? 'border-forest bg-sage-pale' : 'border-sage bg-porcelain'
                }`}
              >
                <ImageUp className="size-8 text-forest" aria-hidden />
                <div>
                  <p className="font-serif text-2xl">Add a front-facing photo</p>
                  <p className="mt-1 text-sm text-grey">
                    JPG or PNG, under 10 MB, shorter side at least {minSide}px. Drag it here or choose below.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  <button className="btn btn-primary" onClick={() => fileRef.current?.click()}>
                    <ImageUp className="size-4" /> Choose a photo
                  </button>
                  <button className="btn btn-ghost" onClick={() => camRef.current?.click()}>
                    <Camera className="size-4" /> Take a selfie
                  </button>
                </div>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="sr-only" onChange={(e) => choose(e.target.files?.[0])} aria-label="Choose a photo" />
                <input ref={camRef} type="file" accept="image/jpeg,image/png" capture="user" className="sr-only" onChange={(e) => choose(e.target.files?.[0])} aria-label="Take a selfie" />
              </div>
            ) : (
              <figure>
                <img src={picked.url} alt="Your selected photo" className="aspect-[4/5] max-h-[34rem] w-full rounded-[6px] border border-line object-cover" />
                <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-grey">
                  <span className="meta">
                    {picked.width}×{picked.height}px · {(picked.file.size / 1048576).toFixed(1)} MB
                  </span>
                  <span className="flex gap-2">
                    <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
                      <RefreshCcw className="size-4" /> Replace photo
                    </button>
                    <button className="btn btn-quiet" onClick={() => setPicked(null)} aria-label="Remove photo">
                      <X className="size-4" />
                    </button>
                  </span>
                </figcaption>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="sr-only" onChange={(e) => choose(e.target.files?.[0])} aria-label="Replace photo" />
                {picked.note && <p className="mt-2 text-sm text-grey">{picked.note}</p>}
              </figure>
            )}
            {pickError && (
              <div className="mt-3">
                <ErrorNote error={new Error(pickError)} />
              </div>
            )}
            {picked && (
              <button className="btn btn-primary mt-5" onClick={() => setStage('conditions')}>
                Continue
              </button>
            )}
          </div>
          <aside className="space-y-4">
            <h2 className="text-2xl">For a usable photo</h2>
            <ul className="space-y-3 text-[0.95rem]">
              <li>Face the camera straight on, with your face filling most of the frame width.</li>
              <li>Pull hair back from your forehead and remove glasses if you can.</li>
              <li>Use bright, even light from the front. Avoid harsh shadows and backlight.</li>
              <li>Remove makeup if possible. Keep your mouth closed and eyes open.</li>
            </ul>
            <p className="rounded-[6px] bg-sage-pale/60 p-4 text-sm">
              <Sun className="mb-1 inline size-4 text-forest" aria-hidden /> Comparisons are only meaningful when photos are taken the same way. Pick a spot and a time of day you can repeat.
            </p>
          </aside>
        </section>
      )}

      {stage === 'conditions' && picked && (
        <section className="grid gap-8 md:grid-cols-[1fr_1.3fr]">
          <img src={picked.url} alt="Your selected photo" className="aspect-[4/5] max-h-[28rem] w-full rounded-[6px] border border-line object-cover" />
          <div>
            <h2 className="text-2xl">How was this photo taken?</h2>
            <p className="mt-1 text-grey">Optional, but recording this lets DermaTrack warn you when two scans weren’t taken the same way.</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {Object.entries(CONDITION_OPTIONS).map(([k, opts]) => (
                <label key={k} className="field">
                  <span>{k === 'time_of_day' ? 'Time of day' : k.charAt(0).toUpperCase() + k.slice(1)}</span>
                  <select className="input" value={conds[k]} onChange={(e) => setConds((c) => ({ ...c, [k]: e.target.value }))}>
                    <option value="">Not recorded</option>
                    {opts.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <label className="field mt-4">
              <span>
                Note <span className="hint">(optional)</span>
              </span>
              <input className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Third week on the new serum" />
            </label>
            {runError && (
              <div className="mt-5">
                <ErrorNote error={runError} />
                <p className="mt-2 text-sm text-grey">Nothing was saved. {runError.retryable ? 'This is usually temporary — you can try again.' : ''}</p>
              </div>
            )}
            <div className="mt-6 flex flex-wrap gap-2">
              <button className="btn btn-primary" onClick={run}>
                {runError ? 'Try the analysis again' : 'Analyse my skin'}
              </button>
              <button className="btn btn-ghost" onClick={() => setStage('upload')}>
                Change photo
              </button>
            </div>
          </div>
        </section>
      )}

      {stage === 'running' && picked && (
        <section className="grid items-center gap-8 md:grid-cols-[1fr_1.2fr]" aria-live="polite">
          <div className="relative overflow-hidden rounded-[6px] border border-line">
            <img src={picked.url} alt="" className="aspect-[4/5] max-h-[28rem] w-full object-cover opacity-80" />
            <div className="scan-sweep pointer-events-none absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-transparent via-sage/35 to-transparent" />
            <Contour className="pointer-events-none absolute inset-0 h-full w-full text-porcelain" rings={8} seed={19} animate />
          </div>
          <div>
            <h2 className="text-2xl">Analysing your skin</h2>
            <p className="mt-1 text-grey">This usually takes under a minute. Keep this page open.</p>
            <ol className="mt-6 space-y-3">
              {RUN_MESSAGES.map((m, i) => (
                <li key={m} className={`flex items-center gap-3 ${i > runStep ? 'text-grey' : ''}`}>
                  {i < runStep ? (
                    <Check className="size-4 text-forest" />
                  ) : i === runStep ? (
                    <Loader2 className="size-4 animate-spin text-forest" />
                  ) : (
                    <span className="size-4 rounded-full border border-line" />
                  )}
                  {m}
                </li>
              ))}
            </ol>
            <p className="mt-4 text-xs text-grey">Steps are shown approximately; the server reports only the final result.</p>
            <button className="btn btn-ghost mt-6" onClick={() => abortRef.current?.abort()}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {stage === 'done' && result && (
        <section>
          <div className="mb-6 flex flex-col gap-3 rounded-[6px] border border-sage bg-sage-pale/50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2">
              <Check className="size-5 text-forest" /> Saved to your history. Your photo was not stored.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link to="/app/progress" className="btn btn-primary">
                See my progress
              </Link>
              <Link to="/app/routine" className="btn btn-ghost">
                Review my routine
              </Link>
              <button className="btn btn-quiet" onClick={restart}>
                Scan again
              </button>
            </div>
          </div>
          <ScanResults a={result} />
        </section>
      )}
    </div>
  )
}
