import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import fs from "node:fs";
import path from "node:path";

const config: ForgeConfig = {
  packagerConfig: {
    name: "Tako",
    asar: {
      unpack: "*.{node,dylib,so}",
    },
    icon: "assets/icon.icns",
  },
  hooks: {
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      const nativeModules = ["better-sqlite3", "node-pty", "bindings", "file-uri-to-path", "prebuild-install"];
      const targetNodeModules = path.join(buildPath, "node_modules");
      fs.mkdirSync(targetNodeModules, { recursive: true });
      for (const mod of nativeModules) {
        const srcPath = path.join(process.cwd(), "node_modules", mod);
        const destPath = path.join(targetNodeModules, mod);
        if (fs.existsSync(srcPath)) {
          fs.cpSync(srcPath, destPath, { recursive: true, dereference: true });
        }
      }
    },
  },
  rebuildConfig: {
    onlyModules: ["better-sqlite3", "node-pty"],
  },
  makers: [
    new MakerZIP({}, ["darwin"]),
    new MakerDMG(
      {
        background: "assets/dmg-background.png",
        icon: "assets/icon.icns",
        iconSize: 128,
        format: "ULFO",
        window: {
          size: { width: 660, height: 400 },
        },
        contents: (opts) => [
          { x: 180, y: 170, type: "file", path: opts.appPath },
          { x: 480, y: 170, type: "link", path: "/Applications" },
        ],
      },
      ["darwin"],
    ),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: "src/main/main.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "src/preload/index.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
  ],
};

export default config;
