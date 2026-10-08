import { useCallback, useRef } from 'react'
import { Howl } from 'howler'

export type SoundEffect = 
  | 'warmup'
  | 'thinking'
  | 'tool'
  | 'success'
  | 'error'
  | 'listening'
  | 'speaking'
  | 'screenshot'
  | 'audioCapture'
  | 'summarizing'

interface SoundConfig {
  src: string
  volume?: number
  loop?: boolean
}

// Sound configurations mapped to downloaded files
const SOUND_MAP: Record<SoundEffect, SoundConfig> = {
  warmup: { src: chrome.runtime.getURL('assets/long-expected-548.ogg'), volume: 0.3 }, // Used for response completion
  thinking: { src: chrome.runtime.getURL('assets/confident-543.ogg'), volume: 0.2 },
  tool: { src: chrome.runtime.getURL('assets/slick-notification.ogg'), volume: 0.4 },
  success: { src: chrome.runtime.getURL('assets/cheerful-527.ogg'), volume: 0.3 },
  error: { src: chrome.runtime.getURL('assets/closure-542.ogg'), volume: 0.4 },
  listening: { src: chrome.runtime.getURL('assets/when-604.ogg'), volume: 0.3 },
  speaking: { src: chrome.runtime.getURL('assets/closure-542.ogg'), volume: 0.15 },
  screenshot: { src: chrome.runtime.getURL('assets/camera-shutter-close.wav'), volume: 0.4 },
  audioCapture: { src: chrome.runtime.getURL('assets/cd-sound.wav'), volume: 0.4 },
  summarizing: { src: chrome.runtime.getURL('assets/cd-sound.wav'), volume: 0.25 }
}

export const useSoundEffects = () => {
  const soundsRef = useRef<Map<SoundEffect, Howl>>(new Map())

  const loadSound = useCallback((effect: SoundEffect) => {
    if (soundsRef.current.has(effect)) {
      console.log(`[SoundEffects] Sound "${effect}" already loaded`)
      return soundsRef.current.get(effect)!
    }

    const config = SOUND_MAP[effect]
    
    // Skip if no source file yet
    if (!config.src) {
      console.error(`[SoundEffects] No source configured for "${effect}"`)
      return null
    }

    console.log(`[SoundEffects] Loading sound "${effect}" from:`, config.src)
    
    const sound = new Howl({
      src: [config.src],
      volume: config.volume || 0.3,
      loop: config.loop || false,
      onload: () => {
        console.log(`[SoundEffects] ✓ Sound "${effect}" loaded successfully`)
      },
      onloaderror: (id, error) => {
        console.error(`[SoundEffects] ✗ Failed to load "${effect}":`, error)
      },
      onplayerror: (id, error) => {
        console.error(`[SoundEffects] ✗ Failed to play "${effect}":`, error)
      }
    })

    soundsRef.current.set(effect, sound)
    return sound
  }, [])

  const play = useCallback((effect: SoundEffect) => {
    console.log(`[SoundEffects] Attempting to play "${effect}"`)
    const sound = loadSound(effect)
    if (sound) {
      sound.play()
      console.log(`[SoundEffects] play() called for "${effect}"`)
    } else {
      console.error(`[SoundEffects] Failed to load sound for "${effect}"`)
    }
  }, [loadSound])

  const stop = useCallback((effect: SoundEffect) => {
    const sound = soundsRef.current.get(effect)
    if (sound) {
      sound.stop()
    }
  }, [])

  const stopAll = useCallback(() => {
    soundsRef.current.forEach(sound => sound.stop())
  }, [])

  return {
    play,
    stop,
    stopAll
  }
}

