import React from "react"
import { ThumbsUp, ThumbsDown } from "lucide-react"

interface RatingButtonsProps {
  messageId: string
  currentRating?: 'up' | 'down' | null
  onRate: (messageId: string, rating: 'up' | 'down') => void
  size?: 'sm' | 'md'
}

export const RatingButtons = ({ messageId, currentRating, onRate, size = 'sm' }: RatingButtonsProps) => {
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'
  const padding = size === 'sm' ? 'p-1' : 'p-2'
  const rounded = size === 'sm' ? 'rounded' : 'rounded-full'

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onRate(messageId, 'up')}
        className={`${padding} hover:bg-gray-800 ${rounded} transition-colors`}
        title="Good response"
      >
        <ThumbsUp 
          className={`${iconSize} ${currentRating === 'up' ? 'text-green-400 fill-green-400' : 'text-gray-500 hover:text-green-400'}`}
        />
      </button>
      <button
        onClick={() => onRate(messageId, 'down')}
        className={`${padding} hover:bg-gray-800 ${rounded} transition-colors`}
        title="Bad response"
      >
        <ThumbsDown 
          className={`${iconSize} ${currentRating === 'down' ? 'text-red-400 fill-red-400' : 'text-gray-500 hover:text-red-400'}`}
        />
      </button>
    </div>
  )
}
