import React, { useState, useRef, useEffect } from "react"
import { Copy, RotateCcw, Square, ArrowLeft, Play, ChevronDown, ChevronRight, Paperclip, X } from "lucide-react"
import { parseToolCall, executeTool } from "../lib/tools"
import { executeUITool } from "../lib/ui-tools"
import { type Message } from "../lib/messages"
import { useChatContext } from "../lib/chat-context"
import { useTTS } from "../lib/tts-context"
import { getToolNames, TOOL_REGISTRY, getToolSpec } from "../lib/tool-registry"
import { testEmbeddings, testSimilarity } from "../lib/transformers-test"
import { searchVault, getVaultStats, clearVault, getAllVaultEntries, deleteVaultEntry } from "../lib/vault"
import { EmbeddedFilesList } from "../components/embedded-files-list"
import { useWakeWordBuiltIn } from "../lib/use-wake-word-builtin"
import { RatingButtons } from "../components/rating-buttons"
import { useOnboarding } from "../components/onboarding/onboarding-provider"
import { getRatingStats, clearAllRatings, exportRatings } from "../lib/rating-database"

interface DebugScreenProps {
  onNavigateToMain: () => void
  fullHeight?: boolean
}

interface CollapsibleSectionProps {
  title: string
  children: React.ReactNode
  defaultExpanded?: boolean
}

const CollapsibleSection = ({ title, children, defaultExpanded = false }: CollapsibleSectionProps) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  return (
    <div className="border-b border-gray-800">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-3 flex items-center justify-between hover:bg-gray-900 transition-colors"
      >
        <div className="font-mono text-xs text-gray-500">{title}</div>
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-gray-500" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-500" />
        )}
      </button>
      {isExpanded && (
        <div className="px-3 pb-3 space-y-2">
          {children}
        </div>
      )}
    </div>
  )
}

