// Drag and drop zone for file uploads
import React, { useState, useRef } from 'react'
import { isSupportedFileType, getFileTypeName } from '../lib/file-embedder'

interface FileDropZoneProps {
  onFilesSelected: (files: File[]) => void
  isProcessing?: boolean
  className?: string
}

export const FileDropZone: React.FC<FileDropZoneProps> = ({
  onFilesSelected,
  isProcessing = false,
  className = ''
}) => {
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounterRef = useRef(0)

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    dragCounterRef.current++
    
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    dragCounterRef.current--
    
    if (dragCounterRef.current === 0) {
      setIsDragging(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    setIsDragging(false)
    dragCounterRef.current = 0
    setError(null)
    
    if (isProcessing) return
    
    const files = Array.from(e.dataTransfer.files)
    handleFiles(files)
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null)
    
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files)
      handleFiles(files)
    }
  }

  const handleFiles = (files: File[]) => {
    // Validate files
    const unsupportedFiles = files.filter(f => !isSupportedFileType(f.type))
    
    if (unsupportedFiles.length > 0) {
      setError(
        `Unsupported file type: ${unsupportedFiles.map(f => f.name).join(', ')}. ` +
        `Supported: PDF, TXT, MD, HTML, JSON`
      )
      return
    }
    
    // Filter to only supported files
    const supportedFiles = files.filter(f => isSupportedFileType(f.type))
    
    if (supportedFiles.length > 0) {
      onFilesSelected(supportedFiles)
    }
  }

  const handleClick = () => {
    if (!isProcessing) {
      fileInputRef.current?.click()
    }
  }

  return (
    <div className={className}>
      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={handleClick}
        className={`
          relative border-2 border-dashed rounded-lg p-6 
          transition-all duration-200 cursor-pointer
          bg-gray-900/30
          ${isDragging 
            ? 'border-blue-500/70 bg-blue-500/10 scale-[1.01]' 
            : 'border-gray-700 hover:border-gray-600'
          }
          ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.txt,.md,.html,.json"
          onChange={handleFileInput}
          className="hidden"
          disabled={isProcessing}
        />
        
        {/* Drop zone content */}
        <div className="flex flex-col items-center justify-center space-y-2">
          {/* Icon */}
          <svg
            className={`w-10 h-10 transition-colors ${
              isDragging ? 'text-blue-400' : 'text-gray-500'
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          
          {/* Text */}
          <div className="text-center">
            <p className={`text-sm font-medium ${
              isDragging ? 'text-blue-400' : 'text-gray-300'
            }`}>
              {isDragging ? 'Drop files here' : 'Drop files or click'}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              PDF, TXT, MD, HTML, JSON (max 10MB)
            </p>
          </div>
        </div>
        
        {/* Processing overlay */}
        {isProcessing && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 rounded-lg">
            <div className="flex flex-col items-center space-y-2">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-gray-400">Processing...</span>
            </div>
          </div>
        )}
      </div>
      
      {/* Error message */}
      {error && (
        <div className="mt-2 p-3 bg-red-900/30 border border-red-700/50 rounded-lg">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}
    </div>
  )
}

