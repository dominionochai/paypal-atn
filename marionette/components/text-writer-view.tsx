import React from 'react'
import { Send, GripVertical, X } from 'lucide-react'

interface TextWriterViewProps {
  inputValue: string
  setInputValue: (value: string) => void
  isProcessing: boolean
  output: string
  displayedOutput: string
  inputRef: React.RefObject<HTMLInputElement>
  isDragging: boolean
  onDragStart: (e: React.MouseEvent) => void
  onSendClick: () => void
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onClose: () => void
}

// Animated "Writing..." component
const WritingAnimation = () => {
  const [dots, setDots] = React.useState(0)

  React.useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev + 1) % 4)
    }, 400)

    return () => clearInterval(interval)
  }, [])

  const text = 'Writing'
  const dotString = '.'.repeat(dots)

  return (
    <span>
      {text.split('').map((char, index) => (
        <span
          key={index}
          style={{
            display: 'inline-block',
            animation: `float 0.6s ease-in-out ${index * 0.1}s infinite`,
          }}
        >
          {char}
        </span>
      ))}
      <span style={{ minWidth: '1.5em', display: 'inline-block' }}>{dotString}</span>
      <style>
        {`
          @keyframes float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-2px); }
          }
        `}
      </style>
    </span>
  )
}

export const TextWriterView: React.FC<TextWriterViewProps> = ({
  inputValue,
  setInputValue,
  isProcessing,
  output,
  displayedOutput,
  inputRef,
  isDragging,
  onDragStart,
  onSendClick,
  onKeyDown,
  onClose
}) => {
  const containerRef = React.useRef<HTMLDivElement>(null)

  // Auto-focus input when component mounts or becomes visible
  React.useEffect(() => {
    if (inputRef.current && !output) {
      // Immediate focus attempt
      inputRef.current.focus()
      
      // Also try with a small delay in case DOM isn't ready
      const timer = setTimeout(() => {
        inputRef.current?.focus()
      }, 50)
      
      return () => clearTimeout(timer)
    }
  }, [output])
  
  // Additional focus attempt when input ref changes
  React.useEffect(() => {
    if (inputRef.current && !output) {
      inputRef.current.focus()
    }
  }, [inputRef, output])

  // Focus container when output appears
  React.useEffect(() => {
    if (output && containerRef.current) {
      containerRef.current.focus()
    }
  }, [output])

  // Handle Enter key globally for the component
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !isProcessing) {
        // If there's output, insert it
        if (output) {
          e.preventDefault()
          onSendClick()
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }

    const container = containerRef.current
    if (container) {
      container.addEventListener('keydown', handleKeyDown)
    }

    return () => {
      if (container) {
        container.removeEventListener('keydown', handleKeyDown)
      }
    }
  }, [output, isProcessing, onSendClick, onClose])

  return (
    <div ref={containerRef} tabIndex={-1} style={{ outline: 'none' }}>
      {/* Header row with drag handle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            onMouseDown={onDragStart}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#6b7280',
              cursor: isDragging ? 'grabbing' : 'grab',
              padding: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.2s',
              userSelect: 'none'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#9ca3af'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = '#6b7280'
            }}
          >
            <GripVertical size={16} />
          </div>
          
          <div style={{
            fontSize: '11px',
            color: '#a855f7',
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }}>
            Writer
          </div>
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#6b7280',
            cursor: 'pointer',
            padding: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '50%',
            transition: 'all 0.2s'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#2a2a2a'
            e.currentTarget.style.color = '#ef4444'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = '#6b7280'
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Input row */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '8px',
        borderTop: '1px solid #2a2a2a',
        paddingTop: '8px'
      }}>
        
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={isProcessing || !!output}
          placeholder="What would you like me to write?"
          autoFocus
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            color: '#d1d5db',
            fontSize: '13px',
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
            outline: 'none',
            padding: '6px 4px',
            opacity: isProcessing || output ? 0.5 : 1
          }}
        />
        
        <button
          onClick={onSendClick}
          disabled={isProcessing || (!inputValue.trim() && !output)}
          style={{
            background: 'transparent',
            border: 'none',
            color: output ? '#a855f7' : '#9ca3af',
            cursor: (isProcessing || (!inputValue.trim() && !output)) ? 'not-allowed' : 'pointer',
            padding: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '50%',
            transition: 'all 0.2s',
            opacity: (isProcessing || (!inputValue.trim() && !output)) ? 0.5 : 1
          }}
          onMouseEnter={(e) => {
            if (!isProcessing && (inputValue.trim() || output)) {
              e.currentTarget.style.background = '#2a2a2a'
              e.currentTarget.style.color = output ? '#a855f7' : '#d1d5db'
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = output ? '#a855f7' : '#9ca3af'
          }}
        >
          <Send size={16} />
        </button>
      </div>

      {/* Processing state - only show when no output yet */}
      {isProcessing && !displayedOutput && (
        <div style={{
          padding: '8px 12px',
          fontSize: '13px',
          color: '#9ca3af',
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
          borderTop: '1px solid #2a2a2a'
        }}>
          <WritingAnimation />
        </div>
      )}

      {/* Output display - show during streaming and after */}
      {displayedOutput && (
        <div>
          <div style={{
            padding: '8px 12px',
            fontSize: '13px',
            color: '#d1d5db',
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
            borderTop: '1px solid #2a2a2a',
            lineHeight: '1.5',
            background: 'rgba(168, 85, 247, 0.1)',
            borderRadius: '12px',
            maxHeight: '300px',
            overflowY: 'auto'
          }}>
            {displayedOutput}
            {isProcessing && <span style={{ opacity: 0.5, animation: 'blink 1s infinite' }}>▌</span>}
          </div>
          {/* Show Enter hint when output is complete */}
          {!isProcessing && (
            <div style={{
              fontSize: '10px',
              color: '#6b7280',
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
              textAlign: 'center',
              marginTop: '6px'
            }}>
              Press <span style={{ 
                background: '#1f2937', 
                padding: '2px 6px', 
                borderRadius: '4px',
                border: '1px solid #374151',
                color: '#a855f7'
              }}>Enter</span> to insert
            </div>
          )}
        </div>
      )}
      
      {isProcessing && (
        <style>{`
          @keyframes blink {
            0%, 50% { opacity: 0.8; }
            51%, 100% { opacity: 0.2; }
          }
        `}</style>
      )}
    </div>
  )
}

