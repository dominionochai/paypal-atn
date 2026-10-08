import React from 'react'
import { 
  Wand2, 
  Minimize2, 
  Maximize2, 
  Sparkles, 
  Smile, 
  Briefcase, 
  Zap,
  MessageCircle,
  ThumbsUp
} from 'lucide-react'

export interface PresetAction {
  id: string
  label: string
  icon: React.ReactNode
  prompt: string
  color: string
}

export const REWRITER_PRESETS: PresetAction[] = [
  {
    id: 'shorter',
    label: 'Shorter',
    icon: <Minimize2 size={14} />,
    prompt: 'make this shorter and more concise',
    color: '#3b82f6' // blue
  },
  {
    id: 'longer',
    label: 'Expand',
    icon: <Maximize2 size={14} />,
    prompt: 'make this longer and more detailed',
    color: '#8b5cf6' // purple
  },
  {
    id: 'professional',
    label: 'Professional',
    icon: <Briefcase size={14} />,
    prompt: 'make this more professional and formal',
    color: '#06b6d4' // cyan
  },
  {
    id: 'friendly',
    label: 'Friendly',
    icon: <Smile size={14} />,
    prompt: 'make this more friendly and casual',
    color: '#f59e0b' // amber
  },
  {
    id: 'improve',
    label: 'Improve',
    icon: <Sparkles size={14} />,
    prompt: 'improve this text and fix any grammar issues',
    color: '#10b981' // green
  },
  {
    id: 'simplify',
    label: 'Simplify',
    icon: <Zap size={14} />,
    prompt: 'simplify this and make it easier to understand',
    color: '#ef4444' // red
  },
  {
    id: 'enthusiastic',
    label: 'Enthusiastic',
    icon: <ThumbsUp size={14} />,
    prompt: 'make this more enthusiastic and positive',
    color: '#ec4899' // pink
  },
  {
    id: 'conversational',
    label: 'Conversational',
    icon: <MessageCircle size={14} />,
    prompt: 'make this more conversational and natural',
    color: '#14b8a6' // teal
  }
]

interface RewriterPresetsProps {
  onPresetClick: (preset: PresetAction) => void
  disabled?: boolean
}

export const RewriterPresets: React.FC<RewriterPresetsProps> = ({ 
  onPresetClick, 
  disabled = false 
}) => {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '4px',
      padding: '6px 0'
    }}>
      {REWRITER_PRESETS.map((preset) => (
        <button
          key={preset.id}
          onClick={() => onPresetClick(preset)}
          disabled={disabled}
          style={{
            background: 'transparent',
            border: '1px solid #374151',
            borderRadius: '6px',
            padding: '6px 4px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '3px',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            transition: 'all 0.2s',
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
            fontSize: '9px',
            color: '#9ca3af'
          }}
          onMouseEnter={(e) => {
            if (!disabled) {
              e.currentTarget.style.background = '#1f2937'
              e.currentTarget.style.borderColor = preset.color
              e.currentTarget.style.color = preset.color
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.borderColor = '#374151'
            e.currentTarget.style.color = '#9ca3af'
          }}
        >
          <div style={{ 
            color: preset.color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            {preset.icon}
          </div>
          <span style={{ 
            textAlign: 'center',
            lineHeight: '1.2',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '100%'
          }}>
            {preset.label}
          </span>
        </button>
      ))}
    </div>
  )
}

