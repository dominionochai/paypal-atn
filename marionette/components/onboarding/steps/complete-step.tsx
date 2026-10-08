import React from 'react'
import { CheckCircle, Sparkles } from 'lucide-react'
import { useOnboarding } from '../onboarding-provider'

export const CompleteStep = () => {
  const { nextStep, state } = useOnboarding()

  return (
    <div className="flex flex-col items-center justify-center px-8 py-8">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <div className="flex justify-center mb-4">
            <div className="p-4 rounded-full bg-green-500/10">
              <CheckCircle className="w-12 h-12 text-green-500" />
            </div>
          </div>
          
          <h2 className="text-2xl font-bold">You're All Set</h2>
          <p className="text-gray-400 text-sm">
            Marionette is ready to assist you with browser automation and voice commands.
          </p>
        </div>

        <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6 space-y-4">
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-medium">Microphone Access</div>
                <div className="text-xs text-gray-400">
                  {state.micPermissionGranted ? 'Enabled and ready' : 'Limited functionality'}
                </div>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-medium">AI Model</div>
                <div className="text-xs text-gray-400">
                  {state.modelAvailable ? 'Gemini Nano ready' : 'Requires setup'}
                </div>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-medium">Speech Recognition</div>
                <div className="text-xs text-gray-400">
                  {state.speechRecognitionAvailable ? 'Available' : 'Not supported'}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-6 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-400" />
            <div className="text-sm font-medium text-blue-400">Quick Start Tips</div>
          </div>
          <ul className="text-xs text-gray-300 space-y-2">
            <li className="flex items-start gap-2">
              <span className="text-blue-400 mt-0.5">•</span>
              <span>Click the microphone icon or press it to start voice input</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-400 mt-0.5">•</span>
              <span>Try commands like "What's on this page?" or "Click the login button"</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-400 mt-0.5">•</span>
              <span>All AI processing happens locally on your device for privacy</span>
            </li>
          </ul>
        </div>

        <div className="pt-4">
          <button
            onClick={nextStep}
            className="w-full bg-white text-black px-6 py-3 rounded-lg font-medium text-sm hover:bg-gray-100 transition-colors"
          >
            Start Using Marionette
          </button>
        </div>
      </div>
    </div>
  )
}

