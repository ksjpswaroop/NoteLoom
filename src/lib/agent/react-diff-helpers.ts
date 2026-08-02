/**
 * 
 * 
 */
export function replaceLinesInRange(
  content: string,
  startLine: number,
  endLine: number,
  newLines: string[]
): string {
  const lines = content.split('\n')

  // ： startLine > endLine，
  let actualStartLine = startLine
  let actualEndLine = endLine
  if (startLine > endLine) {
    actualStartLine = endLine
    actualEndLine = startLine
  }

  // （ 0 ）
  const startIndex = actualStartLine - 1
  const endIndex = actualEndLine - 1

  //
  if (startIndex < 0 || endIndex >= lines.length) {
    throw new Error(`Invalid line range: ${startLine}-${endLine}; file has ${lines.length} lines`)
  }

  //
  const before = lines.slice(0, startIndex)
  const after = lines.slice(endIndex + 1)
  return [...before, ...newLines, ...after].join('\n')
}

/**
 * （）
 * 
 */
export function searchReplaceContent(
  content: string,
  searchPattern: string,
  replacement: string,
  useRegex: boolean,
  caseSensitive: boolean,
  replaceAll: boolean
): string {
  try {
    let pattern = searchPattern
    const flags = caseSensitive ? 'g' : 'gi'

    if (!useRegex) {
      // ，
      pattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }

    const regex = new RegExp(pattern, replaceAll ? flags : flags.replace('g', ''))

    return content.replace(regex, replacement)
  } catch (error) {
    throw new Error(`Search and replace failed: ${error}`)
  }
}

/**
 * 
 * 
 */
export function insertLinesAtPosition(
  content: string,
  afterLine: number,
  newLines: string[]
): string {
  const lines = content.split('\n')

  //
  if (afterLine < 0 || afterLine > lines.length) {
    throw new Error(`Invalid line number: ${afterLine}; file has ${lines.length} lines`)
  }

  //
  const before = lines.slice(0, afterLine)
  const after = lines.slice(afterLine)

  return [...before, ...newLines, ...after].join('\n')
}

/**
 * 
 * 
 */
export function deleteLinesInRange(
  content: string,
  startLine: number,
  endLine: number
): string {
  const lines = content.split('\n')

  // ： startLine > endLine，
  let actualStartLine = startLine
  let actualEndLine = endLine
  if (startLine > endLine) {
    actualStartLine = endLine
    actualEndLine = startLine
  }

  // （ 0 ）
  const startIndex = actualStartLine - 1
  const endIndex = actualEndLine - 1

  //
  if (startIndex < 0 || endIndex >= lines.length) {
    throw new Error(`Invalid line range: ${startLine}-${endLine}; file has ${lines.length} lines`)
  }

  //
  const before = lines.slice(0, startIndex)
  const after = lines.slice(endIndex + 1)

  return [...before, ...after].join('\n')
}
