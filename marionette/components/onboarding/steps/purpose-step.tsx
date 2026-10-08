import React from 'react'
import { Shield, ArrowRight, ArrowLeft, Eye, Zap, Lock, ExternalLink, Github } from 'lucide-react'
import { useOnboarding } from '../onboarding-provider'

export const PurposeStep = () => {
  const { nextStep, prevStep } = useOnboarding()

  return (
    <div className="flex flex-col items-center justify-center px-8 py-8">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <div className="flex justify-center mb-4">
            <div className="p-4 rounded-full bg-purple-500/10">
              <Shield className="w-12 h-12 text-purple-400" />
            </div>
          </div>
          
          <h2 className="text-2xl font-bold">Fully Private Browser Assistant</h2>
          <p className="text-gray-400 text-sm">
            Marionette is your personal accessibility guide and automation assistant.
          </p>
        </div>

        <div className="space-y-3">
          <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4 space-y-4">
            <div className="flex items-start gap-3">
              <Lock className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-semibold mb-1">100% Private & Offline</div>
                <p className="text-xs text-gray-400">
                  All AI processing happens locally on your device using Chrome's built-in Gemini Nano. 
                  No data is ever sent to external servers.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Eye className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-semibold mb-1">Accessibility Focused</div>
                <p className="text-xs text-gray-400">
                  Navigate websites, understand content, and interact with pages through natural voice commands. 
                  Designed to make the web more accessible.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Zap className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-semibold mb-1">Intelligent Automation</div>
                <p className="text-xs text-gray-400">
                  Fill forms, click elements, extract information, and automate repetitive tasks. 
                  Your AI-powered browser companion.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
            <p className="text-xs text-purple-300 leading-relaxed">
              Marionette is built for privacy-conscious users who want AI assistance without compromising their data. 
              Every interaction stays on your device.
            </p>
          </div>

          <div className="flex flex-col gap-2 pt-2">
            <div className="text-[10px] text-gray-500 uppercase tracking-wide">Learn More</div>
            <div className="flex flex-col gap-1.5">
              <button
                onClick={() => chrome.tabs.create({ url: 'https://github.com/youneslaaroussi/marionette' })}
                className="flex items-center gap-2 text-xs text-gray-400 hover:text-white transition-colors"
              >
                <Github className="w-3.5 h-3.5" />
                <span>Marionette on GitHub (Open Source)</span>
                <ExternalLink className="w-3 h-3 ml-auto" />
              </button>
              <button
                onClick={() => chrome.tabs.create({ url: 'https://developer.chrome.com/docs/extensions/ai/prompt-api' })}
                className="flex items-center gap-2 text-xs text-gray-400 hover:text-white transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Chrome Extensions AI Prompt API</span>
                <ExternalLink className="w-3 h-3 ml-auto" />
              </button>
              <button
                onClick={() => chrome.tabs.create({ url: 'https://developer.chrome.com/docs/ai/built-in-apis' })}
                className="flex items-center gap-2 text-xs text-gray-400 hover:text-white transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Chrome Built-in AI APIs</span>
                <ExternalLink className="w-3 h-3 ml-auto" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            onClick={prevStep}
            className="flex-1 bg-gray-800 text-white px-6 py-3 rounded-lg font-medium text-sm hover:bg-gray-700 transition-colors flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <button
            onClick={nextStep}
            className="flex-1 bg-white text-black px-6 py-3 rounded-lg font-medium text-sm hover:bg-gray-100 transition-colors flex items-center justify-center gap-2"
          >
            Continue
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
