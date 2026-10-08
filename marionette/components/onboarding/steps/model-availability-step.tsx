import React, { useState, useEffect } from 'react'
import { Brain, AlertCircle, CheckCircle, ArrowRight, ArrowLeft, Loader2, ExternalLink } from 'lucide-react'
import { useOnboarding } from '../onboarding-provider'
import { openAIFlagsPage, openWriterAPIFlagsPage, openRewriterAPIFlagsPage, openSummarizationAPIFlagsPage, openTranslatorAPIFlagsPage, openChromeAIDocs } from '../../../lib/alert-context'

type APIStatus = 'checking' | 'available' | 'unavailable' | 'after-download'

interface APIAvailability {
  promptAPI: APIStatus
  writerAPI: APIStatus
  rewriterAPI: APIStatus
  summarizationAPI: APIStatus
  translationAPI: APIStatus
}

type ModelState = 'checking' | 'available' | 'partial' | 'unavailable' | 'downloading' | 'error'

interface DownloadProgress {
  promptAPI: number
  writerAPI: number
  rewriterAPI: number
  summarizationAPI: number
  translationAPI: number
  embeddingModel: number
}

export const ModelAvailabilityStep = () => {
  const { nextStep, prevStep, setModelAvailability } = useOnboarding()
  const [modelState, setModelState] = useState<ModelState>('checking')
  const [apiStatus, setApiStatus] = useState<APIAvailability>({
    promptAPI: 'checking',
    writerAPI: 'checking',
    rewriterAPI: 'checking',
    summarizationAPI: 'checking',
    translationAPI: 'checking'
  })
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>({
    promptAPI: 0,
    writerAPI: 0,
    rewriterAPI: 0,
    summarizationAPI: 0,
    translationAPI: 0,
    embeddingModel: 0
  })
  const [currentlyDownloading, setCurrentlyDownloading] = useState<string | null>(null)
  const [embeddingModelDownloaded, setEmbeddingModelDownloaded] = useState(false)

  useEffect(() => {
    // Wait a moment for window.ai to be available
    // Chrome AI APIs may not be immediately available when side panel opens
    const timer = setTimeout(() => {
      checkModelAvailability()
    }, 500)
    
    return () => clearTimeout(timer)
  }, [])

  const checkModelAvailability = async () => {
    setModelState('checking')
    setErrorMessage('')

    console.log('[Onboarding] ===== Starting API Availability Check =====')
    console.log('[Onboarding] Checking: window.LanguageModel, window.Writer, window.Rewriter, window.Summarizer, window.Translator')

    const newStatus: APIAvailability = {
      promptAPI: 'checking',
      writerAPI: 'checking',
      rewriterAPI: 'checking',
      summarizationAPI: 'checking',
      translationAPI: 'checking'
    }

    try {
      // Check Prompt API (required)
      console.log('[Onboarding] Checking Prompt API...')
      console.log('[Onboarding] window.LanguageModel exists:', 'LanguageModel' in window)
      
      if (!('LanguageModel' in window)) {
        console.error('[Onboarding] LanguageModel NOT FOUND')
        newStatus.promptAPI = 'unavailable'
        setErrorMessage('Prompt API is not available. Please enable it in Chrome flags.')
      } else {
        try {
          console.log('[Onboarding] Calling LanguageModel.availability()...')
          const availability = await (window as any).LanguageModel.availability()
          console.log('[Onboarding] Prompt API availability:', availability)
          console.log('[Onboarding] Availability type:', typeof availability)
          
          if (availability === 'no' || availability === 'unavailable') {
            console.log('[Onboarding] Prompt API unavailable')
            newStatus.promptAPI = 'unavailable'
          } else if (availability === 'after-download') {
            console.log('[Onboarding] Prompt API needs download')
            newStatus.promptAPI = 'after-download'
          } else if (availability === 'readily' || availability === 'available') {
            console.log('[Onboarding] Prompt API is available')
            newStatus.promptAPI = 'available'
          } else {
            console.warn('[Onboarding] Unknown Prompt API availability status:', availability)
            newStatus.promptAPI = 'unavailable'
          }
        } catch (error) {
          console.error('[Onboarding] Prompt API check exception:', error)
          newStatus.promptAPI = 'unavailable'
          setErrorMessage('Prompt API is not enabled. Please enable it in Chrome flags.')
        }
      }

      // Check Writer API (optional)
      console.log('[Onboarding] Checking Writer API...')
      console.log('[Onboarding] window.Writer exists:', 'Writer' in window)
      
      if (!('Writer' in window)) {
        console.log('[Onboarding] Writer API NOT FOUND')
        newStatus.writerAPI = 'unavailable'
      } else {
        try {
          const availability = await (window as any).Writer.availability()
          console.log('[Onboarding] Writer API availability:', availability)
          
          if (availability === 'no' || availability === 'unavailable') {
            newStatus.writerAPI = 'unavailable'
          } else if (availability === 'after-download') {
            newStatus.writerAPI = 'after-download'
          } else if (availability === 'readily' || availability === 'available') {
            newStatus.writerAPI = 'available'
          } else {
            newStatus.writerAPI = 'unavailable'
          }
        } catch (error) {
          console.error('[Onboarding] Writer API check failed:', error)
          newStatus.writerAPI = 'unavailable'
        }
      }

      // Check Rewriter API (optional)
      console.log('[Onboarding] Checking Rewriter API...')
      console.log('[Onboarding] window.Rewriter exists:', 'Rewriter' in window)
      
      if (!('Rewriter' in window)) {
        console.log('[Onboarding] Rewriter API NOT FOUND')
        newStatus.rewriterAPI = 'unavailable'
      } else {
        try {
          const availability = await (window as any).Rewriter.availability()
          console.log('[Onboarding] Rewriter API availability:', availability)
          
          if (availability === 'no' || availability === 'unavailable') {
            newStatus.rewriterAPI = 'unavailable'
          } else if (availability === 'after-download') {
            newStatus.rewriterAPI = 'after-download'
          } else if (availability === 'readily' || availability === 'available') {
            newStatus.rewriterAPI = 'available'
          } else {
            newStatus.rewriterAPI = 'unavailable'
          }
        } catch (error) {
          console.error('[Onboarding] Rewriter API check failed:', error)
          newStatus.rewriterAPI = 'unavailable'
        }
      }

      // Check Summarization API (optional)
      console.log('[Onboarding] Checking Summarization API...')
      console.log('[Onboarding] window.Summarizer exists:', 'Summarizer' in window)
      
      if (!('Summarizer' in window)) {
        console.log('[Onboarding] Summarization API NOT FOUND')
        newStatus.summarizationAPI = 'unavailable'
      } else {
        try {
          const availability = await (window as any).Summarizer.availability()
          console.log('[Onboarding] Summarization API availability:', availability)
          
          if (availability === 'no' || availability === 'unavailable') {
            newStatus.summarizationAPI = 'unavailable'
          } else if (availability === 'after-download') {
            newStatus.summarizationAPI = 'after-download'
          } else if (availability === 'readily' || availability === 'available') {
            newStatus.summarizationAPI = 'available'
          } else {
            newStatus.summarizationAPI = 'unavailable'
          }
        } catch (error) {
          console.error('[Onboarding] Summarization API check failed:', error)
          newStatus.summarizationAPI = 'unavailable'
        }
      }

      // Check Translation API (optional)
      console.log('[Onboarding] Checking Translation API...')
      console.log('[Onboarding] window.Translator exists:', 'Translator' in window)
      
      if (!('Translator' in window)) {
        console.log('[Onboarding] Translation API NOT FOUND')
        newStatus.translationAPI = 'unavailable'
      } else {
        try {
          // Check if translation API is available by testing availability
          const availability = await (window as any).Translator.availability({ 
            sourceLanguage: 'en', 
            targetLanguage: 'es' 
          })
          console.log('[Onboarding] Translation API availability:', availability)
          
          if (availability === 'no') {
            newStatus.translationAPI = 'unavailable'
          } else if (availability === 'downloadable') {
            newStatus.translationAPI = 'after-download'
          } else if (availability === 'available') {
            newStatus.translationAPI = 'available'
          } else {
            newStatus.translationAPI = 'unavailable'
          }
        } catch (error) {
          console.error('[Onboarding] Translation API check failed:', error)
          newStatus.translationAPI = 'unavailable'
        }
      }

      console.log('[Onboarding] Final API Status:', newStatus)
      setApiStatus(newStatus)

      // Determine overall state and trigger downloads if needed
      console.log('[Onboarding] Determining overall state...')
      if (newStatus.promptAPI === 'unavailable') {
        console.log('[Onboarding] Setting state to UNAVAILABLE')
        setModelState('unavailable')
        setErrorMessage('Prompt API is required but not available.')
        setModelAvailability(false)
      } else if (newStatus.promptAPI === 'after-download' || 
                 newStatus.writerAPI === 'after-download' || 
                 newStatus.rewriterAPI === 'after-download' ||
                 newStatus.summarizationAPI === 'after-download' ||
                 newStatus.translationAPI === 'after-download') {
        console.log('[Onboarding] Starting model downloads...')
        // Start downloading models (including embedding model)
        await downloadModels(newStatus)
      } else if (newStatus.promptAPI === 'available') {
        console.log('[Onboarding] Prompt API available, downloading embedding model...')
        // Set to downloading state so UI shows progress
        setModelState('downloading')
        // Download embedding model
        await downloadModels(newStatus)
      }
      
      console.log('[Onboarding] ===== API Check Complete =====')
    } catch (error: any) {
      console.error('[Onboarding] FATAL: Model availability check error:', error)
      console.error('[Onboarding] Error stack:', error.stack)
      setModelState('error')
      setErrorMessage(error.message || 'Failed to check model availability.')
      setModelAvailability(false)
    }
  }

  const downloadModels = async (status: APIAvailability) => {
    setModelState('downloading')
    setModelAvailability(false)
    
    const updatedStatus = { ...status }

    try {
      // Download Prompt API (required)
      if (status.promptAPI === 'after-download') {
        setCurrentlyDownloading('Prompt API')
        console.log('[Onboarding] Starting Prompt API download')
        
        const session = await (window as any).LanguageModel.create({
          monitor(m: any) {
            m.addEventListener('downloadprogress', (e: any) => {
              const progress = Math.round(e.loaded * 100)
              setDownloadProgress(prev => ({ ...prev, promptAPI: progress }))
              console.log(`[Onboarding] Prompt API downloading: ${progress}%`)
            })
          }
        })
        
        updatedStatus.promptAPI = 'available'
        setApiStatus(updatedStatus)
        session.destroy()
        console.log('[Onboarding] Prompt API download complete')
      }

      // Download Writer API (optional)
      if (status.writerAPI === 'after-download') {
        setCurrentlyDownloading('Writer API')
        console.log('[Onboarding] Starting Writer API download')
        
        try {
          const writer = await (window as any).Writer.create({
            monitor(m: any) {
              m.addEventListener('downloadprogress', (e: any) => {
                const progress = Math.round(e.loaded * 100)
                setDownloadProgress(prev => ({ ...prev, writerAPI: progress }))
                console.log(`[Onboarding] Writer API downloading: ${progress}%`)
              })
            }
          })
          
          updatedStatus.writerAPI = 'available'
          setApiStatus(updatedStatus)
          writer.destroy()
          console.log('[Onboarding] Writer API download complete')
        } catch (error) {
          console.error('[Onboarding] Writer API download failed:', error)
          // Optional API, continue anyway
        }
      }

      // Download Rewriter API (optional)
      if (status.rewriterAPI === 'after-download') {
        setCurrentlyDownloading('Rewriter API')
        console.log('[Onboarding] Starting Rewriter API download')
        
        try {
          const rewriter = await (window as any).Rewriter.create({
            monitor(m: any) {
              m.addEventListener('downloadprogress', (e: any) => {
                const progress = Math.round(e.loaded * 100)
                setDownloadProgress(prev => ({ ...prev, rewriterAPI: progress }))
                console.log(`[Onboarding] Rewriter API downloading: ${progress}%`)
              })
            }
          })
          
          updatedStatus.rewriterAPI = 'available'
          setApiStatus(updatedStatus)
          rewriter.destroy()
          console.log('[Onboarding] Rewriter API download complete')
        } catch (error) {
          console.error('[Onboarding] Rewriter API download failed:', error)
          // Optional API, continue anyway
        }
      }

      // Download Summarization API (optional)
      if (status.summarizationAPI === 'after-download') {
        setCurrentlyDownloading('Summarization API')
        console.log('[Onboarding] Starting Summarization API download')
        
        try {
          const summarizer = await (window as any).Summarizer.create({
            sharedContext: '',
            type: 'key-points',
            format: 'plain-text',
            length: 'medium',
            monitor(m: any) {
              m.addEventListener('downloadprogress', (e: any) => {
                const progress = Math.round(e.loaded * 100)
                setDownloadProgress(prev => ({ ...prev, summarizationAPI: progress }))
                console.log(`[Onboarding] Summarization API downloading: ${progress}%`)
              })
            }
          })
          
          updatedStatus.summarizationAPI = 'available'
          setApiStatus(updatedStatus)
          summarizer.destroy()
          console.log('[Onboarding] Summarization API download complete')
        } catch (error) {
          console.error('[Onboarding] Summarization API download failed:', error)
          // Optional API, continue anyway
        }
      }

      // Download Translation API (optional)
      if (status.translationAPI === 'after-download') {
        setCurrentlyDownloading('Translation API')
        console.log('[Onboarding] Starting Translation API download')
        
        try {
          const translator = await (window as any).Translator.create({
            sourceLanguage: 'en',
            targetLanguage: 'es',
            monitor(m: any) {
              m.addEventListener('downloadprogress', (e: any) => {
                const progress = Math.round(e.loaded * 100)
                setDownloadProgress(prev => ({ ...prev, translationAPI: progress }))
                console.log(`[Onboarding] Translation API downloading: ${progress}%`)
              })
            }
          })
          
          updatedStatus.translationAPI = 'available'
          setApiStatus(updatedStatus)
          translator.destroy?.()
          console.log('[Onboarding] Translation API download complete')
        } catch (error) {
          console.error('[Onboarding] Translation API download failed:', error)
          // Optional API, continue anyway
        }
      }

      // Download Embedding Model (for vault/memory features)
      setCurrentlyDownloading('Embedding Model')
      console.log('[Onboarding] Starting Embedding Model download')
      
      try {
        const { pipeline } = await import('@xenova/transformers')
        
        // Create a custom progress callback
        const progressCallback = (progress: any) => {
          if (progress.status === 'progress' && progress.progress) {
            const percent = Math.round(progress.progress)
            setDownloadProgress(prev => ({ ...prev, embeddingModel: percent }))
            console.log(`[Onboarding] Embedding Model downloading: ${percent}%`)
          }
        }
        
        // Load the embedding model
        const embedder = await pipeline(
          'feature-extraction',
          'Xenova/all-MiniLM-L6-v2',
          { progress_callback: progressCallback }
        )
        
        console.log('[Onboarding] Embedding Model download complete')
        setEmbeddingModelDownloaded(true)
        setDownloadProgress(prev => ({ ...prev, embeddingModel: 100 }))
      } catch (error) {
        console.error('[Onboarding] Embedding Model download failed:', error)
        // Non-critical, continue anyway
      }

      setCurrentlyDownloading(null)
      setModelState('available')
      setModelAvailability(true)
      
    } catch (error: any) {
      console.error('[Onboarding] Model download failed:', error)
      setCurrentlyDownloading(null)
      setModelState('error')
      setErrorMessage(`Failed to download models: ${error.message}`)
      setModelAvailability(false)
    }
  }

  const canProceed = modelState === 'available'

  return (
    <div className="flex flex-col items-center justify-center px-8 py-8">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <div className="flex justify-center mb-4">
            <div className={`p-4 rounded-full ${
              modelState === 'available' ? 'bg-green-500/10' :
              modelState === 'unavailable' || modelState === 'error' ? 'bg-red-500/10' :
              modelState === 'downloading' ? 'bg-blue-500/10' :
              'bg-gray-800'
            }`}>
              {modelState === 'checking' || modelState === 'downloading' ? (
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
              ) : (
                <Brain className={`w-8 h-8 ${
                  modelState === 'available' ? 'text-green-500' :
                  modelState === 'unavailable' || modelState === 'error' ? 'text-red-500' :
                  'text-gray-400'
                }`} />
              )}
            </div>
          </div>
          
          <h2 className="text-2xl font-bold">AI Model Setup</h2>
          <p className="text-gray-400 text-sm">
            Marionette uses Chrome's built-in Gemini Nano for on-device AI processing.
          </p>
          <button
            onClick={openChromeAIDocs}
            className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1 mx-auto"
          >
            Requires latest Chrome version
            <ExternalLink className="w-3 h-3" />
          </button>
        </div>

        <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6 space-y-4">
          {modelState === 'checking' && (
            <div className="text-center py-3">
              <div className="text-sm text-gray-400 animate-pulse">Checking APIs...</div>
            </div>
          )}

          {modelState === 'downloading' && (
            <div className="space-y-4">
              <div className="text-sm text-blue-400 text-center">
                Downloading models... This may take a few minutes.
              </div>
              
              {/* Prompt API Download */}
              {(apiStatus.promptAPI === 'after-download' || downloadProgress.promptAPI > 0) && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-300">Prompt API</span>
                    <span className={`${currentlyDownloading === 'Prompt API' ? 'text-blue-400' : 'text-gray-500'}`}>
                      {apiStatus.promptAPI === 'available' ? 'Complete' : `${downloadProgress.promptAPI}%`}
                    </span>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-300 ${
                        apiStatus.promptAPI === 'available' ? 'bg-green-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${apiStatus.promptAPI === 'available' ? 100 : downloadProgress.promptAPI}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Writer API Download */}
              {(apiStatus.writerAPI === 'after-download' || downloadProgress.writerAPI > 0) && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-300">Writer API</span>
                    <span className={`${currentlyDownloading === 'Writer API' ? 'text-blue-400' : 'text-gray-500'}`}>
                      {apiStatus.writerAPI === 'available' ? 'Complete' : `${downloadProgress.writerAPI}%`}
                    </span>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-300 ${
                        apiStatus.writerAPI === 'available' ? 'bg-green-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${apiStatus.writerAPI === 'available' ? 100 : downloadProgress.writerAPI}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Rewriter API Download */}
              {(apiStatus.rewriterAPI === 'after-download' || downloadProgress.rewriterAPI > 0) && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-300">Rewriter API</span>
                    <span className={`${currentlyDownloading === 'Rewriter API' ? 'text-blue-400' : 'text-gray-500'}`}>
                      {apiStatus.rewriterAPI === 'available' ? 'Complete' : `${downloadProgress.rewriterAPI}%`}
                    </span>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-300 ${
                        apiStatus.rewriterAPI === 'available' ? 'bg-green-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${apiStatus.rewriterAPI === 'available' ? 100 : downloadProgress.rewriterAPI}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Summarization API Download */}
              {(apiStatus.summarizationAPI === 'after-download' || downloadProgress.summarizationAPI > 0) && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-300">Summarization API</span>
                    <span className={`${currentlyDownloading === 'Summarization API' ? 'text-blue-400' : 'text-gray-500'}`}>
                      {apiStatus.summarizationAPI === 'available' ? 'Complete' : `${downloadProgress.summarizationAPI}%`}
                    </span>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-300 ${
                        apiStatus.summarizationAPI === 'available' ? 'bg-green-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${apiStatus.summarizationAPI === 'available' ? 100 : downloadProgress.summarizationAPI}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Translation API Download */}
              {(apiStatus.translationAPI === 'after-download' || downloadProgress.translationAPI > 0) && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-300">Translation API</span>
                    <span className={`${currentlyDownloading === 'Translation API' ? 'text-blue-400' : 'text-gray-500'}`}>
                      {apiStatus.translationAPI === 'available' ? 'Complete' : `${downloadProgress.translationAPI}%`}
                    </span>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-300 ${
                        apiStatus.translationAPI === 'available' ? 'bg-green-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${apiStatus.translationAPI === 'available' ? 100 : downloadProgress.translationAPI}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Embedding Model Download */}
              {(currentlyDownloading === 'Embedding Model' || downloadProgress.embeddingModel > 0) && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-300">Embedding Model</span>
                    <span className={`${currentlyDownloading === 'Embedding Model' ? 'text-blue-400' : 'text-gray-500'}`}>
                      {embeddingModelDownloaded ? 'Complete' : `${downloadProgress.embeddingModel}%`}
                    </span>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-300 ${
                        embeddingModelDownloaded ? 'bg-green-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${embeddingModelDownloaded ? 100 : downloadProgress.embeddingModel}%` }}
                    />
                  </div>
                </div>
              )}

              {currentlyDownloading && (
                <div className="text-[10px] text-gray-500 text-center animate-pulse">
                  Downloading {currentlyDownloading}...
                </div>
              )}
            </div>
          )}

          {(modelState === 'available' || modelState === 'partial') && (
            <div className="space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">Prompt API (Required)</span>
                  <span className={`flex items-center gap-1 ${
                    apiStatus.promptAPI === 'available' ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {apiStatus.promptAPI === 'available' ? (
                      <><CheckCircle className="w-3 h-3" /> Available</>
                    ) : (
                      <><AlertCircle className="w-3 h-3" /> Unavailable</>
                    )}
                  </span>
                </div>
                
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">Writer API (Optional)</span>
                  <span className={`flex items-center gap-1 ${
                    apiStatus.writerAPI === 'available' ? 'text-green-400' : 
                    apiStatus.writerAPI === 'after-download' ? 'text-yellow-400' :
                    'text-gray-500'
                  }`}>
                    {apiStatus.writerAPI === 'available' ? (
                      <><CheckCircle className="w-3 h-3" /> Available</>
                    ) : apiStatus.writerAPI === 'after-download' ? (
                      <><AlertCircle className="w-3 h-3" /> Needs Download</>
                    ) : (
                      <><AlertCircle className="w-3 h-3" /> Unavailable</>
                    )}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">Rewriter API (Optional)</span>
                  <span className={`flex items-center gap-1 ${
                    apiStatus.rewriterAPI === 'available' ? 'text-green-400' : 
                    apiStatus.rewriterAPI === 'after-download' ? 'text-yellow-400' :
                    'text-gray-500'
                  }`}>
                    {apiStatus.rewriterAPI === 'available' ? (
                      <><CheckCircle className="w-3 h-3" /> Available</>
                    ) : apiStatus.rewriterAPI === 'after-download' ? (
                      <><AlertCircle className="w-3 h-3" /> Needs Download</>
                    ) : (
                      <><AlertCircle className="w-3 h-3" /> Unavailable</>
                    )}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">Summarization API (Optional)</span>
                  <span className={`flex items-center gap-1 ${
                    apiStatus.summarizationAPI === 'available' ? 'text-green-400' : 
                    apiStatus.summarizationAPI === 'after-download' ? 'text-yellow-400' :
                    'text-gray-500'
                  }`}>
                    {apiStatus.summarizationAPI === 'available' ? (
                      <><CheckCircle className="w-3 h-3" /> Available</>
                    ) : apiStatus.summarizationAPI === 'after-download' ? (
                      <><AlertCircle className="w-3 h-3" /> Needs Download</>
                    ) : (
                      <><AlertCircle className="w-3 h-3" /> Unavailable</>
                    )}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">Translation API (Optional)</span>
                  <span className={`flex items-center gap-1 ${
                    apiStatus.translationAPI === 'available' ? 'text-green-400' : 
                    apiStatus.translationAPI === 'after-download' ? 'text-yellow-400' :
                    'text-gray-500'
                  }`}>
                    {apiStatus.translationAPI === 'available' ? (
                      <><CheckCircle className="w-3 h-3" /> Available</>
                    ) : apiStatus.translationAPI === 'after-download' ? (
                      <><AlertCircle className="w-3 h-3" /> Needs Download</>
                    ) : (
                      <><AlertCircle className="w-3 h-3" /> Unavailable</>
                    )}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">Embedding Model (Required)</span>
                  <span className={`flex items-center gap-1 ${
                    embeddingModelDownloaded ? 'text-green-400' : 'text-yellow-400'
                  }`}>
                    {embeddingModelDownloaded ? (
                      <><CheckCircle className="w-3 h-3" /> Downloaded</>
                    ) : (
                      <><AlertCircle className="w-3 h-3" /> Downloading</>
                    )}
                  </span>
                </div>
              </div>

              {/* Show enable buttons for unavailable optional APIs */}
              {(apiStatus.writerAPI === 'unavailable' || apiStatus.rewriterAPI === 'unavailable' || apiStatus.summarizationAPI === 'unavailable' || apiStatus.translationAPI === 'unavailable') && (
                <div className="pt-2 space-y-2">
                  <div className="text-[10px] text-gray-400">
                    Enable optional APIs for enhanced features:
                  </div>
                  
                  {apiStatus.writerAPI === 'unavailable' && (
                    <div className="bg-gray-800/50 rounded-lg p-2 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-300 font-medium">Writer API</span>
                        <button
                          onClick={openWriterAPIFlagsPage}
                          className="px-2 py-1 bg-blue-900 hover:bg-blue-800 text-white rounded text-[10px] transition-colors"
                        >
                          Enable
                        </button>
                      </div>
                      <p className="text-[9px] text-gray-500">
                        Provides content generation and writing assistance
                      </p>
                    </div>
                  )}

                  {apiStatus.rewriterAPI === 'unavailable' && (
                    <div className="bg-gray-800/50 rounded-lg p-2 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-300 font-medium">Rewriter API</span>
                        <button
                          onClick={openRewriterAPIFlagsPage}
                          className="px-2 py-1 bg-blue-900 hover:bg-blue-800 text-white rounded text-[10px] transition-colors"
                        >
                          Enable
                        </button>
                      </div>
                      <p className="text-[9px] text-gray-500">
                        Provides text rewriting and editing assistance
                      </p>
                    </div>
                  )}

                  {apiStatus.summarizationAPI === 'unavailable' && (
                    <div className="bg-gray-800/50 rounded-lg p-2 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-300 font-medium">Summarization API</span>
                        <button
                          onClick={openSummarizationAPIFlagsPage}
                          className="px-2 py-1 bg-blue-900 hover:bg-blue-800 text-white rounded text-[10px] transition-colors"
                        >
                          Enable
                        </button>
                      </div>
                      <p className="text-[9px] text-gray-500">
                        Provides text summarization capabilities
                      </p>
                    </div>
                  )}

                  {apiStatus.translationAPI === 'unavailable' && (
                    <div className="bg-gray-800/50 rounded-lg p-2 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-300 font-medium">Translation API</span>
                        <button
                          onClick={openTranslatorAPIFlagsPage}
                          className="px-2 py-1 bg-blue-900 hover:bg-blue-800 text-white rounded text-[10px] transition-colors"
                        >
                          Enable
                        </button>
                      </div>
                      <p className="text-[9px] text-gray-500">
                        Provides on-device language translation
                      </p>
                    </div>
                  )}

                  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-2 mt-2">
                    <p className="text-[10px] text-yellow-400">
                      After enabling any API, you must relaunch Chrome for changes to take effect.
                    </p>
                  </div>
                </div>
              )}

              {apiStatus.writerAPI === 'available' && apiStatus.summarizationAPI === 'available' && apiStatus.translationAPI === 'available' && (
                <div className="pt-2 text-xs text-gray-500">
                  <p>All APIs ready. Processing happens locally on your device.</p>
                </div>
              )}
            </div>
          )}

          {(modelState === 'unavailable' || modelState === 'error') && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 text-red-400">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div className="text-sm">{errorMessage}</div>
              </div>

              <div className="space-y-2 pt-2">
                <div className="text-xs text-gray-400 space-y-1">
                  <p className="font-semibold">Required Setup:</p>
                  <ol className="list-decimal list-inside space-y-1 ml-2">
                    <li>Ensure you have the latest Chrome version</li>
                    <li>Open chrome://flags and enable the APIs below</li>
                    <li>Restart Chrome completely</li>
                  </ol>
                </div>

                <div className="flex gap-2 mt-3">
                  <button
                    onClick={openAIFlagsPage}
                    className="flex-1 bg-gray-800 text-white px-3 py-2 rounded-lg text-xs hover:bg-gray-700 transition-colors"
                  >
                    Prompt API
                  </button>
                  <button
                    onClick={openWriterAPIFlagsPage}
                    className="flex-1 bg-gray-800 text-white px-3 py-2 rounded-lg text-xs hover:bg-gray-700 transition-colors"
                  >
                    Writer API
                  </button>
                  <button
                    onClick={openSummarizationAPIFlagsPage}
                    className="flex-1 bg-gray-800 text-white px-3 py-2 rounded-lg text-xs hover:bg-gray-700 transition-colors"
                  >
                    Summarizer
                  </button>
                </div>
                
                <button
                  onClick={openTranslatorAPIFlagsPage}
                  className="w-full bg-gray-800 text-white px-3 py-2 rounded-lg text-xs hover:bg-gray-700 transition-colors"
                >
                  Translation API
                </button>
                
                <button
                  onClick={checkModelAvailability}
                  className="w-full bg-transparent border border-gray-700 text-white px-4 py-2 rounded-lg text-xs hover:bg-gray-800 transition-colors mt-2"
                >
                  Check Again
                </button>

                <button
                  onClick={openChromeAIDocs}
                  className="w-full text-[10px] text-blue-400 hover:text-blue-300 flex items-center justify-center gap-1 mt-2"
                >
                  View Chrome AI Documentation
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-4">
          <button
            onClick={prevStep}
            className="flex-1 bg-gray-800 text-white px-6 py-3 rounded-lg font-medium text-sm hover:bg-gray-700 transition-colors flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <button
            onClick={nextStep}
            disabled={!canProceed}
            className="flex-1 bg-white text-black px-6 py-3 rounded-lg font-medium text-sm hover:bg-gray-100 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white"
          >
            Continue
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

