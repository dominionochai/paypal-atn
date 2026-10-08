import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export type OnboardingStep = 'welcome' | 'purpose' | 'microphone' | 'model' | 'features' | 'complete' | null

interface OnboardingState {
  currentStep: OnboardingStep
  isComplete: boolean
  micPermissionGranted: boolean
  modelAvailable: boolean
  speechRecognitionAvailable: boolean
}

interface OnboardingContextValue {
  state: OnboardingState
  isPopup: boolean
  nextStep: () => void
  prevStep: () => void
  skipOnboarding: () => void
  setMicPermission: (granted: boolean) => void
  setModelAvailability: (available: boolean) => void
  setSpeechRecognition: (available: boolean) => void
  resetOnboarding: () => void
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null)

const STORAGE_KEY = 'marionette_onboarding_complete'

const steps: OnboardingStep[] = ['welcome', 'purpose', 'microphone', 'model', 'features', 'complete']

interface OnboardingProviderProps {
  children: ReactNode
  isPopup?: boolean
}

export const OnboardingProvider = ({ children, isPopup = false }: OnboardingProviderProps) => {
  const [state, setState] = useState<OnboardingState>({
    currentStep: null,
    isComplete: false,
    micPermissionGranted: false,
    modelAvailable: false,
    speechRecognitionAvailable: false
  })

  // Load onboarding state from storage
  useEffect(() => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      if (result[STORAGE_KEY]) {
        setState(prev => ({ ...prev, isComplete: true, currentStep: null }))
      } else {
        setState(prev => ({ ...prev, currentStep: 'welcome' }))
      }
    })
  }, [])

  const nextStep = () => {
    setState(prev => {
      const currentIndex = steps.indexOf(prev.currentStep!)
      if (currentIndex < steps.length - 1) {
        return { ...prev, currentStep: steps[currentIndex + 1] }
      } else if (prev.currentStep === 'complete') {
        // Mark onboarding as complete
        chrome.storage.local.set({ [STORAGE_KEY]: true })
        return { ...prev, currentStep: null, isComplete: true }
      }
      return prev
    })
  }

  const prevStep = () => {
    setState(prev => {
      const currentIndex = steps.indexOf(prev.currentStep!)
      if (currentIndex > 0) {
        return { ...prev, currentStep: steps[currentIndex - 1] }
      }
      return prev
    })
  }

  const skipOnboarding = () => {
    chrome.storage.local.set({ [STORAGE_KEY]: true })
    setState(prev => ({ ...prev, currentStep: null, isComplete: true }))
  }

  const setMicPermission = (granted: boolean) => {
    setState(prev => ({ ...prev, micPermissionGranted: granted }))
  }

  const setModelAvailability = (available: boolean) => {
    setState(prev => ({ ...prev, modelAvailable: available }))
  }

  const setSpeechRecognition = (available: boolean) => {
    setState(prev => ({ ...prev, speechRecognitionAvailable: available }))
  }

  const resetOnboarding = () => {
    chrome.storage.local.remove([STORAGE_KEY])
    setState({
      currentStep: 'welcome',
      isComplete: false,
      micPermissionGranted: false,
      modelAvailable: false,
      speechRecognitionAvailable: false
    })
  }

  return (
    <OnboardingContext.Provider 
      value={{ 
        state,
        isPopup,
        nextStep, 
        prevStep, 
        skipOnboarding,
        setMicPermission,
        setModelAvailability,
        setSpeechRecognition,
        resetOnboarding
      }}
    >
      {children}
    </OnboardingContext.Provider>
  )
}

export const useOnboarding = () => {
  const context = useContext(OnboardingContext)
  if (!context) {
    throw new Error('useOnboarding must be used within OnboardingProvider')
  }
  return context
}

