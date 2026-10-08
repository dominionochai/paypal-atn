/**
 * Global configuration for the Marionette extension
 */

export type Screen = 'main' | 'debug' | 'settings'

/**
 * Default screen to show when opening the popup or side panel
 * Set to 'debug' to open the debug screen by default
 * Set to 'main' to open the main screen by default
 * Set to 'settings' to open the settings screen by default
 */
export const DEFAULT_SCREEN: Screen = 'main'
