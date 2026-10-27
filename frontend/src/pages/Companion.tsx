import { ArrowUp, Info, ShieldAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ErrorNote, PageHeader } from '../components/ui'
import { useApi } from '../lib/hooks'
import { api, ApiError, type AssistantReply } from '../services/api'

type Msg = { role: 'user'; text: string } | { role: 'assistant'; reply: AssistantReply }

const citeHref = (c: AssistantReply['citations'][number]) =>
  c.type === 'scan' ? `/app/progress?scan=${c.id}` : c.type === 'routine_item' ? `/app/routine#item-${c.id}` : c.type === 'checkin' ? '/app/progress#checkin' : '/app/routine#compatibility'

function RichText({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <div className="space-y-1.5">
      {lines.map((l, i) => {
        const bullet = l.trim().startsWith('- ')
        const content = (bullet ? l.trim().slice(2) : l).split(/(\*\*[^*]+\*\*)/g).map((s, j) => (s.startsWith('**') ? <strong key={j}>{s.slice(2, -2)}</strong> : <span key={j}>{s}</span>))
        if (!l.trim()) return null
        return bullet ? (
          <div key={i} className="flex gap-2">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-forest" />
            <span>{content}</span>
          </div>
        ) : (
          <p key={i}>{content}</p>
        )
      })}
    </div>
  )
}

const MODE_LABEL: Record<AssistantReply['mode'], string> = {
  rule_based: 'Rule-based answer from your records',
  llm_phrased: 'Grounded in your records, phrased by a language model',
  rule_based_llm_unavailable: 'Rule-based answer (language model unavailable)',
}

export default function Companion() {
  const status = useApi(() => api.assistantStatus())
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<ApiError | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [msgs, busy])

  async function ask(q: string) {
    const text = q.trim()
    if (!text || busy) return
    setMsgs((m) => [...m, { role: 'user', text }])
    setInput('')
    setBusy(true)
    setErr(null)
    try {
      const reply = await api.ask(text)
      setMsgs((m) => [...m, { role: 'assistant', reply }])
    } catch (e) {
      setErr(e as ApiError)
    } finally {
      setBusy(false)
    }
  }

  const caps = status.data?.capabilities ?? []

  return (
    <div className="flex min-h-[calc(100dvh-14rem)] flex-col">
      <PageHeader title="AI Skin Companion" intro="Ask about your own scans, check-ins and routine. Answers point to the records they come from." />

      {status.data && (
        <p className="mb-6 flex items-start gap-2 rounded-[6px] border border-line bg-porcelain p-3 text-sm text-grey">
          <Info className="mt-0.5 size-4 shrink-0 text-forest" aria-hidden /> {status.data.description} It doesn’t diagnose skin conditions.
        </p>
      )}

      <div className="flex-1 space-y-5" aria-live="polite">
        {msgs.length === 0 && (
          <div>
            <p className="font-serif text-2xl">What would you like to know?</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {caps.map((c) => (
                <button key={c} className="chip px-3 py-1.5 text-sm hover:border-sage" onClick={() => ask(c)}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="ml-auto w-fit max-w-[85%] rounded-[14px] rounded-br-sm bg-forest px-4 py-2.5 text-ivory">
              {m.text}
            </div>
          ) : (
            <div key={i} className="max-w-[min(42rem,95%)] space-y-3">
              {m.reply.safety_notes.length > 0 && (
                <div className="rounded-[6px] border border-alarm/30 bg-alarm-pale/50 p-3 text-sm">
                  <div className="flex items-center gap-2 font-medium text-alarm">
                    <ShieldAlert className="size-4" /> Safety guidance from your records
                  </div>
                  {m.reply.safety_notes.map((s) => (
                    <p key={s} className="mt-1">
                      {s}
                    </p>
                  ))}
                </div>
              )}
              <div className="rounded-[14px] rounded-bl-sm border border-line bg-porcelain px-4 py-3">
                <RichText text={m.reply.text} />
                {m.reply.measured.length > 0 && (
                  <div className="mt-3 border-t border-line pt-3">
                    <div className="text-xs font-semibold text-forest">Measured by AI scans</div>
                    <ul className="mt-1 space-y-0.5 font-mono text-[0.8rem]">
                      {m.reply.measured.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {m.reply.reported.length > 0 && (
                  <div className="mt-3 border-t border-line pt-3">
                    <div className="text-xs font-semibold text-charcoal">Reported by you</div>
                    <ul className="mt-1 space-y-0.5 text-sm">
                      {m.reply.reported.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {m.reply.insufficient_data && <p className="mt-3 text-sm text-ochre">There isn’t enough data to answer this fully yet.</p>}
                {m.reply.citations.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <span className="text-xs text-grey">Sources:</span>
                    {m.reply.citations.map((c) => (
                      <Link key={`${c.type}-${c.id}`} to={citeHref(c)} className="chip text-xs hover:border-sage">
                        {c.label}
                      </Link>
                    ))}
                  </div>
                )}
                {m.reply.suggestions.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {m.reply.suggestions.map((c) => (
                      <button key={c} className="chip hover:border-sage" onClick={() => ask(c)}>
                        {c}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <p className="meta pl-1">
                {MODE_LABEL[m.reply.mode]} · intent: {m.reply.intent}
              </p>
            </div>
          ),
        )}
        {busy && <div className="w-fit animate-pulse rounded-[14px] border border-line bg-porcelain px-4 py-3 text-sm text-grey">Looking through your records…</div>}
        {err && <ErrorNote error={err} />}
        <div ref={endRef} />
      </div>

      <form
        className="sticky bottom-20 mt-8 flex gap-2 rounded-full border border-line bg-porcelain p-1.5 pl-5 shadow-[0_10px_30px_-20px_rgb(38_40_35/.5)] lg:bottom-6"
        onSubmit={(e) => {
          e.preventDefault()
          ask(input)
        }}
      >
        <input className="min-w-0 flex-1 bg-transparent outline-none" placeholder="Ask about your skin data" value={input} maxLength={1000} onChange={(e) => setInput(e.target.value)} aria-label="Your question" />
        <button className="btn btn-primary size-10 min-h-10 p-0" disabled={!input.trim() || busy} aria-label="Send">
          <ArrowUp className="size-4" />
        </button>
      </form>
    </div>
  )
}
