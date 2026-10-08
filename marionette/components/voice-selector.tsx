import React, { useState } from "react"
import { Volume2, X } from "lucide-react"
import { useTTS } from "../lib/tts-context"

export const VoiceSelector = () => {
  const { selectedVoiceUri, availableVoices, setSelectedVoiceUri, previewVoice } = useTTS()
  const [isError, setIsError] = useState(false)
  const [isDisabled, setIsDisabled] = useState(false)

  if (availableVoices.length === 0) {
    return null
  }

  const handlePreview = async () => {
    if (!selectedVoiceUri || isDisabled) return
    
    setIsDisabled(true)
    const success = await previewVoice(selectedVoiceUri)
    
    if (!success) {
      setIsError(true)
      setTimeout(() => {
        setIsError(false)
        setIsDisabled(false)
      }, 2000)
    } else {
      setIsDisabled(false)
    }
  }

  return (
    <div className="flex items-center gap-1">
      <select
        value={selectedVoiceUri || ''}
        onChange={(e) => setSelectedVoiceUri(e.target.value)}
        className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-gray-500 max-w-full truncate"
        style={{ maxWidth: '130px' }}
      >
        {availableVoices.map((voice) => (
          <option key={voice.voiceURI} value={voice.voiceURI}>
            {voice.name}
          </option>
        ))}
      </select>
      <button
        onClick={handlePreview}
        disabled={isDisabled}
        className={`p-1 hover:bg-gray-800 rounded flex-shrink-0 ${isError ? 'text-red-500' : ''} ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        title={isError ? 'Preview failed' : 'Preview voice'}
      >
        {isError ? <X className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
      </button>
    </div>
  )
}

