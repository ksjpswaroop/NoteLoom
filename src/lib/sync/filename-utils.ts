/**
 * ，
 * Windows : < > : " | ? * 
 * 
 */
export function sanitizeFileName(fileName: string): string {
  // Windows
  const windowsInvalidChars = /[<>:"|?*]/g
  
  //
  let sanitized = fileName.replace(windowsInvalidChars, '_')
  
  //
  sanitized = sanitized
    .replace(/\r\n/g, '_') //
    .replace(/\n/g, '_')    //
    .replace(/\r/g, '_')    //
    .replace(/\t/g, '_')    //
    .replace(/\0/g, '_')    //
    .replace(/[\u0000-\u001F]/g, '_') //
    .trim() //
  
  // （）
  if (sanitized.startsWith('.')) {
    sanitized = '_' + sanitized.slice(1)
  }
  
  //
  if (!sanitized) {
    sanitized = 'untitled'
  }
  
  // （Windows 255 ）
  const maxLength = 250 //
  if (sanitized.length > maxLength) {
    const extension = sanitized.includes('.') ? sanitized.split('.').pop() : ''
    const nameWithoutExt = sanitized.includes('.') ? 
      sanitized.slice(0, -(extension!.length + 1)) : sanitized
    
    const maxNameLength = maxLength - (extension ? extension.length + 1 : 0)
    const truncatedName = nameWithoutExt.slice(0, maxNameLength)
    
    sanitized = extension ? `${truncatedName}.${extension}` : truncatedName
  }
  
  return sanitized
}

/**
 * 
 */
export function sanitizeFilePath(filePath: string): string {
  //
  const parts = filePath.split('/')
  
  // （）
  const sanitizedParts = parts.map(part => {
    if (part === '') return part
    return sanitizeFileName(part)
  })
  
  return sanitizedParts.join('/')
}

/**
 * 
 */
export function hasInvalidFileNameChars(fileName: string): boolean {
  const windowsInvalidChars = /[<>:"|?*]/
  return windowsInvalidChars.test(fileName) ||
         fileName.includes('\r') ||
         fileName.includes('\n') ||
         fileName.includes('\t') ||
         fileName.includes('\0')
}

/**
 * ，
 */
export function getSafeFileName(originalFileName: string): string {
  if (!hasInvalidFileNameChars(originalFileName)) {
    return originalFileName
  }
  
  const safeFileName = sanitizeFileName(originalFileName)

  return safeFileName
}
