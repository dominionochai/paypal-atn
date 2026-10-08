/**
 * Settings management for Marionette
 */

export interface MarionetteSettings {
  captureOverlayEnabled: boolean
  globalShortcutsEnabled: boolean
  textSelectionEnabled: boolean
  writeCommandEnabled: boolean
}

export const DEFAULT_SETTINGS: MarionetteSettings = {
  captureOverlayEnabled: false,
  globalShortcutsEnabled: false,
  textSelectionEnabled: false,
  writeCommandEnabled: false
}

/**
 * Load settings from chrome.storage.local
 */
export async function loadSettings(): Promise<MarionetteSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get('marionette_settings', (result) => {
      if (result.marionette_settings) {
        resolve({ ...DEFAULT_SETTINGS, ...result.marionette_settings })
      } else {
        resolve(DEFAULT_SETTINGS)
      }
    })
  })
}

/**
 * Save settings to chrome.storage.local
 */
export async function saveSettings(settings: MarionetteSettings): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ marionette_settings: settings }, () => {
      resolve()
    })
  })
}

/**
 * Get a hex color with opacity as rgba string
 */
export function hexToRgba(hex: string, opacity: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}

