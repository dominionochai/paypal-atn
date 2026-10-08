import React from 'react'
import { ArrowRight } from 'lucide-react'

export const OnboardingRedirect = () => {
  const handleOpenSidePanel = async () => {
    try {
      await chrome.sidePanel.open({ windowId: (await chrome.windows.getCurrent()).id })
      window.close()
    } catch (error) {
      console.error('Failed to open sidepanel:', error)
    }
  }

  return (
    <div className="w-full bg-black text-white flex flex-col items-center justify-center" style={{ minHeight: '500px', maxHeight: '600px' }}>
      <div className="max-w-md px-8 text-center space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Welcome to Marionette</h1>
          <p className="text-gray-400 text-sm">
            First time here? Let's get you set up.
          </p>
        </div>

        <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6 text-left space-y-3">
          <p className="text-gray-300 text-xs">
            The onboarding experience works best in the side panel where you'll have more space.
          </p>
          <p className="text-gray-400 text-xs">
            Click below to open the side panel and begin setup.
          </p>
        </div>

        <button
          onClick={handleOpenSidePanel}
          className="w-full bg-white text-black px-6 py-3 rounded-lg font-medium text-sm hover:bg-gray-100 transition-colors flex items-center justify-center gap-2"
        >
          Open Side Panel
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
