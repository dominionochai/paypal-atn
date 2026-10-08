import React from 'react'
import { GripVertical, ExternalLink, MessageSquare, Sparkles } from 'lucide-react'

interface TextExplainerViewProps {
  selectedText: string
  screenshot?: string // base64 image data
  audio?: string // base64 audio data
  mode: 'options' | 'explaining' // What state we're in
  isProcessing: boolean
  result: string // explanation
  displayedResult: string
  isDragging: boolean
  onDragStart: (e: React.MouseEvent) => void
  onExplain: () => void
  onSendToChat: () => void
}

// Animated "Analyzing..." component
const AnalyzingAnimation = () => {
  const [dots, setDots] = React.useState(0)

  React.useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev + 1) % 4)
    }, 400)

    return () => clearInterval(interval)
  }, [])

  const text = 'Analyzing'
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

export const TextExplainerView: React.FC<TextExplainerViewProps> = ({
  selectedText,
  screenshot,
  audio,
  mode,
  isProcessing,
  result,
  displayedResult,
  isDragging,
  onDragStart,
  onExplain,
  onSendToChat
}) => {
  const getTitle = () => {
    if (mode === 'explaining') return 'Explanation'
    if (screenshot) return 'Image Analysis'
    if (audio) return 'Audio Analysis'
    return 'Text Actions'
  }

  return (
    <>
      {/* Header row with drag handle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
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
            color: '#6b7280',
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }}>
            {getTitle()}
          </div>
        </div>

        {result && !isProcessing && (
          <button
            onClick={onSendToChat}
            style={{
              background: 'transparent',
              border: '1px solid #374151',
              color: '#9ca3af',
              cursor: 'pointer',
              padding: '4px 8px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              borderRadius: '6px',
              fontSize: '11px',
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#374151'
              e.currentTarget.style.color = '#d1d5db'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = '#9ca3af'
            }}
          >
            <ExternalLink size={12} />
            <span>Send to Chat</span>
          </button>
        )}
      </div>

      {/* Selected text, image, or audio preview */}
      {screenshot ? (
        <div style={{
          padding: '8px 12px',
          borderTop: '1px solid #2a2a2a',
          display: 'flex',
          justifyContent: 'center'
        }}>
          <img 
            src={screenshot} 
            alt="Screenshot" 
            style={{
              maxWidth: '100%',
              maxHeight: '200px',
              borderRadius: '6px',
              border: '1px solid #374151'
            }}
          />
        </div>
      ) : audio ? (
        <div style={{
          padding: '12px',
          borderTop: '1px solid #2a2a2a',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px'
        }}>
          <div style={{
            fontSize: '11px',
            color: '#6b7280',
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }}>
            Audio Recording (5 seconds)
          </div>
          <audio 
            src={audio} 
            controls 
            style={{
              width: '100%',
              maxWidth: '300px',
              height: '32px'
            }}
          />
        </div>
      ) : (
        <div style={{
          padding: '8px 12px',
          fontSize: '12px',
          color: '#9ca3af',
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
          borderTop: '1px solid #2a2a2a',
          lineHeight: '1.4',
          fontStyle: 'italic',
          maxHeight: '60px',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}>
          "{selectedText.length > 100 ? selectedText.substring(0, 100) + '...' : selectedText}"
        </div>
      )}

      {/* Action buttons (when in options mode and not processing) */}
      {mode === 'options' && !isProcessing && (
        <div style={{
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          borderTop: '1px solid #2a2a2a'
        }}>
          <button
            onClick={onExplain}
            style={{
              background: 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              color: '#60a5fa',
              cursor: 'pointer',
              padding: '8px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              borderRadius: '6px',
              fontSize: '12px',
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
              transition: 'all 0.2s',
              width: '100%'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)'
              e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.5)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)'
              e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.3)'
            }}
          >
            <Sparkles size={14} />
            <span>{screenshot ? 'Analyze Image' : audio ? 'Analyze Audio' : 'Explain'}</span>
          </button>

          <button
            onClick={onSendToChat}
            style={{
              background: 'rgba(34, 197, 94, 0.1)',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              color: '#4ade80',
              cursor: 'pointer',
              padding: '8px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              borderRadius: '6px',
              fontSize: '12px',
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
              transition: 'all 0.2s',
              width: '100%',
              margin: '0 auto'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(34, 197, 94, 0.2)'
              e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.5)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(34, 197, 94, 0.1)'
              e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.3)'
            }}
          >
            <MessageSquare size={14} />
            <span>Send to Chat</span>
          </button>
        </div>
      )}

      {/* Processing state - only show when no result yet */}
      {isProcessing && !displayedResult && (
        <div style={{
          padding: '8px 12px',
          fontSize: '13px',
          color: '#9ca3af',
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
          borderTop: '1px solid #2a2a2a'
        }}>
          <AnalyzingAnimation />
        </div>
      )}

      {/* Result display (explanation or summary) - show during streaming and after */}
      {displayedResult && (
        <div style={{
          padding: '12px',
          fontSize: '13px',
          color: '#d1d5db',
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
          borderTop: '1px solid #2a2a2a',
          lineHeight: '1.6',
          background: 'rgba(59, 130, 246, 0.1)',
          borderRadius: '12px',
          maxHeight: '300px',
          overflowY: 'auto',
          minHeight: '80px'
        }}>
          {displayedResult}
          {isProcessing && <span style={{ opacity: 0.5, animation: 'blink 1s infinite' }}>▌</span>}
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
    </>
  )
}

