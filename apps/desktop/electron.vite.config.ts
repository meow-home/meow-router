import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // The internal @meow-gateway/* workspace packages expose TS source
    // (`main: ./src/index.ts`) and have no build output, so they must be bundled
    // into the main bundle rather than externalized. Everything else from node_modules
    // stays external.
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@meow-gateway/provider-core', '@meow-gateway/provider-openai', '@meow-gateway/provider-deepseek']
      })
    ]
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // The BrowserWindow runs with `sandbox: true` (a deliberate security
        // choice). Electron requires sandboxed preload scripts to be CommonJS,
        // so we must emit a `.cjs` bundle even though the package is `type: module`.
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    root: resolve('src/render'),
    build: {
      outDir: resolve('out/render'),
      rollupOptions: {
        input: resolve('src/render/index.html')
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/render/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()]
  }
})
