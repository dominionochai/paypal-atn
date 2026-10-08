// List of embedded files with delete functionality
import React, { useState, useEffect } from 'react'
import type { VaultEntry } from '../lib/vault'

interface EmbeddedFilesListProps {
  entries: VaultEntry[]
  onDelete?: (id: string) => void
  onRefresh?: () => void
  className?: string
}

export const EmbeddedFilesList: React.FC<EmbeddedFilesListProps> = ({
  entries,
  onDelete,
  onRefresh,
  className = ''
}) => {
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Filter to only show file entries (url starts with file://)
  const fileEntries = entries.filter(e => e.url.startsWith('file://'))

  const handleDelete = async (id: string) => {
    if (!onDelete) return
    
    setDeletingId(id)
    try {
      await onDelete(id)
      onRefresh?.()
    } catch (error) {
      console.error('Error deleting file:', error)
    } finally {
      setDeletingId(null)
    }
  }

  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return 'Unknown size'
    
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)
    
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    
    return date.toLocaleDateString()
  }

  const getFileIcon = (fileType?: string) => {
    // Return SVG icon component based on file type
    if (fileType === 'application/pdf') {
      return (
        <svg className="w-6 h-6 text-red-400" fill="currentColor" viewBox="0 0 24 24">
          <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20M10.1,11.4C10.08,11.44 9.81,13.16 8,16.09C8,16.09 4.5,17.91 5.33,19.27C6,20.35 7.65,19.23 9.07,16.59C9.07,16.59 10.89,15.95 13.31,15.77C13.31,15.77 17.17,17.5 17.7,15.66C18.22,13.8 14.64,14.22 14,14.41C14,14.41 12,13.06 11.5,11.2C11.5,11.2 12.64,7.25 10.89,7.3C9.14,7.35 9.8,10.43 10.1,11.4M10.91,12.44C10.94,12.45 11.38,13.65 12.8,14.9C12.8,14.9 10.47,15.36 9.41,15.8C9.41,15.8 10.41,14.07 10.91,12.44M14.84,15.16C15.42,15 17.17,15.31 17.1,15.64C17.04,15.97 14.84,15.16 14.84,15.16M7.77,17C7.24,18.24 6.33,19 6.1,19C5.87,19 6.8,17.4 7.77,17M10.91,10.07C10.91,10 10.55,7.87 10.91,7.92C11.45,8 10.91,10 10.91,10.07Z" />
        </svg>
      )
    }
    
    // Default document icon
    return (
      <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    )
  }

  if (fileEntries.length === 0) {
    return null
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {fileEntries.length === 0 ? (
        <div className="text-xs text-gray-500 font-mono text-center py-4">
          No files embedded yet. Drop files in main screen.
        </div>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {fileEntries.map((entry) => (
            <div
              key={entry.id}
              className="flex items-start justify-between p-2 bg-gray-900 border border-gray-800 rounded hover:border-gray-700 transition-colors"
            >
              <div className="flex items-start space-x-2 flex-1 min-w-0">
                {/* File icon */}
                <div className="flex-shrink-0">
                  {getFileIcon(entry.metadata?.fileType)}
                </div>
                
                {/* File info */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-gray-300 truncate">
                    {entry.metadata?.fileName || entry.title}
                  </p>
                  <div className="flex items-center space-x-2 mt-1 text-[10px] text-gray-500 font-mono">
                    <span>{entry.wordCount.toLocaleString()}w</span>
                    <span>•</span>
                    <span>{formatFileSize(entry.metadata?.fileSize)}</span>
                    <span>•</span>
                    <span>{formatDate(entry.timestamp)}</span>
                  </div>
                </div>
              </div>
              
              {/* Delete button */}
              {onDelete && (
                <button
                  onClick={() => handleDelete(entry.id)}
                  disabled={deletingId === entry.id}
                  className="flex-shrink-0 ml-2 p-1 text-gray-500 hover:text-red-400 transition-colors disabled:opacity-50"
                  title="Delete file"
                >
                  {deletingId === entry.id ? (
                    <div className="w-3 h-3 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  )}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

