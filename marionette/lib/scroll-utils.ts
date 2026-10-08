// Shared scroll utility constants and functions

export const SCROLL_DELTA = 500 // pixels to scroll per action

export function smoothScrollBy(deltaY: number): void {
  window.scrollBy({
    top: deltaY,
    behavior: 'smooth'
  })
}
