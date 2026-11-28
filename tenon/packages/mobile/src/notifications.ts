import { LocalNotifications } from "@capacitor/local-notifications"

const MAX_ID = 2 ** 31 - 1
const KEPT_CALLBACKS = 50

export function notificationId(key: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return (hash % (MAX_ID - 1)) + 1
}

export function shouldNotify(view: { visible: boolean; focused: boolean }) {
  return !view.visible
}

export function phoneNotifier() {
  const callbacks = new Map<number, () => void>()
  let permission: Promise<boolean> | undefined
  let listening = false

  const allowed = () =>
    (permission ??= LocalNotifications.checkPermissions()
      .then((status) => (status.display === "granted" ? status : LocalNotifications.requestPermissions()))
      .then((status) => status.display === "granted")
      .catch(() => false))

  const listen = () => {
    if (listening) return
    listening = true
    void LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
      const run = callbacks.get(action.notification.id)
      callbacks.delete(action.notification.id)
      run?.()
    }).catch(() => {
      listening = false
    })
  }

  return async (title: string, description?: string, onClick?: () => void) => {
    if (!shouldNotify({ visible: document.visibilityState === "visible", focused: document.hasFocus() })) return
    if (!(await allowed())) return
    listen()
    const id = notificationId(`${title}\u0000${description ?? ""}\u0000${Date.now()}`)
    if (onClick) {
      callbacks.set(id, onClick)
      while (callbacks.size > KEPT_CALLBACKS) callbacks.delete(callbacks.keys().next().value!)
    }
    await LocalNotifications.schedule({ notifications: [{ id, title, body: description ?? "" }] }).catch(
      () => undefined,
    )
  }
}
