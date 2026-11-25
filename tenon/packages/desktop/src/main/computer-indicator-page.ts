const watchers = new Set<(stop: boolean) => void>()

export function notifyStop() {
  for (const watcher of watchers) watcher(true)
  watchers.clear()
}

export function indicatorPage(input: { label: string; stop: string; dark: boolean }) {
  const escape = (value: string) => value.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`)
  const bg = input.dark ? "#2e2e2e" : "#ffffff"
  const fg = input.dark ? "#f2f2f2" : "#161616"
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><style>
html,body{margin:0;height:100%;background:transparent;font:13px system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden}
.pill{display:flex;align-items:center;gap:8px;height:40px;padding:0 4px 0 14px;border-radius:9999px;background:${bg};color:${fg};box-shadow:0 0 0 1px rgb(128 128 128/.3);-webkit-app-region:drag}
.dot{width:8px;height:8px;border-radius:50%;background:#3b5cf6;animation:b 2s ease-in-out infinite}
@keyframes b{50%{transform:scale(1.2);opacity:.6}}
@media (prefers-reduced-motion:reduce){.dot{animation:none}}
span{white-space:nowrap}
button{-webkit-app-region:no-drag;border:0;border-radius:9999px;height:32px;padding:0 14px;background:${fg};color:${bg};font:inherit;font-weight:600;cursor:pointer}
</style></head><body><div class="pill"><i class="dot"></i><span>${escape(input.label)}</span><button onclick="document.title='stop'">${escape(input.stop)}</button></div></body></html>`
}

export const GLOW_COLOR = "#3b5cf6"

export function glowPage(input: { color?: string } = {}) {
  const color = /^#[0-9a-f]{6}$/i.test(input.color ?? "") ? input.color! : GLOW_COLOR
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden}
.glow{position:fixed;inset:0;pointer-events:none;box-shadow:inset 0 0 0 2px ${color}cc,inset 0 0 24px 6px ${color}99,inset 0 0 64px 12px ${color}40;animation:g 2.4s ease-in-out infinite}
@keyframes g{50%{opacity:.6}}
@media (prefers-reduced-motion:reduce){.glow{animation:none}}
</style></head><body><div class="glow"></div></body></html>`
}

export function watch(signal: AbortSignal) {
  return new Promise<{ text: string }>((resolve) => {
    const done = (stop: boolean) => {
      clearTimeout(timer)
      watchers.delete(done)
      resolve({ text: JSON.stringify({ stop }) })
    }
    const timer = setTimeout(() => done(false), 60_000)
    watchers.add(done)
    signal.addEventListener("abort", () => done(false), { once: true })
  })
}
