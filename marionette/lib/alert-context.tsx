import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { X, AlertCircle, Info } from 'lucide-react'
import { setGlobalAlertHandler } from './chat-context'

type AlertType = 'error' | 'info'

export interface AlertAction {
  label: string
  onClick: () => void
}

// Helper to open extension permissions page
export const openPermissionsPage = () => {
  const url = `chrome://settings/content/siteDetails?site=chrome-extension://${chrome.runtime.id}`
  chrome.tabs.create({ url })
}

// Helper to open Chrome flags for AI model
export const openAIFlagsPage = () => {
  const url = 'chrome://flags/#prompt-api-for-gemini-nano-multimodal-input'
  chrome.tabs.create({ url })
}

// Helper to open Chrome AI documentation
export const openChromeAIDocs = () => {
  const url = 'https://developer.chrome.com/docs/ai/prompt-api'
  chrome.tabs.create({ url })
}

// Helper to open Chrome flags for Writer API
export const openWriterAPIFlagsPage = () => {
  const url = 'chrome://flags/#writer-api-for-gemini-nano'
  chrome.tabs.create({ url })
}

// Helper to open Chrome flags for Rewriter API
export const openRewriterAPIFlagsPage = () => {
  const url = 'chrome://flags/#rewriter-api-for-gemini-nano'
  chrome.tabs.create({ url })
}

// Helper to open Chrome flags for Translator API
export const openTranslatorAPIFlagsPage = () => {
  const url = 'chrome://flags/#translation-api'
  chrome.tabs.create({ url })
}

// Helper to open Chrome flags for Language Detector API
export const openLanguageDetectorAPIFlagsPage = () => {
  const url = 'chrome://flags/#language-detection-api'
  chrome.tabs.create({ url })
}

// Helper to open Chrome flags for Summarization API
export const openSummarizationAPIFlagsPage = () => {
  const url = 'chrome://flags/#summarization-api-for-gemini-nano'
  chrome.tabs.create({ url })
}

interface Alert {
  id: string
  type: AlertType
  title: string
  message: string
  action?: AlertAction
}

interface AlertContextValue {
  showAlert: (type: AlertType, title: string, message: string, action?: AlertAction) => void
  hideAlert: (id: string) => void
}

const AlertContext = createContext<AlertContextValue | null>(null)

export const AlertProvider = ({ children }: { children: ReactNode }) => {
  const [alerts, setAlerts] = useState<Alert[]>([])

  const showAlert = useCallback((type: AlertType, title: string, message: string, action?: AlertAction) => {
    const id = Date.now().toString()
    setAlerts(prev => [...prev, { id, type, title, message, action }])
  }, [])

  const hideAlert = useCallback((id: string) => {
    setAlerts(prev => prev.filter(alert => alert.id !== id))
  }, [])

  // Register global alert handler
  useEffect(() => {
    setGlobalAlertHandler(showAlert)
    return () => setGlobalAlertHandler(() => {})
  }, [showAlert])

  return (
    <AlertContext.Provider value={{ showAlert, hideAlert }}>
      {children}
      
      {/* Alert Display */}
      <div className="fixed top-3 right-3 z-50 flex flex-col gap-2" style={{ maxWidth: '400px' }}>
        {alerts.map(alert => (
          <div
            key={alert.id}
            className={`p-3 rounded border font-mono text-xs ${
              alert.type === 'error'
                ? 'bg-red-950 border-red-800 text-red-200'
                : 'bg-blue-950 border-blue-800 text-blue-200'
            }`}
          >
            <div className="flex items-start gap-2">
              <div className="flex-shrink-0 mt-0.5">
                {alert.type === 'error' ? (
                  <AlertCircle className="w-4 h-4" />
                ) : (
                  <Info className="w-4 h-4" />
                )}
              </div>
              <div className="flex-1">
                <div className="font-bold mb-1">{alert.title}</div>
                <div className="text-[10px] whitespace-pre-wrap">{alert.message}</div>
                {alert.action && (
                  <button
                    onClick={() => {
                      alert.action?.onClick()
                      hideAlert(alert.id)
                    }}
                    className="mt-2 px-2 py-1 bg-white/10 hover:bg-white/20 rounded text-[10px] font-bold"
                  >
                    {alert.action.label}
                  </button>
                )}
              </div>
              <button
                onClick={() => hideAlert(alert.id)}
                className="flex-shrink-0 p-0.5 hover:bg-black/30 rounded"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </AlertContext.Provider>
  )
}

export const useAlert = () => {
  const context = useContext(AlertContext)
  if (!context) {
    throw new Error('useAlert must be used within AlertProvider')
  }
  return context
}

