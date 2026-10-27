import { Bell, BookOpen, CalendarCheck, LayoutGrid, LineChart, MessageCircle, MoreHorizontal, ScanFace, Settings, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useApi } from '../../lib/hooks'
import { api } from '../../services/api'
import { fmtDate } from '../../lib/format'
import { Logo } from '../charts/Contour'
import { DemoBanner, LevelIcon } from '../ui'

export const NAV = [
  { to: '/app', label: 'Overview', icon: LayoutGrid, end: true },
  { to: '/app/analysis', label: 'Skin Analysis', icon: ScanFace },
  { to: '/app/progress', label: 'My Progress', icon: LineChart },
  { to: '/app/routine', label: 'My Routine', icon: CalendarCheck },
  { to: '/app/library', label: 'Product Library', icon: BookOpen },
  { to: '/app/companion', label: 'AI Skin Companion', icon: MessageCircle },
  { to: '/app/settings', label: 'Settings', icon: Settings },
]
const MOBILE_PRIMARY = NAV.slice(0, 4)
const MOBILE_MORE = NAV.slice(4)

function Notifications() {
  const { data } = useApi(() => api.guidance())
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  const important = (data?.cards ?? []).filter((c) => c.level === 'urgent' || c.level === 'caution')
  const due = data && new Date(data.next_checkin_due) <= new Date()
  const count = important.length + (due ? 1 : 0)
  return (
    <div className="relative" ref={ref}>
      <button className="btn btn-quiet relative" aria-label={`Notifications${count ? `, ${count} new` : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Bell className="size-5" />
        {count > 0 && (
          <span className={`absolute right-1 top-1 grid size-4 place-items-center rounded-full text-[10px] font-semibold text-porcelain ${important.some((c) => c.level === 'urgent') ? 'bg-alarm' : 'bg-forest'}`}>
            {count}
          </span>
        )}
      </button>
      {open && (
        <div className="page-in panel absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] p-2 shadow-[0_18px_40px_-20px_rgb(38_40_35/.45)]">
          {count === 0 && <p className="p-3 text-sm text-grey">Nothing needs your attention right now.</p>}
          {due && (
            <Link to="/app/progress#checkin" onClick={() => setOpen(false)} className="flex gap-3 rounded p-3 hover:bg-ivory">
              <CalendarCheck className="size-5 text-forest" aria-hidden />
              <span className="text-sm">
                Check-in due since {fmtDate(data!.next_checkin_due)}
              </span>
            </Link>
          )}
          {important.map((c) => (
            <Link key={c.id} to="/app" onClick={() => setOpen(false)} className="flex gap-3 rounded p-3 hover:bg-ivory">
              <LevelIcon level={c.level} />
              <span className="text-sm">{c.title}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AppShell() {
  const { data: overview } = useApi(() => api.overview())
  const [more, setMore] = useState(false)
  const loc = useLocation()
  useEffect(() => {
    setMore(false)
    window.scrollTo({ top: 0 })
  }, [loc.pathname])
  const name = overview?.profile.display_name

  return (
    <div className="min-h-dvh lg:pl-64">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] focus:rounded focus:bg-porcelain focus:px-3 focus:py-2">
        Skip to content
      </a>

      {/* Desktop rail */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-line bg-porcelain lg:flex">
        <Link to="/" className="flex items-center gap-2.5 px-6 pb-6 pt-7">
          <Logo />
          <span className="font-serif text-[1.3rem] leading-none">DermaTrack</span>
        </Link>
        <nav aria-label="Primary" className="flex-1 px-3">
          <ul className="space-y-0.5">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    `relative flex items-center gap-3 rounded-[5px] px-3 py-2 text-[0.93rem] transition-colors ${
                      isActive ? 'bg-sage-pale font-medium text-forest before:absolute before:-left-3 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r before:bg-forest' : 'text-charcoal/80 hover:bg-ivory'
                    }`
                  }
                >
                  <Icon className="size-[18px]" aria-hidden />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="m-3 rounded-[6px] border border-line p-4 text-sm">
          <p className="font-serif text-lg leading-snug">Analyse, track, review, adapt.</p>
          <Link to="/app/analysis" className="btn btn-primary mt-3 w-full">
            <ScanFace className="size-4" /> New scan
          </Link>
        </div>
      </aside>

      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-line bg-ivory/90 backdrop-blur">
        {overview?.has_demo && <DemoBanner />}
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 md:px-8">
          <Link to="/" className="flex items-center gap-2 lg:hidden">
            <Logo className="size-6" />
            <span className="font-serif text-lg">DermaTrack</span>
          </Link>
          <span className="hidden text-sm text-grey lg:block">{name ? `Signed in locally as ${name}` : 'Local profile'}</span>
          <div className="flex items-center gap-1">
            <Notifications />
            <Link to="/app/settings" className="btn btn-quiet" aria-label="Profile and settings">
              <span className="grid size-7 place-items-center rounded-full bg-forest text-xs font-semibold text-ivory">{(name || 'You').slice(0, 1).toUpperCase()}</span>
            </Link>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-6xl px-4 pb-28 pt-8 md:px-8 lg:pb-16">
        <div key={loc.pathname} className="page-in">
          <Outlet />
        </div>
      </main>

      {/* Mobile tab bar */}
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-porcelain pb-[env(safe-area-inset-bottom)] lg:hidden">
        <ul className="grid grid-cols-5">
          {MOBILE_PRIMARY.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink to={to} end={end} className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2 text-[11px] ${isActive ? 'font-medium text-forest' : 'text-grey'}`}>
                <Icon className="size-5" aria-hidden />
                {label.replace('My ', '').replace('Skin ', '')}
              </NavLink>
            </li>
          ))}
          <li>
            <button onClick={() => setMore(true)} className={`flex w-full flex-col items-center gap-0.5 py-2 text-[11px] ${MOBILE_MORE.some((n) => loc.pathname.startsWith(n.to)) ? 'font-medium text-forest' : 'text-grey'}`} aria-haspopup="dialog">
              <MoreHorizontal className="size-5" aria-hidden />
              More
            </button>
          </li>
        </ul>
      </nav>
      {more && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="More sections">
          <button className="absolute inset-0 bg-charcoal/30" onClick={() => setMore(false)} aria-label="Close" />
          <div className="page-in absolute inset-x-0 bottom-0 rounded-t-[14px] bg-porcelain p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-serif text-xl">More</span>
              <button className="btn btn-quiet" onClick={() => setMore(false)} aria-label="Close">
                <X className="size-5" />
              </button>
            </div>
            {MOBILE_MORE.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className="flex items-center gap-3 rounded px-3 py-3 hover:bg-ivory">
                <Icon className="size-5 text-forest" aria-hidden /> {label}
              </NavLink>
            ))}
            <Link to="/" className="flex items-center gap-3 rounded px-3 py-3 text-grey hover:bg-ivory">
              <Sparkles className="size-5" aria-hidden /> About DermaTrack
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
