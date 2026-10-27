import { lazy, Suspense } from 'react'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import { Spinner } from './components/ui'
import { RefreshProvider, ToastProvider } from './lib/hooks'
import Landing from './pages/Landing'

const Overview = lazy(() => import('./pages/Overview'))
const Analysis = lazy(() => import('./pages/Analysis'))
const Progress = lazy(() => import('./pages/Progress'))
const Routine = lazy(() => import('./pages/Routine'))
const Library = lazy(() => import('./pages/Library'))
const Companion = lazy(() => import('./pages/Companion'))
const Settings = lazy(() => import('./pages/Settings'))

function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-5 py-24">
      <h1 className="text-4xl">This page doesn’t exist.</h1>
      <p className="mt-2 text-grey">The link may be out of date.</p>
      <Link to="/app" className="btn btn-primary mt-6">
        Go to Overview
      </Link>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <RefreshProvider>
        <ToastProvider>
          <Suspense fallback={<div className="mx-auto max-w-6xl px-8"><Spinner /></div>}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/app" element={<AppShell />}>
                <Route index element={<Overview />} />
                <Route path="analysis" element={<Analysis />} />
                <Route path="progress" element={<Progress />} />
                <Route path="routine" element={<Routine />} />
                <Route path="library" element={<Library />} />
                <Route path="companion" element={<Companion />} />
                <Route path="settings" element={<Settings />} />
                <Route path="*" element={<NotFound />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </ToastProvider>
      </RefreshProvider>
    </BrowserRouter>
  )
}
