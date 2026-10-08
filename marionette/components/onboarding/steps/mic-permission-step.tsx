import React, { useState, useEffect } from 'react'
import { Mic, AlertCircle, CheckCircle, ArrowRight, ArrowLeft } from 'lucide-react'
import { useOnboarding } from '../onboarding-provider'
import { openPermissionsPage } from '../../../lib/alert-context'

type PermissionState = 'unchecked' | 'checking' | 'granted' | 'denied' | 'unavailable'

export const MicPermissionStep = () => {
  const { nextStep, prevStep, setMicPermission, setSpeechRecognition } = useOnboarding()
  const [permissionState, setPermissionState] = useState<PermissionState>('unchecked')
  const [errorMessage, setErrorMessage] = useState<string>('')

  // Check initial permission state
  useEffect(() => {
    checkPermissions()
  }, [])

  const checkPermissions = async () => {
    try {
      // Check if Speech Recognition is available
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      
      if (!SpeechRecognition) {
        setPermissionState('unavailable')
        setErrorMessage('Speech recognition is not supported in this browser.')
        setSpeechRecognition(false)
        return
      }
      
      setSpeechRecognition(true)

      // Check microphone permission
      const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName })
      
      if (permissionStatus.state === 'granted') {
        setPermissionState('granted')
        setMicPermission(true)
      } else if (permissionStatus.state === 'denied') {
        setPermissionState('denied')
        setMicPermission(false)
      }
      
      // Listen for permission changes
      permissionStatus.onchange = () => {
        if (permissionStatus.state === 'granted') {
          setPermissionState('granted')
          setMicPermission(true)
        } else if (permissionStatus.state === 'denied') {
          setPermissionState('denied')
          setMicPermission(false)
        }
      }
    } catch (error) {
      console.error('Failed to check microphone permissions:', error)
    }
  }

  const requestPermission = async () => {
    setPermissionState('checking')
    setErrorMessage('')

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true })
      setPermissionState('granted')
      setMicPermission(true)
    } catch (error: any) {
      console.error('Microphone permission error:', error)
      
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        setPermissionState('denied')
        setErrorMessage('Microphone access was denied. Please enable it in your browser settings.')
        setMicPermission(false)
      } else if (error.name === 'NotFoundError') {
        setPermissionState('denied')
        setErrorMessage('No microphone found. Please connect a microphone and try again.')
        setMicPermission(false)
      } else {
        setPermissionState('denied')
        setErrorMessage(error.message || 'Failed to access microphone.')
        setMicPermission(false)
      }
    }
  }

  const canProceed = permissionState === 'granted'

  return (
    <div className="flex flex-col items-center justify-center px-8 py-8">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <div className="flex justify-center mb-4">
            <div className={`p-4 rounded-full ${
              permissionState === 'granted' ? 'bg-green-500/10' :
              permissionState === 'denied' || permissionState === 'unavailable' ? 'bg-red-500/10' :
              'bg-gray-800'
            }`}>
              <Mic className={`w-8 h-8 ${
                permissionState === 'granted' ? 'text-green-500' :
                permissionState === 'denied' || permissionState === 'unavailable' ? 'text-red-500' :
                'text-gray-400'
              }`} />
            </div>
          </div>
          
          <h2 className="text-2xl font-bold">Microphone Access</h2>
          <p className="text-gray-400 text-sm">
            Marionette needs microphone access to listen to your voice commands.
          </p>
        </div>

        <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6 space-y-4">
          {permissionState === 'unchecked' && (
            <button
              onClick={requestPermission}
              className="w-full bg-white text-black px-6 py-3 rounded-lg font-medium text-sm hover:bg-gray-100 transition-colors"
            >
              Grant Microphone Access
            </button>
          )}

          {permissionState === 'checking' && (
            <div className="text-center py-3">
              <div className="text-sm text-gray-400 animate-pulse">Requesting permission...</div>
            </div>
          )}

          {permissionState === 'granted' && (
            <div className="flex items-center gap-3 text-green-500">
              <CheckCircle className="w-5 h-5 flex-shrink-0" />
              <div className="text-sm">
                Microphone access granted. You're all set!
              </div>
            </div>
          )}

          {(permissionState === 'denied' || permissionState === 'unavailable') && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 text-red-400">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div className="text-sm">{errorMessage}</div>
              </div>

              {permissionState === 'denied' && (
                <div className="space-y-2">
                  <button
                    onClick={openPermissionsPage}
                    className="w-full bg-gray-800 text-white px-4 py-2 rounded-lg text-xs hover:bg-gray-700 transition-colors"
                  >
                    Open Browser Settings
                  </button>
                  <button
                    onClick={requestPermission}
                    className="w-full bg-transparent border border-gray-700 text-white px-4 py-2 rounded-lg text-xs hover:bg-gray-800 transition-colors"
                  >
                    Try Again
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-4">
          <button
            onClick={prevStep}
            className="flex-1 bg-gray-800 text-white px-6 py-3 rounded-lg font-medium text-sm hover:bg-gray-700 transition-colors flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <button
            onClick={nextStep}
            disabled={!canProceed}
            className="flex-1 bg-white text-black px-6 py-3 rounded-lg font-medium text-sm hover:bg-gray-100 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white"
          >
            Continue
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

