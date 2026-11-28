import { render } from "solid-js/web"
import { AppBaseProviders, AppInterface } from "@/app"
import { loadInitialLocale } from "@/context/language"
import { type Platform, PlatformProvider } from "@/context/platform"
import { ServerConnection } from "@/context/server"
import { createBrowserDraftStore } from "@/utils/draft-store"
import pkg from "../package.json"
import { bearerFetch, companionSession, seedWorkspaces, threadDirectories, type Pairing } from "./companion"
import { PairingScreen } from "./pairing-screen"
import { secureStore } from "./secure-store"
import { phoneNotifier } from "./notifications"

const WORKSPACES_KEY = "tenon.global.dat:server"
const session = companionSession(secureStore())
const plainFetch = globalThis.fetch.bind(globalThis)

const basePlatform = {
  platform: "web" as const,
  draftStore: createBrowserDraftStore(),
  version: pkg.version,
  openExternal: (value: string) => {
    const url = parseURL(value)
    if (!url || (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "mailto:")) return
    window.open(url.href, "_blank", "noopener,noreferrer")
  },
  restart: async () => window.location.replace("/"),
  notify: phoneNotifier(),
} satisfies Platform

async function start() {
  const root = document.getElementById("root")
  if (!(root instanceof HTMLElement)) return
  const locale = await loadInitialLocale()
  const pairing = await session.load()
  if (!pairing) {
    render(
      () => (
        <PlatformProvider value={basePlatform}>
          <AppBaseProviders locale={locale}>
            <PairingScreen
              onPaired={async (paired) => {
                await session.save(paired)
                window.location.replace("/")
              }}
            />
          </AppBaseProviders>
        </PlatformProvider>
      ),
      root,
    )
    return
  }
  await seedFromComputer(pairing)
  render(() => <Connected pairing={pairing} locale={locale} />, root)
}

async function seedFromComputer(pairing: Pairing) {
  const answer = await bearerFetch(
    plainFetch,
    pairing,
  )(`${pairing.url}/api/session?limit=100`)
    .then((response) => (response.ok ? response.json() : undefined))
    .catch(() => undefined)
  const seeded = seedWorkspaces(localStorage.getItem(WORKSPACES_KEY), threadDirectories(answer))
  if (seeded) localStorage.setItem(WORKSPACES_KEY, seeded)
}

function Connected(props: { pairing: Pairing; locale: Awaited<ReturnType<typeof loadInitialLocale>> }) {
  const fetch = Object.assign(bearerFetch(plainFetch, props.pairing), { preconnect: globalThis.fetch.preconnect })
  globalThis.fetch = fetch
  const server: ServerConnection.Http = { type: "http", http: { url: props.pairing.url } }
  const platform: Platform = {
    ...basePlatform,
    fetch,
    companion: {
      url: props.pairing.url,
      name: props.pairing.name,
      signOut: async () => {
        await session.signOut()
        window.location.replace("/")
      },
    },
  }
  return (
    <PlatformProvider value={platform}>
      <AppBaseProviders locale={props.locale}>
        <AppInterface
          defaultServer={ServerConnection.key(server)}
          canonicalLocalServer={ServerConnection.key(server)}
          servers={[server]}
          disableHealthCheck
          surface="app"
        />
      </AppBaseProviders>
    </PlatformProvider>
  )
}

void start()

function parseURL(value: string) {
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}
