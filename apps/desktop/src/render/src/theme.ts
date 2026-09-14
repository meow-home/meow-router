export type Theme = 'dark' | 'light'

export const THEME_STORAGE_KEY = 'meow.theme'

export function getTheme(): Theme {
  return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark'
}

export function applyTheme(theme?: Theme): void {
  const resolved = theme ?? getTheme()
  document.documentElement.setAttribute('data-theme', resolved)
}

export function watchTheme(onChange?: (theme: Theme) => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_STORAGE_KEY) return
    const theme = getTheme()
    applyTheme(theme)
    onChange?.(theme)
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}
