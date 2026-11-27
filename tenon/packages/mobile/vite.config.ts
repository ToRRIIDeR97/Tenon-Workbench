import { defineConfig } from "vite"
import appPlugin from "../app/vite"

export default defineConfig({
  plugins: [appPlugin],
  root: "src",
  publicDir: "../../app/public",
  base: "/",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
  },
  optimizeDeps: {
    include: [
      "@tenon/session-ui > @shikijs/stream",
      "@tenon/session-ui > shiki",
      "@tenon/session-ui > marked",
      "@tenon/session-ui > remend",
      "@tenon/ui > katex",
      "@tenon/ui > marked-shiki",
    ],
  },
})
