import React, { useState } from "react"
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

const Popup = () => {
  const [currentScreen, setCurrentScreen] = useState<Screen>(DEFAULT_SCREEN)

  return (
    <AlertProvider>
      <OnboardingProvider isPopup={true}>
        <MediaDeviceProvider>
          <TTSProvider>
            <ChatProvider>
              {currentScreen === 'main' ? (
                <MainScreen 
                  onNavigateToDebug={() => setCurrentScreen('debug')}
                  onNavigateToSettings={() => setCurrentScreen('settings')}
                />
              ) : currentScreen === 'settings' ? (
                <SettingsScreen onBack={() => setCurrentScreen('main')} />
              ) : (
                <DebugScreen onNavigateToMain={() => setCurrentScreen('main')} />
              )}
            </ChatProvider>
          </TTSProvider>
        </MediaDeviceProvider>
      </OnboardingProvider>
    </AlertProvider>
  )
}

export default Popup
