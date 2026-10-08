import { useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { Camera, Mic, GripVertical, Square } from 'lucide-react'
import { getAudioCountdown, getIsCapturingAudio, cancelAudioCapture } from './custom-text-selection'

interface CaptureOverlayButtonsProps {
  onScreenshot: () => void
  onAudio: () => void
}

const CaptureOverlayButtons = ({ onScreenshot, onAudio }: CaptureOverlayButtonsProps) => {
  const [position, setPosition] = useState({ x: window.innerWidth - 140, y: 20 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [audioCountdown, setAudioCountdown] = useState(5)
  const [isCapturingAudio, setIsCapturingAudio] = useState(false)

  const handleDragStart = (e: React.MouseEvent) => {
    setIsDragging(true)
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    })
  }

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      setPosition({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y
      })
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, dragOffset])

  // Poll for audio state
  useEffect(() => {
    const interval = setInterval(() => {
      setAudioCountdown(getAudioCountdown())
      setIsCapturingAudio(getIsCapturingAudio())
    }, 100)

    return () => clearInterval(interval)
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        zIndex: 2147483640,
        pointerEvents: 'auto',
        background: 'rgba(26, 26, 26, 0.95)',
        borderRadius: '6px',
        border: '1px solid #2a2a2a',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
        padding: '4px',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: '0',
        backdropFilter: 'blur(10px)'
      }}
    >
      {/* Drag handle */}
      <div
        onMouseDown={handleDragStart}
        style={{
          cursor: isDragging ? 'grabbing' : 'grab',
          padding: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#6b7280',
          transition: 'color 0.2s'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = '#9ca3af'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = '#6b7280'
        }}
      >
        <GripVertical size={16} strokeWidth={2} />
      </div>
      
      {/* Screenshot button */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onScreenshot()
        }}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          background: 'transparent',
          border: 'none',
          borderRadius: '4px',
          width: '32px',
          height: '32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transition: 'all 0.2s',
          padding: '0',
          color: '#9ca3af'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = '#374151'
          e.currentTarget.style.color = '#d1d5db'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = '#9ca3af'
        }}
        title="Screenshot (Cmd/Ctrl+Shift+S)"
      >
        <Camera size={16} strokeWidth={2} />
      </button>

      {/* Audio button */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          if (isCapturingAudio && audioCountdown === 0) {
            // Stop recording
            cancelAudioCapture()
          } else if (!isCapturingAudio) {
            // Start recording
            onAudio()
          }
        }}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          background: isCapturingAudio ? '#ef4444' : 'transparent',
          border: 'none',
          borderRadius: '4px',
          width: '32px',
          height: '32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transition: 'all 0.2s',
          padding: '0',
          color: isCapturingAudio ? 'white' : '#9ca3af',
          fontSize: isCapturingAudio && audioCountdown > 0 ? '14px' : 'inherit',
          fontWeight: isCapturingAudio && audioCountdown > 0 ? 'bold' : 'normal',
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace"
        }}
        onMouseEnter={(e) => {
          if (!isCapturingAudio) {
            e.currentTarget.style.background = '#374151'
            e.currentTarget.style.color = '#d1d5db'
          }
        }}
        onMouseLeave={(e) => {
          if (!isCapturingAudio) {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = '#9ca3af'
          }
        }}
        title={isCapturingAudio && audioCountdown === 0 ? 'Stop Recording' : 'Record Audio (Cmd/Ctrl+Shift+A)'}
      >
        {isCapturingAudio ? (
          audioCountdown > 0 ? audioCountdown : <Square size={14} strokeWidth={2} fill="white" />
        ) : (
          <Mic size={16} strokeWidth={2} />
        )}
      </button>
    </div>
  )
}

// Global callbacks
let globalOnScreenshot: (() => void) | null = null
let globalOnAudio: (() => void) | null = null

const CaptureOverlayWrapper = () => {
  return (
    <CaptureOverlayButtons
      onScreenshot={() => globalOnScreenshot?.()}
      onAudio={() => globalOnAudio?.()}
    />
  )
}

// Initialize the capture overlay buttons
export const initCaptureOverlayButtons = (onScreenshot: () => void, onAudio: () => void) => {
  globalOnScreenshot = onScreenshot
  globalOnAudio = onAudio

  // Create a container for the overlay buttons
  const container = document.createElement('div')
  container.id = 'marionette-capture-overlay-root'
  container.style.position = 'fixed'
  container.style.top = '0'
  container.style.left = '0'
  container.style.width = '0'
  container.style.height = '0'
  container.style.zIndex = '2147483640'
  container.style.pointerEvents = 'none'
  
  document.body.appendChild(container)
  
  const root = createRoot(container)
  root.render(<CaptureOverlayWrapper />)
  
  console.log('Marionette: Capture overlay buttons initialized')
}


