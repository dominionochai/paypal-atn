import React, { useState, useEffect } from 'react'
import { ArrowLeft, ExternalLink } from 'lucide-react'

interface Settings {
  captureOverlayEnabled: boolean
  globalShortcutsEnabled: boolean
  textSelectionEnabled: boolean
  writeCommandEnabled: boolean
}

const DEFAULT_SETTINGS: Settings = {
  captureOverlayEnabled: true,
  globalShortcutsEnabled: true,
  textSelectionEnabled: true,
  writeCommandEnabled: true
}

interface SettingsScreenProps {
  onBack: () => void
}

export const SettingsScreen = ({ onBack }: SettingsScreenProps) => {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [originalSettings, setOriginalSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [version, setVersion] = useState<string>('')
  const [hasChanges, setHasChanges] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)

  // Load settings and version
  useEffect(() => {
    chrome.storage.local.get('marionette_settings', (result) => {
      const loadedSettings = result.marionette_settings 
        ? { ...DEFAULT_SETTINGS, ...result.marionette_settings }
        : DEFAULT_SETTINGS
      setSettings(loadedSettings)
      setOriginalSettings(loadedSettings)
    })
    
    // Get extension version
    const manifest = chrome.runtime.getManifest()
    setVersion(manifest.version)
  }, [])

  const handleToggle = (key: keyof Settings) => {
    const newSettings = { ...settings, [key]: !settings[key] }
    setSettings(newSettings)
    setHasChanges(true)
  }

  const handleApply = () => {
    setShowConfirmDialog(true)
  }

  const confirmApply = async () => {
    await chrome.storage.local.set({ marionette_settings: settings })
    
    // Reload the current tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tabs[0]?.id) {
      chrome.tabs.reload(tabs[0].id)
    }
    
    setHasChanges(false)
    setOriginalSettings(settings)
    setShowConfirmDialog(false)
  }

  const cancelApply = () => {
    setShowConfirmDialog(false)
  }

  const openExtensionSettings = () => {
    chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id })
  }

  return (
    <div className="w-full h-full bg-black text-white flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1 hover:bg-gray-800 rounded"
            title="Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="font-mono text-sm">SETTINGS</div>
        </div>
        
        <button
          onClick={handleApply}
          disabled={!hasChanges}
          className={`px-4 py-1.5 text-xs font-mono rounded transition-colors ${
            hasChanges 
              ? 'bg-blue-600 hover:bg-blue-700 text-white' 
              : 'bg-gray-800 text-gray-500 cursor-not-allowed'
          }`}
        >
          Apply
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 p-6">
        <div className="max-w-md mx-auto space-y-6">
          
          {/* Feature Toggles */}
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-gray-900 border border-gray-800 rounded">
              <span className="text-sm font-mono">Capture Overlay Buttons</span>
              <button
                onClick={() => handleToggle('captureOverlayEnabled')}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  settings.captureOverlayEnabled ? 'bg-blue-600' : 'bg-gray-700'
                }`}
              >
                <div
                  className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                    settings.captureOverlayEnabled ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="p-4 bg-gray-900 border border-gray-800 rounded">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-mono">Global Shortcuts</span>
                <button
                  onClick={() => handleToggle('globalShortcutsEnabled')}
                  className={`relative w-12 h-6 rounded-full transition-colors ${
                    settings.globalShortcutsEnabled ? 'bg-blue-600' : 'bg-gray-700'
                  }`}
                >
                  <div
                    className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                      settings.globalShortcutsEnabled ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              <div className="text-xs text-gray-500 space-y-1">
                <div><span className="font-mono bg-gray-800 px-1.5 py-0.5 rounded">Cmd+Shift+S</span> Screenshot</div>
                <div><span className="font-mono bg-gray-800 px-1.5 py-0.5 rounded">Cmd+Shift+A</span> Audio Capture</div>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 bg-gray-900 border border-gray-800 rounded">
              <span className="text-sm font-mono">Custom Text Selection</span>
              <button
                onClick={() => handleToggle('textSelectionEnabled')}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  settings.textSelectionEnabled ? 'bg-blue-600' : 'bg-gray-700'
                }`}
              >
                <div
                  className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                    settings.textSelectionEnabled ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="p-4 bg-gray-900 border border-gray-800 rounded">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-mono">/write Command</span>
                <button
                  onClick={() => handleToggle('writeCommandEnabled')}
                  className={`relative w-12 h-6 rounded-full transition-colors ${
                    settings.writeCommandEnabled ? 'bg-blue-600' : 'bg-gray-700'
                  }`}
                >
                  <div
                    className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                      settings.writeCommandEnabled ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              <div className="text-xs text-gray-500">
                Type <span className="font-mono bg-gray-800 px-1.5 py-0.5 rounded">/write</span> in any text field to generate AI content
              </div>
            </div>
          </div>

          {/* Extension Settings Button */}
          <button
            onClick={openExtensionSettings}
            className="w-full p-4 bg-gray-900 border border-gray-800 hover:bg-gray-800 rounded flex items-center justify-between transition-colors"
          >
            <span className="text-sm font-mono">Permissions & Settings</span>
            <ExternalLink className="w-4 h-4" />
          </button>
          
          {/* Chrome Flags Button */}
          <button
            onClick={() => chrome.tabs.create({ url: 'chrome://flags/#optimization-guide-on-device-model' })}
            className="w-full p-4 bg-gray-900 border border-gray-800 hover:bg-gray-800 rounded flex items-center justify-between transition-colors"
          >
            <span className="text-sm font-mono">Chrome AI Flags</span>
            <ExternalLink className="w-4 h-4" />
          </button>

          {/* Version */}
          <div className="text-center text-xs text-gray-600 font-mono pt-4">
            v{version}
          </div>
        </div>
      </div>

      {/* Confirmation Dialog */}
      {showConfirmDialog && (
        <div 
          className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          style={{ zIndex: 9999 }}
        >
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-sm mx-4 shadow-2xl">
            <h3 className="text-sm font-mono text-white mb-3">Apply Settings?</h3>
            <p className="text-xs text-gray-400 font-mono mb-6 leading-relaxed">
              Settings will be applied and the page will reload.
            </p>
            <div className="flex gap-3">
              <button
                onClick={cancelApply}
                className="flex-1 px-4 py-2 text-xs font-mono bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmApply}
                className="flex-1 px-4 py-2 text-xs font-mono bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
