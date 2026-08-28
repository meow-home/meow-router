/// <reference types="vite/client" />

import type { WindowApi } from '@shared/ipc'

declare global {
  interface Window {
    meowGateway: WindowApi
  }
}

export {}
