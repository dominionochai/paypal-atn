import React, { useState, useEffect } from "react"
import { ChatProvider } from "./lib/chat-context"
import { AlertProvider } from "./lib/alert-context"
import { MediaDeviceProvider } from "./lib/media-device-context"
import { TTSProvider } from "./lib/tts-context"
import { OnboardingProvider } from "./components/onboarding/onboarding-provider"
import { DebugScreen } from "./screens/debug-screen"
import { MainScreen } from "./screens/main-screen"
import { SettingsScreen } from "./screens/settings-screen"
import { DEFAULT_SCREEN, type Screen } from "./lib/config"
import "./style.css"

const SidePanel = () => {
  const [currentScreen, setCurrentScreen] = useState<Screen>(DEFAULT_SCREEN)

  useEffect(() => {
    // Force full height
    document.body.style.height = '100vh'
    document.body.style.margin = '0'
    document.body.style.overflow = 'hidden'
    document.documentElement.style.height = '100vh'
    
    // Listen for ping messages to detect if sidepanel is open
    const handleMessage = (message: any, sender: any, sendResponse: (response?: any) => void) => {
      if (message.type === 'ping_sidepanel') {
        console.log('[Sidepanel] Responding to ping')
        sendResponse({ alive: true })
        return true
      }
    }
    
    chrome.runtime.onMessage.addListener(handleMessage)
    
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage)
    }
  }, [])

  return (
    <div style={{ height: '100vh', width: '100%' }}>
      <AlertProvider>
        <OnboardingProvider isPopup={false}>
          <MediaDeviceProvider>
            <TTSProvider>
              <ChatProvider>
              {currentScreen === 'main' ? (
                <MainScreen 
                  onNavigateToDebug={() => setCurrentScreen('debug')} 
                  onNavigateToSettings={() => setCurrentScreen('settings')}
                  fullHeight 
                />
              ) : currentScreen === 'settings' ? (
                <SettingsScreen onBack={() => setCurrentScreen('main')} />
              ) : (
                <DebugScreen onNavigateToMain={() => setCurrentScreen('main')} fullHeight />
              )}
              </ChatProvider>
            </TTSProvider>
          </MediaDeviceProvider>
        </OnboardingProvider>
      </AlertProvider>
    </div>
  )
}

export default SidePanel

