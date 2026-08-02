const SHAPE_TYPES = new Set([
  'rectangle',
  'ellipse',
  'diamond',
  'text',
  'arrow',
  'line',
  'freedraw',
  'frame',
])

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asNonEmptyString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Normalize LLM-friendly element payloads into Excalidraw skeletons
 * accepted by convertToExcalidrawElements.
 */
export function normalizeExcalidrawSkeletons(rawElements: unknown[]): {
  skeletons: Record<string, unknown>[]
  error?: string
} {
  const skeletons: Record<string, unknown>[] = []

  for (const [index, raw] of rawElements.entries()) {
    const item = `elements[${index}]`
    const element = asRecord(raw)
    const type = asNonEmptyString(element.type)
    if (!type || !SHAPE_TYPES.has(type)) {
      return {
        skeletons: [],
        error: `${item}.type must be one of ${[...SHAPE_TYPES].join(', ')}.`,
      }
    }
    if (!isFiniteNumber(element.x) || !isFiniteNumber(element.y)) {
      return {
        skeletons: [],
        error: `${item} requires finite x and y.`,
      }
    }

    if (type === 'text') {
      const text = asNonEmptyString(element.text) || asNonEmptyString(element.label)
      if (!text) {
        return { skeletons: [], error: `${item} text requires a non-empty text or label.` }
      }
      skeletons.push({
        type: 'text',
        id: asNonEmptyString(element.id) || undefined,
        x: element.x,
        y: element.y,
        text,
        fontSize: isFiniteNumber(element.fontSize) ? element.fontSize : undefined,
        strokeColor: asNonEmptyString(element.strokeColor) || undefined,
        backgroundColor: asNonEmptyString(element.backgroundColor) || undefined,
        width: isFiniteNumber(element.width) ? element.width : undefined,
        height: isFiniteNumber(element.height) ? element.height : undefined,
      })
      continue
    }

    if (type === 'arrow' || type === 'line') {
      const start = asRecord(element.start)
      const end = asRecord(element.end)
      const labelText = asNonEmptyString(asRecord(element.label).text) || asNonEmptyString(element.label)
      skeletons.push({
        type,
        id: asNonEmptyString(element.id) || undefined,
        x: element.x,
        y: element.y,
        width: isFiniteNumber(element.width) ? element.width : undefined,
        height: isFiniteNumber(element.height) ? element.height : undefined,
        strokeColor: asNonEmptyString(element.strokeColor) || undefined,
        backgroundColor: asNonEmptyString(element.backgroundColor) || undefined,
        points: Array.isArray(element.points) ? element.points : undefined,
        start: Object.keys(start).length > 0
          ? {
              id: asNonEmptyString(start.id) || undefined,
              type: asNonEmptyString(start.type) || undefined,
              x: isFiniteNumber(start.x) ? start.x : undefined,
              y: isFiniteNumber(start.y) ? start.y : undefined,
              text: asNonEmptyString(start.text) || undefined,
            }
          : undefined,
        end: Object.keys(end).length > 0
          ? {
              id: asNonEmptyString(end.id) || undefined,
              type: asNonEmptyString(end.type) || undefined,
              x: isFiniteNumber(end.x) ? end.x : undefined,
              y: isFiniteNumber(end.y) ? end.y : undefined,
              text: asNonEmptyString(end.text) || undefined,
            }
          : undefined,
        label: labelText ? { text: labelText } : undefined,
      })
      continue
    }

    if (type === 'frame') {
      const children = Array.isArray(element.children)
        ? element.children.filter((child): child is string => typeof child === 'string' && child.trim().length > 0)
        : []
      skeletons.push({
        type: 'frame',
        id: asNonEmptyString(element.id) || undefined,
        x: element.x,
        y: element.y,
        width: isFiniteNumber(element.width) ? element.width : undefined,
        height: isFiniteNumber(element.height) ? element.height : undefined,
        name: asNonEmptyString(element.name) || asNonEmptyString(element.label) || undefined,
        children,
      })
      continue
    }

    const labelText = asNonEmptyString(asRecord(element.label).text)
      || asNonEmptyString(element.label)
      || asNonEmptyString(element.text)
    skeletons.push({
      type,
      id: asNonEmptyString(element.id) || undefined,
      x: element.x,
      y: element.y,
      width: isFiniteNumber(element.width) ? element.width : 160,
      height: isFiniteNumber(element.height) ? element.height : 80,
      strokeColor: asNonEmptyString(element.strokeColor) || '#1e1e1e',
      backgroundColor: asNonEmptyString(element.backgroundColor) || '#a5d8ff',
      label: labelText ? { text: labelText } : undefined,
    })
  }

  return { skeletons }
}

export async function convertSkeletonsToElements(rawElements: unknown[]) {
  const { skeletons, error } = normalizeExcalidrawSkeletons(rawElements)
  if (error) {
    return { elements: [] as unknown[], error }
  }

  const { convertToExcalidrawElements } = await import('@excalidraw/excalidraw')
  try {
    const elements = convertToExcalidrawElements(skeletons as never, { regenerateIds: false })
    return { elements: elements as unknown[] }
  } catch (err) {
    return {
      elements: [] as unknown[],
      error: err instanceof Error ? err.message : 'Failed to convert Excalidraw elements',
    }
  }
}