const ToolTester = () => {
  const [selectedTool, setSelectedTool] = useState("")
  const [params, setParams] = useState("{}")
  const [result, setResult] = useState<any>(null)
  const [isExecuting, setIsExecuting] = useState(false)

  const toolNames = getToolNames()
  const selectedToolSpec = TOOL_REGISTRY.find(t => t.name === selectedTool)

  const handleExecute = async () => {
    if (!selectedTool) return

    setIsExecuting(true)
    setResult(null)

    try {
      const parsedParams = JSON.parse(params)
      const toolSpec = getToolSpec(selectedTool)
      
      // Check if tool requires user gesture (UI context)
      let toolResult
      if (toolSpec?.requiresUserGesture) {
        console.log('[DEBUG] Executing UI tool:', selectedTool)
        toolResult = await executeUITool({ function: selectedTool, arguments: parsedParams })
      } else {
        console.log('[DEBUG] Executing background tool:', selectedTool)
        toolResult = await executeTool({ function: selectedTool, arguments: parsedParams })
      }
      
      setResult(toolResult)
    } catch (error: any) {
      setResult({ success: false, error: error.message })
    } finally {
      setIsExecuting(false)
    }
  }

  const handleToolChange = (toolName: string) => {
    setSelectedTool(toolName)
    const spec = TOOL_REGISTRY.find(t => t.name === toolName)
    if (spec) {
      const defaultParams: any = {}
      spec.parameters.forEach(p => {
        if (p.required) {
          defaultParams[p.name] = p.type === 'number' ? 0 : ""
        }
      })
      setParams(JSON.stringify(defaultParams, null, 2))
    }
  }

  return (
    <>
      <div className="flex gap-2">
        <select
          value={selectedTool}
          onChange={(e) => handleToolChange(e.target.value)}
          className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-gray-500"
        >
          <option value="">select tool</option>
          {toolNames.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        
        <button
          onClick={handleExecute}
          disabled={!selectedTool || isExecuting}
          className="px-3 py-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs font-mono flex items-center gap-1"
        >
          <Play className="w-3 h-3" />
          run
        </button>
      </div>

      {selectedToolSpec && (
        <div className="text-xs text-gray-500 font-mono">
          {selectedToolSpec.parameters.map(p => (
            <div key={p.name} className="text-[10px]">
              <span className={p.required ? "text-gray-400" : "text-gray-600"}>
                {p.name}: {p.type} {p.required && "*"}
              </span>
            </div>
          ))}
        </div>
      )}

      <textarea
        value={params}
        onChange={(e) => setParams(e.target.value)}
        placeholder='{"param": "value"}'
        className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-gray-500 h-20 resize-none"
      />

      {isExecuting && (
        <div className="text-xs text-cyan-400 font-mono">executing...</div>
      )}

      {result && (
        <div className="bg-gray-900 border border-gray-700 rounded p-2">
          <div className={`text-xs font-mono ${result.success ? 'text-green-400' : 'text-red-400'}`}>
            {result.success ? 'SUCCESS' : 'ERROR'}
          </div>
          <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap mt-1 max-h-40 overflow-y-auto">
            <code>{result.success ? result.result : result.error}</code>
          </pre>
        </div>
      )}
    </>
  )
}

const TransformersTest = () => {
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<any>(null)

  const runEmbeddingTest = async () => {
    setIsLoading(true)
    setResult(null)
    
    const res = await testEmbeddings("Hello world, this is a test!")
    setResult(res)
    setIsLoading(false)
  }

  const runSimilarityTest = async () => {
    setIsLoading(true)
    setResult(null)
    
    const res = await testSimilarity(
      "I love programming",
      "I enjoy coding"
    )
    setResult(res)
    setIsLoading(false)
  }

  return (
    <>
      <div className="flex gap-2">
        <button
          onClick={runEmbeddingTest}
          disabled={isLoading}
          className="px-3 py-1 bg-purple-900 hover:bg-purple-800 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs font-mono flex items-center gap-1"
        >
          <Play className="w-3 h-3" />
          Test Embeddings
        </button>
        
        <button
          onClick={runSimilarityTest}
          disabled={isLoading}
          className="px-3 py-1 bg-purple-900 hover:bg-purple-800 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs font-mono flex items-center gap-1"
        >
          <Play className="w-3 h-3" />
          Test Similarity
        </button>
      </div>

      {isLoading && (
        <div className="text-xs text-purple-400 font-mono animate-pulse">
          Loading model and generating embeddings... (first time may take 10-30s to download ~23MB model)
        </div>
      )}

      {result && (
        <div className="bg-gray-900 border border-gray-700 rounded p-2">
          <div className={`text-xs font-mono ${result.success ? 'text-green-400' : 'text-red-400'}`}>
            {result.success ? 'SUCCESS ✓' : 'ERROR ✗'}
          </div>
          {result.success && result.dimensions && (
            <div className="text-xs text-gray-300 font-mono mt-1">
              <div>Dimensions: {result.dimensions}</div>
              {result.similarity !== undefined && (
                <div className="mt-1">
                  <div>Text 1: {result.text1}</div>
                  <div>Text 2: {result.text2}</div>
                  <div className="text-purple-400 font-bold">Similarity: {(result.similarity * 100).toFixed(2)}%</div>
                </div>
              )}
              {result.embedding && (
                <div className="mt-1 text-[10px] text-gray-500">
                  First 10 values: [{result.embedding.slice(0, 10).map((v: number) => v.toFixed(4)).join(', ')}]
                </div>
              )}
            </div>
          )}
          {result.error && (
            <div className="text-xs text-red-300 font-mono mt-1">{result.error}</div>
          )}
        </div>
      )}
    </>
  )
}

const WakeWordTest = () => {
  const { isListening, lastDetection, error, start, stop } = useWakeWordBuiltIn(() => {
    console.log('Wake word callback triggered!')
  })

  return (
    <>
      <div className="flex gap-2">
        {!isListening ? (
          <button
            onClick={start}
            className="px-3 py-1 bg-purple-900 hover:bg-purple-800 rounded text-xs font-mono flex items-center gap-1"
          >
            <Play className="w-3 h-3" />
            Start Wake Word
          </button>
        ) : (
          <button
            onClick={stop}
            className="px-3 py-1 bg-red-900 hover:bg-red-800 rounded text-xs font-mono flex items-center gap-1"
          >
            <Square className="w-3 h-3" />
            Stop Wake Word
          </button>
        )}
      </div>

      {isListening && (
        <div className="text-xs text-purple-400 font-mono animate-pulse">
          Listening for "Porcupine" (built-in test keyword)...
        </div>
      )}

      {lastDetection && (
        <div className="bg-purple-900 border border-purple-700 rounded p-2">
          <div className="text-xs font-mono text-purple-400">
            DETECTED: {lastDetection}
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-900 border border-red-700 rounded p-2">
          <div className="text-xs font-mono text-red-400">
            ERROR: {error}
          </div>
        </div>
      )}
    </>
  )
}

const OnboardingControls = () => {
  const { state, resetOnboarding } = useOnboarding()

  return (
    <>
      <div className="space-y-2">
        <div className="bg-gray-900 border border-gray-700 rounded p-2 text-[10px] font-mono">
          <div className="text-gray-300">
            <div>Status: {state.isComplete ? '✓ Complete' : '⚠ Not Complete'}</div>
            <div>Microphone: {state.micPermissionGranted ? '✓ Granted' : '✗ Not Granted'}</div>
            <div>AI Model: {state.modelAvailable ? '✓ Available' : '✗ Unavailable'}</div>
            <div>Speech Recognition: {state.speechRecognitionAvailable ? '✓ Available' : '✗ Unavailable'}</div>
            {state.currentStep && (
              <div className="text-purple-400 mt-1">Current Step: {state.currentStep}</div>
            )}
          </div>
        </div>

        <button
          onClick={resetOnboarding}
          className="w-full px-3 py-2 bg-purple-900 hover:bg-purple-800 rounded text-xs font-mono flex items-center justify-center gap-2"
        >
          <RotateCcw className="w-3 h-3" />
          Reset Onboarding
        </button>
      </div>
    </>
  )
}

const MemoriesDebugger = () => {
  const [memories, setMemories] = useState<any[]>([])
  const [newMemoryContent, setNewMemoryContent] = useState("")
  const [newMemoryTags, setNewMemoryTags] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const loadMemories = async () => {
    setIsLoading(true)
    try {
      const storage = await chrome.storage.local.get(['agent_memories'])
      const memoriesData = storage.agent_memories || []
      // Sort by timestamp (most recent first)
      const sorted = memoriesData.sort((a: any, b: any) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
      setMemories(sorted)
    } catch (error: any) {
      console.error('Error loading memories:', error)
    }
    setIsLoading(false)
  }

  const handleAddMemory = async () => {
    if (!newMemoryContent.trim()) return

    setIsLoading(true)
    try {
      const tags = newMemoryTags
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0)

      // Use the storeMemory tool
      const result = await executeTool({
        function: 'storeMemory',
        arguments: {
          content: newMemoryContent.trim(),
          tags: tags.length > 0 ? tags : undefined
        }
      })

      if (result.success) {
        setNewMemoryContent("")
        setNewMemoryTags("")
        await loadMemories()
      } else {
        alert(`Error: ${result.error}`)
      }
    } catch (error: any) {
      alert(`Error: ${error.message}`)
    }
    setIsLoading(false)
  }

  const handleDeleteMemory = async (memoryId: string) => {
    if (!confirm('Delete this memory?')) return

    setIsLoading(true)
    try {
      const storage = await chrome.storage.local.get(['agent_memories'])
      const memoriesData = storage.agent_memories || []
      const updated = memoriesData.filter((m: any) => m.id !== memoryId)
      await chrome.storage.local.set({ agent_memories: updated })
      await loadMemories()
    } catch (error: any) {
      alert(`Error: ${error.message}`)
    }
    setIsLoading(false)
  }

  const handleClearAll = async () => {
    if (!confirm('Are you sure you want to delete ALL memories? This cannot be undone.')) {
      return
    }

    setIsLoading(true)
    try {
      await chrome.storage.local.set({ agent_memories: [] })
      await loadMemories()
    } catch (error: any) {
      alert(`Error: ${error.message}`)
    }
    setIsLoading(false)
  }

  useEffect(() => {
    loadMemories()
  }, [])

  return (
    <>
      {/* Stats */}
      <div className="flex items-center justify-between">
        <div className="text-xs font-mono text-gray-400">
          Total: {memories.length} {memories.length === 1 ? 'memory' : 'memories'}
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadMemories}
            disabled={isLoading}
            className="px-2 py-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 rounded text-[10px] font-mono"
          >
            Refresh
          </button>
          <button
            onClick={handleClearAll}
            disabled={isLoading || memories.length === 0}
            className="px-2 py-1 bg-red-900 hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed rounded text-[10px] font-mono"
          >
            Clear All
          </button>
        </div>
      </div>

      {/* Add Memory Form */}
      <div className="space-y-2 bg-gray-900 border border-gray-700 rounded p-2">
        <div className="text-xs font-mono text-gray-400">Add New Memory:</div>
        <textarea
          value={newMemoryContent}
          onChange={(e) => setNewMemoryContent(e.target.value)}
          placeholder="Memory content (e.g., 'User's name is John Doe')"
          className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-gray-500 h-16 resize-none"
        />
        <input
          type="text"
          value={newMemoryTags}
          onChange={(e) => setNewMemoryTags(e.target.value)}
          placeholder="Tags (comma-separated, e.g., 'personal-info, name')"
          className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-gray-500"
        />
        <button
          onClick={handleAddMemory}
          disabled={isLoading || !newMemoryContent.trim()}
          className="w-full px-3 py-1 bg-green-900 hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs font-mono flex items-center justify-center gap-2"
        >
          <Play className="w-3 h-3" />
          Add Memory
        </button>
      </div>

      {/* Memories List */}
      <div className="space-y-2">
        <div className="text-xs font-mono text-gray-400">Stored Memories:</div>
        {memories.length === 0 ? (
          <div className="bg-gray-900 border border-gray-700 rounded p-3 text-center text-xs text-gray-500 font-mono">
            No memories stored yet
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-700 rounded p-2 max-h-80 overflow-y-auto space-y-2">
            {memories.map((memory: any) => (
              <div
                key={memory.id}
                className="bg-gray-950 border border-gray-800 rounded p-2 hover:border-gray-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-gray-300 font-mono break-words">
                      {memory.content}
                    </div>
                    {memory.tags && memory.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {memory.tags.map((tag: string, i: number) => (
                          <span
                            key={i}
                            className="px-1.5 py-0.5 bg-purple-900 text-purple-300 rounded text-[9px] font-mono"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="text-[9px] text-gray-600 font-mono mt-1">
                      {memory.date}
                      {memory.embedding && (
                        <span className="ml-2 text-purple-500">● embedded</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteMemory(memory.id)}
                    disabled={isLoading}
                    className="px-2 py-1 bg-red-900 hover:bg-red-800 disabled:opacity-50 rounded text-[9px] font-mono shrink-0"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

const RatingStatsDebugger = () => {
  const [stats, setStats] = useState<{ total: number; positive: number; negative: number } | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const loadStats = async () => {
    setIsLoading(true)
    try {
      const ratingStats = await getRatingStats()
      setStats(ratingStats)
    } catch (error: any) {
      console.error('Error loading rating stats:', error)
      setStats({ total: 0, positive: 0, negative: 0 })
    }
    setIsLoading(false)
  }

  const handleClearRatings = async () => {
    if (!confirm('Are you sure you want to clear all ratings? This cannot be undone.')) {
      return
    }
    
    setIsLoading(true)
    try {
      await clearAllRatings()
      await loadStats()
      alert('All ratings cleared successfully!')
    } catch (error: any) {
      alert(`Error clearing ratings: ${error.message}`)
    }
    setIsLoading(false)
  }

  const handleExportRatings = async () => {
    setIsLoading(true)
    try {
      const jsonData = await exportRatings()
      
      // Create download link
      const blob = new Blob([jsonData], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `marionette-ratings-${Date.now()}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      
      alert('Ratings exported successfully!')
    } catch (error: any) {
      alert(`Error exporting ratings: ${error.message}`)
    }
    setIsLoading(false)
  }

  useEffect(() => {
    loadStats()
  }, [])

  return (
    <>
      {/* Stats Section */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="text-xs font-mono text-gray-400">Rating Statistics:</div>
          <button
            onClick={loadStats}
            disabled={isLoading}
            className="px-2 py-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 rounded text-[10px] font-mono"
          >
            Refresh
          </button>
        </div>
        
        {stats && (
          <div className="bg-gray-900 border border-gray-700 rounded p-2 text-[10px] font-mono">
            <div className="text-gray-300 space-y-1">
              <div>📊 Total Ratings: {stats.total}</div>
              <div className="flex items-center gap-3">
                <div className="text-green-400">👍 Positive: {stats.positive}</div>
                <div className="text-red-400">👎 Negative: {stats.negative}</div>
              </div>
              {stats.total > 0 && (
                <div className="text-gray-500 text-[9px] mt-1">
                  Positive Rate: {((stats.positive / stats.total) * 100).toFixed(1)}%
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleExportRatings}
          disabled={isLoading || !stats || stats.total === 0}
          className="flex-1 px-3 py-2 bg-blue-900 hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs font-mono"
        >
          Export JSON
        </button>
        <button
          onClick={handleClearRatings}
          disabled={isLoading || !stats || stats.total === 0}
          className="flex-1 px-3 py-2 bg-red-900 hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs font-mono"
        >
          Clear All
        </button>
      </div>
    </>
  )
}

const EmbeddedFilesDebugger = () => {
  const [vaultEntries, setVaultEntries] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const loadFiles = async () => {
    setIsLoading(true)
    try {
      const entries = await getAllVaultEntries()
      setVaultEntries(entries)
    } catch (error: any) {
      console.error('Error loading files:', error)
    }
    setIsLoading(false)
  }

  const handleDelete = async (id: string) => {
    setIsLoading(true)
    try {
      await deleteVaultEntry(id)
      await loadFiles()
    } catch (error: any) {
      alert(`Error deleting file: ${error.message}`)
    }
    setIsLoading(false)
  }

  useEffect(() => {
    loadFiles()
  }, [])

  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-mono text-gray-400">
          Total: {vaultEntries.length} entries
        </div>
        <button
          onClick={loadFiles}
          disabled={isLoading}
          className="px-2 py-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 rounded text-[10px] font-mono"
        >
          Refresh
        </button>
      </div>

      <EmbeddedFilesList 
        entries={vaultEntries}
        onDelete={handleDelete}
        onRefresh={loadFiles}
      />
    </>
  )
}

const VaultDebugger = () => {
  const [stats, setStats] = useState<any>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(false)

  const loadStats = async () => {
    setIsLoading(true)
    try {
      const vaultStats = await getVaultStats()
      setStats(vaultStats)
    } catch (error: any) {
      setStats({ error: error.message })
    }
    setIsLoading(false)
  }

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    
    setIsLoading(true)
    setSearchResults(null)
    
    try {
      const results = await searchVault(searchQuery, 5, 0.2) // 20% threshold
      setSearchResults(results)
    } catch (error: any) {
      setSearchResults({ error: error.message })
    }
    
    setIsLoading(false)
  }

  const handleCapture = async () => {
    setIsLoading(true)
    try {
      // Execute captureCurrentPage tool
      const result = await executeTool({ 
        function: 'captureCurrentPage', 
        arguments: {} 
      })
      
      if (result.success) {
        // Reload stats after capture
        await loadStats()
        alert('Page captured! Check stats below.')
      } else {
        alert(`Error: ${result.error}`)
      }
    } catch (error: any) {
      alert(`Error: ${error.message}`)
    }
    setIsLoading(false)
  }

  const handleClearVault = async () => {
    if (!confirm('Are you sure you want to clear the entire vault? This cannot be undone.')) {
      return
    }
    
    setIsLoading(true)
    try {
      await clearVault()
      await loadStats()
      setSearchResults(null)
      alert('Vault cleared successfully!')
    } catch (error: any) {
      alert(`Error clearing vault: ${error.message}`)
    }
    setIsLoading(false)
  }

  useEffect(() => {
    loadStats()
  }, [])

  return (
    <>
      {/* Stats Section */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="text-xs font-mono text-gray-400">Statistics:</div>
          <button
            onClick={loadStats}
            disabled={isLoading}
            className="px-2 py-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 rounded text-[10px] font-mono"
          >
            Refresh
          </button>
          <button
            onClick={handleClearVault}
            disabled={isLoading || !stats || stats.count === 0}
            className="px-2 py-1 bg-red-900 hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed rounded text-[10px] font-mono"
          >
            Clear Vault
          </button>
        </div>
        
        {stats && (
          <div className="bg-gray-900 border border-gray-700 rounded p-2 text-[10px] font-mono">
            {stats.error ? (
              <div className="text-red-400">{stats.error}</div>
            ) : (
              <div className="text-gray-300">
                <div>📊 Total Pages: {stats.count}</div>
                {stats.count > 0 && (
                  <>
                    <div className="mt-1">📅 Newest: {new Date(stats.newestEntry).toLocaleString()}</div>
                    <div className="text-gray-500 text-[9px] mt-1">
                      Domains: {Object.keys(stats.domains).slice(0, 3).join(', ')}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Capture Button */}
      <div>
        <button
          onClick={handleCapture}
          disabled={isLoading}
          className="w-full px-3 py-2 bg-green-900 hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs font-mono flex items-center justify-center gap-2"
        >
          <Play className="w-3 h-3" />
          Capture Current Page
        </button>
      </div>

      {/* Search Section */}
      <div className="space-y-2">
        <div className="text-xs font-mono text-gray-400">Search Vault:</div>
        <div className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="e.g., AI articles"
            className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-gray-500"
          />
          <button
            onClick={handleSearch}
            disabled={isLoading || !searchQuery.trim()}
            className="px-3 py-1 bg-blue-900 hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs font-mono flex items-center gap-1"
          >
            <Play className="w-3 h-3" />
            Search
          </button>
        </div>

        {isLoading && (
          <div className="text-xs text-blue-400 font-mono animate-pulse">
            Searching...
          </div>
        )}

        {searchResults && (
          <div className="bg-gray-900 border border-gray-700 rounded p-2 max-h-60 overflow-y-auto">
            {searchResults.error ? (
              <div className="text-xs text-red-400 font-mono">{searchResults.error}</div>
            ) : searchResults.length === 0 ? (
              <div className="text-xs text-gray-500 font-mono">No results found</div>
            ) : (
              <div className="space-y-2">
                {searchResults.map((page: any, i: number) => (
                  <div key={page.id} className="border-b border-gray-800 last:border-0 pb-2 last:pb-0">
                    <div className="text-xs font-mono text-gray-300">
                      [{i + 1}] {page.title}
                    </div>
                    <div className="text-[10px] text-purple-400 font-mono">
                      {(page.similarity * 100).toFixed(0)}% match • {page.domain}
                    </div>
                    <div className="text-[10px] text-gray-500 font-mono mt-1">
                      {page.excerpt}
                    </div>
                    <div className="text-[9px] text-gray-600 font-mono mt-1 truncate">
                      {page.url}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}

export const DebugScreen = ({ onNavigateToMain, fullHeight = false }: DebugScreenProps) => {
  const { state, sendMessage, resetChat, interruptChat, copyContext, rateMessage, dispatch } = useChatContext()
  const { stop, isSpeaking } = useTTS()
  const [input, setInput] = useState("")
  const [copyFeedback, setCopyFeedback] = useState("")
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [state.messages, state.isWaitingForFirstChunk])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return

    // Interrupt any ongoing processing or TTS before sending new message
    if (state.isProcessing || isSpeaking) {
      handleInterrupt()
    }

    const userInput = input.trim()
    setInput("")
    await sendMessage(userInput)
  }

  const handleReset = () => {
    resetChat()
    setCopyFeedback("Reset complete")
    setTimeout(() => setCopyFeedback(""), 2000)
  }

  const handleInterrupt = () => {
    stop() // Stop TTS immediately
    interruptChat()
  }

  const handleCopyContext = async () => {
    try {
      const contextText = await copyContext()
      await navigator.clipboard.writeText(contextText)
      setCopyFeedback("Context copied")
      setTimeout(() => setCopyFeedback(""), 2000)
    } catch (error) {
      setCopyFeedback("Copy failed")
      setTimeout(() => setCopyFeedback(""), 2000)
    }
  }


  const renderMessage = (message: Message) => {
    // Check if it's a tool result message FIRST (before parsing tool calls)
    // Tool results may contain example tool calls from playbooks that should NOT be parsed
    const isToolResult = message.content.startsWith('[TOOL RESULT]')
    
    // Only parse tool calls if this is NOT a tool result
    const toolCall = !isToolResult ? parseToolCall(message.content) : null
    
    if (toolCall) {
      // Extract text before tool call, handling code blocks
      let contentToSplit = message.content
      // Remove code block wrapper if present
      const codeBlockMatch = contentToSplit.match(/```(?:tool_code|tool_call|function_call|json)\s*\n?(.*?)```/s)
      if (codeBlockMatch) {
        contentToSplit = codeBlockMatch[1]
      }
      const textBeforeToolCall = contentToSplit.split('<function_call>')[0].trim()
      
      return (
        <div key={message.id} className="mb-2 font-mono text-xs">
          <div className="text-gray-500 mb-1">{message.role.toUpperCase()}</div>
          {textBeforeToolCall && (
            <div className="text-gray-200 whitespace-pre-wrap mb-2">{textBeforeToolCall}</div>
          )}
          <div className="text-gray-500 mb-1">TOOL_CALL</div>
          <div className="bg-gray-900 p-2 rounded border border-gray-700">
            <div className="text-gray-300">{toolCall.function}</div>
            {Object.keys(toolCall.arguments).length > 0 && (
              <div className="text-gray-400 mt-1 text-[10px]">
                {Object.entries(toolCall.arguments).map(([key, value]) => (
                  <div key={key}>
                    <span className="text-gray-500">{key}:</span>{' '}
                    <span className="text-gray-300">{typeof value === 'string' ? value : JSON.stringify(value)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {message.contextCount !== undefined && (
            <div className="text-gray-600 text-[10px] mt-1">
              CONTEXT: {message.contextCount}/9216 tokens
            </div>
          )}
          {!state.isProcessing && !state.isInToolLoop && (
            <div className="mt-2">
              <RatingButtons 
                messageId={message.id}
                currentRating={message.rating}
                onRate={rateMessage}
                size="sm"
              />
            </div>
          )}
        </div>
      )
    }
    
    if (isToolResult) {
      const resultContent = message.content.replace('[TOOL RESULT]\n', '')
      
      // Check if it's a screenshot
      const isScreenshot = resultContent.startsWith('data:image/')
      
      // Check if it's audio
      const isAudio = resultContent.startsWith('data:audio/')
      
      if (isScreenshot) {
        return (
          <div key={message.id} className="mb-2 font-mono text-xs">
            <div className="text-blue-400 mb-1">TOOL RESULT</div>
            <div className="bg-blue-950 p-2 rounded border border-blue-800">
              <img src={resultContent} alt="Screenshot" className="w-full rounded" />
            </div>
          </div>
        )
      }
      
      if (isAudio) {
        return (
          <div key={message.id} className="mb-2 font-mono text-xs">
            <div className="text-blue-400 mb-1">TOOL RESULT</div>
            <div className="bg-blue-950 p-2 rounded border border-blue-800">
              <audio src={resultContent} controls className="w-full" />
            </div>
          </div>
        )
      }
      
      return (
        <div key={message.id} className="mb-2 font-mono text-xs">
          <div className="text-blue-400 mb-1">TOOL RESULT</div>
          <pre className="bg-blue-950 p-2 rounded border border-blue-800 text-blue-200 whitespace-pre-wrap text-[10px] max-h-40 overflow-y-auto">
            <code>{resultContent}</code>
          </pre>
        </div>
      )
    }

    return (
      <div key={message.id} className="mb-2 font-mono text-xs">
        <div className="text-gray-500 mb-1">{message.role.toUpperCase()}</div>
        <div className="text-gray-200 whitespace-pre-wrap">{message.content}</div>
        {message.role === 'assistant' && message.contextCount !== undefined && (
          <div className="text-gray-600 text-[10px] mt-1">
            CONTEXT: {message.contextCount}/9216 tokens
          </div>
        )}
        {message.role === 'assistant' && !state.isProcessing && !state.isInToolLoop && (
          <div className="mt-2">
            <RatingButtons 
              messageId={message.id}
              currentRating={message.rating}
              onRate={rateMessage}
              size="sm"
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div 
      className="w-full  bg-black text-white flex flex-col" 
      style={fullHeight ? { height: '100vh' } : { minHeight: '500px', maxHeight: '600px' }}
    >
      {/* Header */}
      <div className="p-3 border-b border-gray-800 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <button
            onClick={onNavigateToMain}
            className="p-1 hover:bg-gray-800 rounded"
            title="Back to main"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="font-mono text-sm">DEBUG_CHAT</div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleCopyContext}
            className="p-1 hover:bg-gray-800 rounded"
            title="Copy context"
          >
            <Copy className="w-4 h-4" />
          </button>
          {state.isProcessing && (
            <button
              onClick={handleInterrupt}
              className="p-1 hover:bg-gray-800 rounded"
              title="Stop response"
            >
              <Square className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={handleReset}
            className="p-1 hover:bg-gray-800 rounded"
            title="Reset everything"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Scrollable Tools & Debuggers Section */}
      <div className="overflow-y-auto border-b border-gray-800 flex-shrink-0" style={{ height: '30vh', minHeight: '200px', maxHeight: '300px' }}>
        {/* Onboarding Controls */}
        <CollapsibleSection title="ONBOARDING">
          <OnboardingControls />
        </CollapsibleSection>

        {/* Tool Tester */}
        <CollapsibleSection title="MANUAL_TOOL_TEST">
          <ToolTester />
        </CollapsibleSection>

        {/* Wake Word Test */}
        <CollapsibleSection title="WAKE WORD TEST">
          <WakeWordTest />
        </CollapsibleSection>

        {/* Transformers.js Test */}
        <CollapsibleSection title="TRANSFORMERS.JS TEST">
          <TransformersTest />
        </CollapsibleSection>

        {/* Memories Debugger */}
        <CollapsibleSection title="MEMORIES MANAGER">
          <MemoriesDebugger />
        </CollapsibleSection>

        {/* Vault Debugger */}
        <CollapsibleSection title="VAULT DEBUGGER">
          <VaultDebugger />
        </CollapsibleSection>

        {/* Embedded Files */}
        <CollapsibleSection title="EMBEDDED FILES">
          <EmbeddedFilesDebugger />
        </CollapsibleSection>

        {/* Rating Stats */}
        <CollapsibleSection title="RATING STATS">
          <RatingStatsDebugger />
        </CollapsibleSection>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3">
        {state.messages.map(renderMessage)}
        
        {/* ALWAYS show status when processing - event-driven, no complex conditions */}
        {state.isProcessing && (
          <div className="mb-4 font-mono text-xs">
            {state.isSummarizing ? (
              <>
                <div className="text-yellow-400 mb-1">SUMMARIZING</div>
                <div className="text-gray-400">Condensing conversation to save context...</div>
              </>
            ) : state.isWarmingUp ? (
              <>
                <div className="text-orange-400 mb-1 flex items-center gap-2">
                  <span className="animate-pulse">●</span>
                  WARMING UP
                </div>
                <div className="text-gray-400">Loading AI model for first time...</div>
              </>
            ) : state.executingTool ? (
              <>
                <div className="text-cyan-400 mb-1 flex items-center gap-2">
                  <span className="animate-pulse">●</span>
                  EXECUTING: {state.executingTool}
                </div>
              </>
            ) : (
              <>
                <div className="text-gray-500 mb-1">ASSISTANT</div>
                <div className="text-gray-400 flex items-center gap-1">
                  <span className="animate-pulse">thinking...</span>
                </div>
              </>
            )}
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Feedback */}
      {copyFeedback && (
        <div className="px-3 py-1 text-xs text-green-400">
          {copyFeedback}
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-gray-800">
        {/* Reference indicator */}
        {state.reference && (
          <div 
            className="mb-2 flex flex-col gap-2 px-3 py-2 bg-blue-900/20 border border-blue-700/30 rounded text-xs font-mono"
            style={{
              animation: 'slideInScale 0.3s ease-out',
            }}
          >
            <div className="flex items-center gap-2">
              <Paperclip size={14} className="text-blue-400" style={{ animation: 'spin 0.5s ease-out' }} />
              <span className="text-gray-400 flex-1 truncate">
                {state.reference.image ? 'Screenshot' : state.reference.audio ? 'Audio Recording' : `"${state.reference.text.substring(0, 50)}${state.reference.text.length > 50 ? '...' : ''}"`}
              </span>
              <button
                type="button"
                onClick={() => {
                  dispatch({ type: 'SET_REFERENCE', payload: null })
                  chrome.storage.local.remove('chat_reference')
                }}
                className="text-gray-500 hover:text-gray-300 transition-colors"
              >
                <X size={14} />
              </button>
            </div>
            
            {/* Image preview */}
            {state.reference.image && (
              <img 
                src={state.reference.image} 
                alt="Reference screenshot" 
                className="max-w-full max-h-32 rounded border border-blue-700/30"
              />
            )}
            
            {/* Audio preview */}
            {state.reference.audio && (
              <audio 
                src={state.reference.audio} 
                controls 
                className="w-full h-8"
                style={{ maxWidth: '300px' }}
              />
            )}
            
            {/* Explanation */}
            {state.reference.explanation && (
              <div className="text-gray-500 text-xs italic border-t border-blue-700/20 pt-2">
                {state.reference.explanation.substring(0, 100)}{state.reference.explanation.length > 100 ? '...' : ''}
              </div>
            )}
          </div>
        )}
        
        <style>{`
          @keyframes slideInScale {
            0% {
              opacity: 0;
              transform: translateY(-10px) scale(0.95);
            }
            100% {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
          
          @keyframes spin {
            0% {
              transform: rotate(0deg) scale(1);
            }
            50% {
              transform: rotate(180deg) scale(1.2);
            }
            100% {
              transform: rotate(360deg) scale(1);
            }
          }
        `}</style>
        
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={state.isProcessing}
          placeholder="Type message..."
          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-gray-500 disabled:opacity-50"
        />
      </form>
    </div>
  )
}

