import * as pdfjsLib from 'pdfjs-dist'
import { readFile } from '@tauri-apps/plugin-fs'
import { recognizeImageBlob } from '@/lib/ocr'

// PDF.js worker
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`
}

// ： TextItem
function isTextItem(item: any): item is { str: string; transform: number[] } {
  return item && typeof item.str === 'string' && Array.isArray(item.transform)
}

/**
 * OCR PDF （ PDF）
 */
async function ocrPage(canvas: HTMLCanvasElement, pageNum: number): Promise<string> {
  try {
    // canvas
    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b!), 'image/png')
    })

    return await recognizeImageBlob(blob)
  } catch (error) {
    console.error(`OCR failed for page ${pageNum}:`, error)
    return ''
  }
}

/**
 * PDF （Tauri ）
 * @param filePath PDF 
 * @param onProgress 
 * @returns 
 */
export async function extractTextFromPDF(
  filePath: string,
  onProgress?: (progress: string) => void
): Promise<string> {
  try {
    // Tauri readFile Uint8Array
    const fileData = await readFile(filePath)

    // PDF （ Uint8Array）
    const loadingTask = pdfjsLib.getDocument({ data: fileData })
    const pdfDocument = await loadingTask.promise

    onProgress?.(`PDF (${pdfDocument.numPages} )`)

    let fullText = ''
    let needsOCR = false

    //
    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum)
      const textContent = await page.getTextContent()

      const textItems = textContent.items

      if (textItems.length === 0) {
        needsOCR = true
        break
      }

      // （）
      const hasRealText = textItems.some((item: any) =>
        isTextItem(item) && item.str.trim().length > 0
      )

      if (!hasRealText) {
        needsOCR = true
        break
      }
    }

    // OCR， OCR
    if (needsOCR) {
      onProgress?.('OCR')
      return await extractTextWithOCR(pdfDocument, onProgress)
    }

    //
    onProgress?.('Extracting text...')
    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum)
      const textContent = await page.getTextContent()

      const textItems = textContent.items

      //
      const textByLine = new Map<number, any[]>()

      for (const item of textItems) {
        if (!isTextItem(item)) continue

        const y = Math.round(item.transform[5])
        if (!textByLine.has(y)) {
          textByLine.set(y, [])
        }
        textByLine.get(y)!.push(item)
      }

      const sortedY = Array.from(textByLine.keys()).sort((a, b) => b - a)

      for (const y of sortedY) {
        const lineItems = textByLine.get(y)!
        lineItems.sort((a, b) => a.transform[4] - b.transform[4])

        const lineText = lineItems
          .map((item: any) => item.str)
          .join('')
          .trim()

        if (lineText) {
          fullText += lineText + '\n'
        }
      }

      fullText += '\n'
      onProgress?.(`Text (${pageNum}/${pdfDocument.numPages})`)
    }

    const result = fullText.trim()
    return result
  } catch (error) {
    console.error('PDF text extraction error:', error)
    throw new Error('Failed to extract text from PDF')
  }
}

/**
 * OCR PDF （ PDF）
 */
async function extractTextWithOCR(
  pdfDocument: pdfjsLib.PDFDocumentProxy,
  onProgress?: (progress: string) => void
): Promise<string> {
  let fullText = ''

  for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
    onProgress?.(`OCR (${pageNum}/${pdfDocument.numPages})`)

    const page = await pdfDocument.getPage(pageNum)
    const viewport = page.getViewport({ scale: 2.0 }) // OCR

    // canvas
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')!
    canvas.height = viewport.height
    canvas.width = viewport.width

    // PDF canvas
    await page.render({
      canvasContext: context,
      viewport: viewport
    }).promise

    // OCR
    const pageText = await ocrPage(canvas, pageNum)
    if (pageText.trim()) {
      fullText += pageText.trim() + '\n\n'
    }
  }

  const result = fullText.trim()
  return result
}

/**
 * PDF （）
 * @param file PDF 
 * @returns 
 */
export async function extractTextFromPDFFile(file: File): Promise<string> {
  try {
    const arrayBuffer = await file.arrayBuffer()

    // PDF
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
    const pdfDocument = await loadingTask.promise

    let fullText = ''

    //
    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum)
      const textContent = await page.getTextContent()

      //
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ')

      fullText += pageText + '\n\n'
    }

    return fullText.trim()
  } catch (error) {
    console.error('PDF text extraction error:', error)
    throw new Error('Failed to extract text from PDF')
  }
}

/**
 * PDF 
 * @param filePath PDF 
 * @returns PDF （）
 */
export async function getPDFInfo(filePath: string): Promise<{ numPages: number }> {
  try {
    const response = await fetch(filePath)
    const arrayBuffer = await response.arrayBuffer()

    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
    const pdfDocument = await loadingTask.promise

    return {
      numPages: pdfDocument.numPages
    }
  } catch (error) {
    console.error('PDF info extraction error:', error)
    throw new Error('Failed to get PDF info')
  }
}

/**
 * PDF 
 * @param file PDF 
 * @returns PDF （）
 */
export async function getPDFInfoFromFile(file: File): Promise<{ numPages: number }> {
  try {
    const arrayBuffer = await file.arrayBuffer()

    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
    const pdfDocument = await loadingTask.promise

    return {
      numPages: pdfDocument.numPages
    }
  } catch (error) {
    console.error('PDF info extraction error:', error)
    throw new Error('Failed to get PDF info')
  }
}
