// Original sentence parser - checks for complete sentences only
const isCompleteSentence = (s: string): boolean => {
  const t = s.trim()
  if (!t) return false
  // Never treat ellipses as end of sentence in streaming
  if (/\.\.\.$/.test(t)) return false
  if (/[!?]"?$/.test(t)) return true
  // For a trailing period, require whitespace or start before the last token
  return /(?:^|\s)\S+\."?$/.test(t)
}

export function splitIntoSentences(text: string): string[] {
  // Split by newlines first (preserves numbers like 258.93)
  const lines = text.split(/\n+/).filter(line => line.trim().length > 0)
  
  // If we have multiple lines, treat only complete lines as sentences
  if (lines.length > 1) {
    const completeLines = lines.filter(line => isCompleteSentence(line))
    return completeLines.map(line => line.trim())
  }
  
  // If single line, then split by sentence endings
  // But be smarter about it - avoid splitting on:
  // - Numbers: "1. ", "2. ", etc.
  // - Letters: "a. ", "b. ", etc.
  // - Common abbreviations: "e.g. ", "i.e. ", "etc. ", "vs. ", "Dr. ", "Mr. ", "Mrs. ", "Ms. "
  const sentences: string[] = []
  
  // Split but preserve the delimiter
  const parts = text.split(/([.!?])\s+/)
  
  let current = ''
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    current += part
    
    // Check if this is a sentence boundary (punctuation followed by space)
    if (i < parts.length - 1 && /[.!?]$/.test(part)) {
      const beforePunctuation = current.slice(0, -1).trim()
      const nextPart = parts[i + 1] || ''
      
      // Don't split on list items (single digit/letter followed by period)
      if (/^[0-9a-z]$/i.test(beforePunctuation.split(/\s+/).pop() || '')) {
        continue
      }
      
      // Don't split on common abbreviations
      if (/(e\.g|i\.e|etc|vs|dr|mr|mrs|ms)$/i.test(beforePunctuation)) {
        continue
      }
      
      // This is a real sentence boundary
      sentences.push(current.trim())
      current = ''
    }
  }
  
  // Do NOT queue trailing incomplete fragments – only keep if it ends with punctuation
  if (current.trim() && isCompleteSentence(current)) {
    sentences.push(current.trim())
  }
  
  return sentences.filter(s => s.length > 0)
}

export function getCompleteSentences(text: string): string {
  const sentences = splitIntoSentences(text)
  return sentences.join(' ')
}

