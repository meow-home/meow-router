import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
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
