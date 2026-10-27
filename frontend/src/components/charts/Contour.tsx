// The signature motif: topographic contour lines. Purely decorative unless
// `values` is passed, in which case each ring's shape is shaped by the values
// (used in the hero preview). Deterministic for a given seed.

function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

function smoothClosed(points: [number, number][]) {
  const n = points.length
  let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n], p1 = points[i], p2 = points[(i + 1) % n], p3 = points[(i + 2) % n]
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d + 'Z'
}

export function contourPaths(opts: { cx: number; cy: number; rings: number; rMax: number; rMin?: number; seed?: number; wobble?: number; aspect?: number; values?: number[] }) {
  const { cx, cy, rings, rMax, rMin = rMax * 0.12, seed = 7, wobble = 0.12, aspect = 0.78, values } = opts
  const r = rng(seed)
  const harmonics = Array.from({ length: 4 }, (_, k) => ({ f: k + 2, phase: r() * Math.PI * 2, amp: (r() * 0.6 + 0.4) / (k + 1) }))
  const paths: string[] = []
  const steps = 36
  for (let i = 0; i < rings; i++) {
    const t = rings === 1 ? 1 : i / (rings - 1)
    const radius = rMin + (rMax - rMin) * t
    const drift = (1 - t) * rMax * 0.08
    const pts: [number, number][] = []
    for (let s = 0; s < steps; s++) {
      const a = (s / steps) * Math.PI * 2
      let m = 0
      for (const h of harmonics) m += Math.sin(a * h.f + h.phase + t * 1.3) * h.amp
      if (values && values.length) {
        const v = values[Math.floor((s / steps) * values.length) % values.length]
        m += ((v - 60) / 40) * 0.6
      }
      const rr = radius * (1 + wobble * m)
      pts.push([cx + Math.cos(a) * rr + drift, cy + Math.sin(a) * rr * aspect - drift * 0.6])
    }
    paths.push(smoothClosed(pts))
  }
  return paths
}

export function Contour({ className = '', rings = 9, seed = 7, stroke = 'currentColor', accentIndex, animate = false, values, wobble }: { className?: string; rings?: number; seed?: number; stroke?: string; accentIndex?: number; animate?: boolean; values?: number[]; wobble?: number }) {
  const paths = contourPaths({ cx: 200, cy: 160, rings, rMax: 170, seed, values, wobble })
  return (
    <svg viewBox="0 0 400 320" className={`${className} ${animate ? 'contour-draw' : ''}`} aria-hidden fill="none">
      {paths.map((d, i) => (
        <path
          key={i}
          d={d}
          stroke={i === accentIndex ? 'var(--color-rose)' : stroke}
          strokeWidth={i === accentIndex ? 1.6 : 1}
          opacity={i === accentIndex ? 1 : 0.35 + (0.5 * (rings - i)) / rings}
          style={animate ? { animationDelay: `${(rings - i) * 90}ms` } : undefined}
        />
      ))}
    </svg>
  )
}

export function Logo({ className = 'size-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="7" fill="var(--color-forest)" />
      <g fill="none" strokeWidth="1.6">
        <ellipse cx="16" cy="16" rx="10" ry="7.5" stroke="var(--color-ivory)" />
        <ellipse cx="16" cy="16.5" rx="6.2" ry="4.4" stroke="var(--color-ivory)" />
        <ellipse cx="16" cy="17" rx="2.6" ry="1.8" stroke="var(--color-rose)" />
      </g>
    </svg>
  )
}
