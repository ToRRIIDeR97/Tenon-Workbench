import type { ViewItem } from "@tenon/session-ui/view-window"

type Content = { content: string; encoding?: string; mimeType?: string; type?: string } | undefined

export type ViewRendererLabels = {
  loading: string
  /** The button that loads a file from the web, with the host name. */
  loadFrom: (host: string) => string
  missing: string
  outside: string
  noPreview: string
  modelFailed: string
}

const TEXT_TYPES: Partial<Record<ViewItem["kind"], string>> = { model: "model/gltf+json", pdf: "application/pdf" }

/** Lines of a text file shown in its window; Open shows the rest. */
const EXCERPT_LINES = 40

/**
 * Draws a ```view window's file. Media and PDFs load through the desktop's `tenon-file://` URL when there is one,
 * else from the base64 the server read. Text shows an excerpt; sheets and Word documents say to open them, where the
 * file viewer renders them in full. 3D models load three.js only when one is shown.
 */
export function createViewRenderer(input: {
  /** The folder and relative path a `view` line names: the thread's folder, or a Project's; undefined for neither. */
  locate: (src: string) => { readonly directory: string; readonly path: string } | undefined
  fileURL?: (directory: string, path: string) => Promise<string | undefined>
  read: (directory: string, path: string) => Promise<Content>
  labels: () => ViewRendererLabels
}) {
  // A file the server read as text (a .gltf, a plain PDF) becomes a blob URL, freed with its window.
  const urlFor = async (directory: string, path: string, kind: ViewItem["kind"]) => {
    const url = await input.fileURL?.(directory, path).catch(() => undefined)
    if (url) return { url }
    const read = await input.read(directory, path).catch(() => undefined)
    if (!read) return undefined
    if (read.encoding === "base64") return { url: `data:${read.mimeType ?? ""};base64,${read.content}` }
    const blob = URL.createObjectURL(new Blob([read.content], { type: read.mimeType || TEXT_TYPES[kind] || "" }))
    return { url: blob, revoke: () => URL.revokeObjectURL(blob) }
  }

  return (host: HTMLElement, item: ViewItem) => {
    const labels = input.labels()
    let disposed = false
    let cleanup: (() => void) | undefined
    const notice = (text: string) => {
      host.replaceChildren(element("div", { "data-slot": "view-window-notice" }, text))
    }
    notice(labels.loading)

    const draw = async () => {
      // Only an https URL is shown from the web, and only as media, and only when the user asks: loading it on sight
      // would tell its host the thread was opened (the beacon the app's image policy is headed to block).
      if (item.remote) {
        if (item.kind !== "image" && item.kind !== "video" && item.kind !== "audio") return notice(labels.noPreview)
        const load = element("button", { type: "button", "data-action": "view-load-remote" })
        load.textContent = labels.loadFrom(new URL(item.src).host)
        load.addEventListener("click", () =>
          host.replaceChildren(
            item.kind === "image" ? media("img", item.src, item.name) : media(item.kind as "video" | "audio", item.src),
          ),
        )
        const wrap = element("div", { "data-slot": "view-window-notice" })
        wrap.append(load)
        return host.replaceChildren(wrap)
      }
      const located = input.locate(item.src)
      if (!located) return notice(labels.outside)
      const { directory, path } = located
      if (item.kind === "markdown" || item.kind === "csv" || item.kind === "json" || item.kind === "file") {
        const content = await input.read(directory, path).catch(() => undefined)
        if (!content) return notice(labels.missing)
        if (content.encoding === "base64" || content.type === "binary") return notice(labels.noPreview)
        const lines = content.content.split(/\r?\n/)
        const more = lines.length > EXCERPT_LINES ? "\n…" : ""
        return host.replaceChildren(
          element("pre", { "data-slot": "view-text" }, lines.slice(0, EXCERPT_LINES).join("\n") + more),
        )
      }
      if (item.kind === "sheet" || item.kind === "doc") return notice(labels.noPreview)
      const found = await urlFor(directory, path, item.kind)
      if (disposed) return found?.revoke?.()
      if (!found) return notice(labels.missing)
      const revoke = found.revoke
      if (revoke) cleanup = revoke
      const url = found.url
      if (item.kind === "image") return host.replaceChildren(media("img", url, item.name))
      if (item.kind === "video" || item.kind === "audio") return host.replaceChildren(media(item.kind, url))
      if (item.kind === "pdf") return host.replaceChildren(element("iframe", { src: url, title: item.name }))
      if (item.kind === "model") {
        const stage = element("div", { "data-slot": "view-model" })
        host.replaceChildren(stage)
        const stop = await renderModel(stage, url).catch(() => {
          notice(labels.modelFailed)
          return undefined
        })
        cleanup = () => {
          stop?.()
          revoke?.()
        }
        if (disposed) cleanup()
      }
    }
    void draw()
    return () => {
      disposed = true
      cleanup?.()
    }
  }
}

