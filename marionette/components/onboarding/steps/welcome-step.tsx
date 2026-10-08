import React from 'react'
import { ArrowRight } from 'lucide-react'
import { useOnboarding } from '../onboarding-provider'

export const WelcomeStep = () => {
  const { nextStep } = useOnboarding()

  return (
    <div className="flex flex-col items-center justify-center px-8 py-8">
      <div className="max-w-md text-center space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Welcome to Marionette</h1>
          <p className="text-gray-400 text-sm">
            Your AI-powered browser assistant
          </p>
        </div>

        <div className="space-y-4 text-left bg-gray-900/50 border border-gray-800 rounded-lg p-6">
          <div>
            <h3 className="font-semibold text-sm mb-1">Voice-First Interface</h3>
            <p className="text-gray-400 text-xs">
              Control your browser naturally using voice commands powered by on-device AI.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-sm mb-1">Privacy-Focused</h3>
            <p className="text-gray-400 text-xs">
              All processing happens locally using Chrome's built-in Gemini Nano model. No data leaves your device.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-sm mb-1">Browser Automation</h3>
            <p className="text-gray-400 text-xs">
              Navigate pages, fill forms, extract information, and more through simple voice or text commands.
            </p>
          </div>
        </div>

        <div className="pt-4">
          <button
            onClick={nextStep}
            className="w-full bg-white text-black px-6 py-3 rounded-lg font-medium text-sm hover:bg-gray-100 transition-colors flex items-center justify-center gap-2"
          >
            Get Started
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

