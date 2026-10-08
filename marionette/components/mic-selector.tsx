import React, { useRef } from "react"
import { useMediaDevice } from "../lib/media-device-context"

export const MicSelector = () => {
  const { selectedMicId, availableMics, setSelectedMicId } = useMediaDevice()
  const isChangingRef = useRef(false)

  if (availableMics.length <= 1) {
    return null
  }

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (isChangingRef.current) {
      return // Prevent rapid changes
    }
    
    isChangingRef.current = true
    setSelectedMicId(e.target.value)
    
    // Reset flag after a short delay
    setTimeout(() => {
      isChangingRef.current = false
    }, 300)
  }

  return (
    <select
      value={selectedMicId || ''}
      onChange={handleChange}
      className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-gray-500 max-w-full truncate"
      style={{ maxWidth: '150px' }}
    >
      {availableMics.map((mic) => (
        <option key={mic.deviceId} value={mic.deviceId}>
          {mic.label || `Mic ${mic.deviceId.substring(0, 8)}`}
        </option>
      ))}
    </select>
  )
}