function media(tag: "img" | "video" | "audio", src: string, alt?: string) {
  const el = document.createElement(tag)
  el.src = src
  if (tag === "img") {
    ;(el as HTMLImageElement).alt = alt ?? ""
    ;(el as HTMLImageElement).loading = "lazy"
  }
  if (tag !== "img") {
    ;(el as HTMLMediaElement).controls = true
    ;(el as HTMLMediaElement).preload = "metadata"
  }
  return el
}

function element(tag: string, attrs: Record<string, string>, text?: string) {
  const el = document.createElement(tag)
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value)
  if (text !== undefined) el.textContent = text
  return el
}

/**
 * A glTF/GLB model on a turntable: orbit with the mouse, zoom with the wheel. three.js is loaded on first use. Returns
 * a cleanup that stops the loop and frees the GPU resources.
 */
async function renderModel(stage: HTMLElement, url: string) {
  const [THREE, { GLTFLoader }, { OrbitControls }] = await Promise.all([
    import("three"),
    import("three/examples/jsm/loaders/GLTFLoader.js"),
    import("three/examples/jsm/controls/OrbitControls.js"),
  ])
  const width = stage.clientWidth || 640
  const height = stage.clientHeight || 480
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(width, height)
  stage.appendChild(renderer.domElement)
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2))
  const key = new THREE.DirectionalLight(0xffffff, 2)
  key.position.set(3, 5, 4)
  scene.add(key)
  const camera = new THREE.PerspectiveCamera(40, width / height, 0.01, 1000)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.autoRotate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  controls.autoRotateSpeed = 1.2

  const gltf = await new GLTFLoader().loadAsync(url)
  scene.add(gltf.scene)
  // Frame the model: centre it and back the camera off to fit its bounding sphere.
  const box = new THREE.Box3().setFromObject(gltf.scene)
  const sphere = box.getBoundingSphere(new THREE.Sphere())
  const radius = sphere.radius || 1
  controls.target.copy(sphere.center)
  camera.position.copy(sphere.center).add(new THREE.Vector3(radius * 1.6, radius * 0.9, radius * 2.2))
  camera.near = radius / 100
  camera.far = radius * 100
  camera.updateProjectionMatrix()

  let frame = 0
  const loop = () => {
    frame = requestAnimationFrame(loop)
    controls.update()
    renderer.render(scene, camera)
  }
  loop()
  const resize = new ResizeObserver(() => {
    const w = stage.clientWidth
    const h = stage.clientHeight
    if (!w || !h) return
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  })
  resize.observe(stage)
  return () => {
    cancelAnimationFrame(frame)
    resize.disconnect()
    controls.dispose()
    scene.traverse((object) => {
      const mesh = object as { geometry?: { dispose(): void }; material?: { dispose(): void } | { dispose(): void }[] }
      mesh.geometry?.dispose()
      const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
      materials.forEach((material) => material.dispose())
    })
    renderer.dispose()
    renderer.domElement.remove()
  }
}
