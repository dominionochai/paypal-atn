import { useEffect, useState, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { Send, Plus } from 'lucide-react'

interface TooltipPosition {
  x: number
  y: number
}

interface SelectionInfo {
  text: string
  element: string
}

const TextSelectionTooltip = () => {
  const [position, setPosition] = useState<TooltipPosition | null>(null)
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(null)
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handleSelection = () => {
      const selection = window.getSelection()
      
      if (!selection || selection.isCollapsed || !selection.toString().trim()) {
        // Hide tooltip if no selection
        setPosition(null)
        setSelectionInfo(null)
        return
      }

      const selectedText = selection.toString().trim()
      const range = selection.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      
      // Get the wrapper element
      const container = range.commonAncestorContainer
      const element = container.nodeType === Node.TEXT_NODE 
        ? container.parentElement 
        : container as Element
      
      const tagName = element?.tagName?.toLowerCase() || 'unknown'
      
      // Position the tooltip above the selection
      setPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + window.scrollY - 10
      })
      
      setSelectionInfo({
        text: selectedText,
        element: tagName
      })
      
      // Clear input when new selection is made
      setInputValue('')
    }

    // Listen for mouseup to detect text selection
    document.addEventListener('mouseup', handleSelection)
    document.addEventListener('keyup', handleSelection) // For keyboard selection
    
    // Hide tooltip when clicking outside
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('.marionette-selection-tooltip')) {
        return
      }
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) {
        setPosition(null)
        setSelectionInfo(null)
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside)

    return () => {
      document.removeEventListener('mouseup', handleSelection)
      document.removeEventListener('keyup', handleSelection)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  // Focus input when tooltip appears
  useEffect(() => {
    if (position && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [position])

  const handlePlusClick = () => {
    // Placeholder for future functionality
    console.log('Plus clicked with:', { selectionInfo, inputValue })
  }

  const handleSendClick = () => {
    // Placeholder for future functionality
    console.log('Send clicked with:', { selectionInfo, inputValue })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSendClick()
    }
  }

  if (!position || !selectionInfo) {
    return null
  }

  return (
    <div
      className="marionette-selection-tooltip"
      style={{
        position: 'absolute',
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: 'translate(-50%, -100%)',
        zIndex: 2147483647,
        pointerEvents: 'auto'
      }}
    >
      <div
        style={{
          background: '#1a1a1a',
          borderRadius: '24px',
          border: '1px solid #2a2a2a',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 8px',
          minWidth: '300px'
        }}
      >
        <button
          onClick={handlePlusClick}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#9ca3af',
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
            e.currentTarget.style.color = '#d1d5db'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = '#9ca3af'
          }}
        >
          <Plus size={16} />
        </button>
        
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="thank you"
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            color: '#d1d5db',
            fontSize: '13px',
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
            outline: 'none',
            padding: '6px 4px'
          }}
        />
        
        <button
          onClick={handleSendClick}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#9ca3af',
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
            e.currentTarget.style.color = '#d1d5db'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = '#9ca3af'
          }}
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  )
}

// Initialize the tooltip
export const initTextSelectionTooltip = () => {
  // Create a container for the tooltip
  const tooltipContainer = document.createElement('div')
  tooltipContainer.id = 'marionette-selection-tooltip-root'
  tooltipContainer.style.position = 'absolute'
  tooltipContainer.style.top = '0'
  tooltipContainer.style.left = '0'
  tooltipContainer.style.width = '0'
  tooltipContainer.style.height = '0'
  tooltipContainer.style.zIndex = '2147483647'
  tooltipContainer.style.pointerEvents = 'none'
  
  document.body.appendChild(tooltipContainer)
  
  const root = createRoot(tooltipContainer)
  root.render(<TextSelectionTooltip />)
  
  console.log('Marionette: Text selection tooltip initialized')
}

