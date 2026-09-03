import { defineConfig } from "vite";

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // better-sqlite3 and node-pty are native modules — they must be loaded
      // via require() at runtime, not bundled, and rebuilt against
      // Electron's ABI (handled by Forge's rebuildConfig in forge.config.ts).
      //
      // bufferutil/utf-8-validate are optional native perf add-ons `ws`
      // tries to require if present (ws itself is only pulled in
      // transitively by @deepgram/sdk's websocket client, which Voice v1
      // never uses — only the batch transcription endpoint). Neither
      // package is installed, and ws's own runtime require is already
      // wrapped in a try/catch, so this is safe to externalize rather than
      // add two native dependencies purely to satisfy static bundling.
      external: ["better-sqlite3", "node-pty", "bufferutil", "utf-8-validate"],
    },
  },
});
