export interface SearchMatch {
  text: string
  index: number
  length: number
  isExact: boolean
}

export interface SearchableItem {
  id: string
  title: string
  content: string
  metadata?: Record<string, any>
}

export interface SearchResult<T = any> {
  item: T
  matches: SearchMatch[]
  score: number
  highlightText: string
  matchType: 'exact' | 'fuzzy'
}

/**
 * 
 */
function findExactMatches(text: string, query: string): SearchMatch[] {
  const matches: SearchMatch[] = []
  const searchText = text.toLowerCase()
  const searchQuery = query.toLowerCase().trim()
  
  if (!searchQuery) return matches
  
  let index = 0
  while (index < searchText.length) {
    const foundIndex = searchText.indexOf(searchQuery, index)
    if (foundIndex === -1) break
    
    matches.push({
      text: text.substring(foundIndex, foundIndex + searchQuery.length),
      index: foundIndex,
      length: searchQuery.length,
      isExact: true
    })
    
    index = foundIndex + 1
  }
  
  return matches
}

/**
 * （）
 */
function findFuzzyMatches(text: string, query: string): SearchMatch[] {
  const matches: SearchMatch[] = []
  const searchText = text.toLowerCase()
  const searchQuery = query.toLowerCase().trim()
  
  if (!searchQuery || searchQuery.length < 2) return matches
  
  //
  const queryChars = searchQuery.split('')
  
  //
  //
  const words = text.split(/[\s\n,.，。、；;！!？?()（）\[\]【】]+/).filter(w => w.length > 0)
  
  for (const word of words) {
    const wordLower = word.toLowerCase()
    
    //
    let matchCount = 0
    for (const char of queryChars) {
      if (wordLower.includes(char)) {
        matchCount++
      }
    }
    
    // ，
    const matchRatio = matchCount / queryChars.length
    if (matchRatio >= 0.5 && word.length >= 2) {
      const wordIndex = searchText.indexOf(wordLower)
      if (wordIndex !== -1) {
        matches.push({
          text: text.substring(wordIndex, wordIndex + word.length),
          index: wordIndex,
          length: word.length,
          isExact: false
        })
      }
    }
  }
  
  return matches
}

/**
 * 
 */
function calculateScore(
  contentMatches: SearchMatch[],
  titleMatches: SearchMatch[],
  matchType: 'exact' | 'fuzzy'
): number {
  let score = 0
  
  //
  const baseScore = matchType === 'exact' ? 100 : 50
  
  // 3x
  score += titleMatches.length * baseScore * 3
  
  // 1x
  score += contentMatches.length * baseScore
  
  //
  score += (contentMatches.length + titleMatches.length) * 5
  
  return score
}

/**
 * 
 */
function generateHighlight(text: string, matches: SearchMatch[], maxLength: number = 200): string {
  if (matches.length === 0) {
    return text.substring(0, maxLength)
  }
  
  //
  const firstMatch = matches[0]
  const start = Math.max(0, firstMatch.index - 50)
  const end = Math.min(text.length, firstMatch.index + maxLength)
  
  let snippet = text.substring(start, end)
  
  if (start > 0) snippet = '...' + snippet
  if (end < text.length) snippet = snippet + '...'
  
  return snippet
}

/**
 * （）
 */
export function search<T extends SearchableItem>(
  items: T[],
  query: string,
  options: { maxResults?: number } = {}
): SearchResult<T>[] {
  if (!query.trim()) return []
  
  const { maxResults = 100 } = options
  const exactResults: SearchResult<T>[] = []
  const fuzzyResults: SearchResult<T>[] = []
  
  for (const item of items) {
    //
    const exactTitleMatches = findExactMatches(item.title, query)
    const exactContentMatches = findExactMatches(item.content, query)
    
    if (exactTitleMatches.length > 0 || exactContentMatches.length > 0) {
      const score = calculateScore(exactContentMatches, exactTitleMatches, 'exact')
      const highlightText = generateHighlight(item.content, exactContentMatches)
      
      exactResults.push({
        item,
        matches: [...exactTitleMatches, ...exactContentMatches],
        score,
        highlightText,
        matchType: 'exact'
      })
    } else {
      //
      const fuzzyTitleMatches = findFuzzyMatches(item.title, query)
      const fuzzyContentMatches = findFuzzyMatches(item.content, query)
      
      if (fuzzyTitleMatches.length > 0 || fuzzyContentMatches.length > 0) {
        const score = calculateScore(fuzzyContentMatches, fuzzyTitleMatches, 'fuzzy')
        const highlightText = generateHighlight(item.content, fuzzyContentMatches)
        
        fuzzyResults.push({
          item,
          matches: [...fuzzyTitleMatches, ...fuzzyContentMatches],
          score,
          highlightText,
          matchType: 'fuzzy'
        })
      }
    }
  }
  
  //
  exactResults.sort((a, b) => b.score - a.score)
  
  //
  fuzzyResults.sort((a, b) => b.score - a.score)
  
  // ：，
  const allResults = [...exactResults, ...fuzzyResults]
  
  //
  return allResults.slice(0, maxResults)
}
