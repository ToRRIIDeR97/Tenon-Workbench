import { onCleanup } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { showToast } from "@/utils/toast"

export function HarnessSyncNotifier() {
  const language = useLanguage()
  const platform = usePlatform()
  const off = platform.harnessSync?.onChange((notice) => {
    if (!notice) return
    showToast({
      icon: "circle-check",
      title: language.t("harness.sync.remoteToast", { name: notice.from }),
      description: language.t("harness.sync.remoteToast.detail", { tools: notice.tools, skills: notice.skills }),
    })
  })
  onCleanup(() => off?.())
  return null
}
