import React from 'react'
import { X } from 'lucide-react'
import { useOnboarding } from './onboarding-provider'
import { WelcomeStep } from './steps/welcome-step'
import { PurposeStep } from './steps/purpose-step'
import { MicPermissionStep } from './steps/mic-permission-step'
import { ModelAvailabilityStep } from './steps/model-availability-step'
import { FeaturesStep } from './steps/features-step'
import { CompleteStep } from './steps/complete-step'

export const OnboardingFlow = () => {
  const { state, skipOnboarding } = useOnboarding()

  if (state.isComplete || !state.currentStep) {
    return null
  }

  const renderStep = () => {
    switch (state.currentStep) {
      case 'welcome':
        return <WelcomeStep />
      case 'purpose':
        return <PurposeStep />
      case 'microphone':
        return <MicPermissionStep />
      case 'model':
        return <ModelAvailabilityStep />
      case 'features':
        return <FeaturesStep />
      case 'complete':
        return <CompleteStep />
      default:
        return null
    }
  }

  const getCurrentStepNumber = () => {
    const steps = ['welcome', 'purpose', 'microphone', 'model', 'features', 'complete']
    return steps.indexOf(state.currentStep!) + 1
  }

  const totalSteps = 6

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      {/* Header with progress */}
      <div className="border-b border-gray-800 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="font-mono text-sm">MARIONETTE</div>
          <button
            onClick={skipOnboarding}
            className="p-1 hover:bg-gray-800 rounded transition-colors"
            title="Skip onboarding"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        
        {/* Progress bar */}
        <div className="flex gap-1">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i < getCurrentStepNumber() ? 'bg-white' : 'bg-gray-800'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Step content - centered container */}
      <div className="flex-1 overflow-y-auto flex items-center justify-center">
        <div className="w-full">
          {renderStep()}
        </div>
      </div>
    </div>
  )
}

