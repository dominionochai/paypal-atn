import React, { useState } from 'react'
import { ArrowRight, Camera, Keyboard, Highlighter, PenLine } from 'lucide-react'
import { useOnboarding } from '../onboarding-provider'
import { saveSettings } from '~lib/settings'

export const FeaturesStep = () => {
  const { nextStep } = useOnboarding()
  const [isEnabling, setIsEnabling] = useState(false)
  const [showReloadDialog, setShowReloadDialog] = useState(false)

  const handleEnable = async () => {
    setIsEnabling(true)
    
    // Enable all features
    await saveSettings({
      captureOverlayEnabled: true,
      globalShortcutsEnabled: true,
      textSelectionEnabled: true,
      writeCommandEnabled: true
    })
    
    // Show reload dialog
    setShowReloadDialog(true)
  }

  const handleReload = async () => {
    // Reload the active tab (not the sidepanel)
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tabs[0]?.id) {
      await chrome.tabs.reload(tabs[0].id)
    }
    
    // Move to complete step in sidepanel
    nextStep()
  }

  return (
    <div className="max-w-lg mx-auto px-6 py-8 text-center">
      <h1 className="text-2xl font-mono mb-3">Enable Features</h1>
      <p className="text-gray-400 text-sm mb-8">
        Marionette includes powerful features to help you interact with web pages.
      </p>

      {/* Features list */}
      <div className="space-y-4 mb-8 text-left">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-blue-600/10 rounded-lg">
              <Camera className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h3 className="text-sm font-mono text-white mb-1">Capture Overlay</h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                Floating buttons for quick screenshot and audio capture on any page.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-purple-600/10 rounded-lg">
              <Keyboard className="w-5 h-5 text-purple-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-mono text-white mb-2">Global Shortcuts</h3>
              <p className="text-xs text-gray-400 leading-relaxed mb-2">
                Quick keyboard shortcuts for instant capture anywhere on the web.
              </p>
              <div className="space-y-1 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-mono bg-gray-800 px-2 py-0.5 rounded text-gray-300">Cmd+Shift+S</span>
                  <span className="text-gray-500">Screenshot</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono bg-gray-800 px-2 py-0.5 rounded text-gray-300">Cmd+Shift+A</span>
                  <span className="text-gray-500">Audio Capture</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-orange-600/10 rounded-lg">
              <Highlighter className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <h3 className="text-sm font-mono text-white mb-1">Custom Text Selection</h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                Select text on any page to explain, rewrite, or send to chat with AI assistance.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-purple-600/10 rounded-lg">
              <PenLine className="w-5 h-5 text-purple-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-mono text-white mb-2">/write Command</h3>
              <p className="text-xs text-gray-400 leading-relaxed mb-2">
                Type <span className="font-mono bg-gray-800 px-1.5 py-0.5 rounded text-gray-300">/write</span> in any text field to instantly summon an AI writing assistant.
              </p>
              <p className="text-xs text-gray-500">
                Works in Twitter, Reddit, Gmail, and any input field or contenteditable element.
              </p>
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-500 mb-6">
        You can disable these features later in Settings.
      </p>

      <button
        onClick={handleEnable}
        disabled={isEnabling || showReloadDialog}
        className="w-full bg-white text-black hover:bg-gray-200 disabled:bg-gray-700 disabled:text-gray-500 px-6 py-3 rounded-lg font-mono text-sm flex items-center justify-center gap-2 transition-colors"
      >
        {isEnabling ? 'Enabling...' : 'Enable & Continue'}
        {!isEnabling && !showReloadDialog && <ArrowRight className="w-4 h-4" />}
      </button>

      {/* Reload Dialog */}
      {showReloadDialog && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm" style={{ zIndex: 9999 }}>
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-sm mx-4 shadow-2xl">
            <h3 className="text-sm font-mono text-white mb-3">Features Enabled</h3>
            <p className="text-xs text-gray-400 font-mono mb-6 leading-relaxed">
              The active page will reload to activate the extension features, then you can finish onboarding.
            </p>
            <button
              onClick={handleReload}
              className="w-full px-4 py-2 text-sm font-mono bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
            >
              Reload Page & Continue
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

