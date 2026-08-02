import { Tool, ToolResult } from '../types'
import { getMarks, getAllMarks, insertMark, updateMark, delMark, restoreMark, Mark, insertMarks, updateMarks, deleteMarks, restoreMarks } from '@/db/marks'
import useTagStore from '@/stores/tag'

/**
 * ID
 * ，
 */
function getCurrentTagId(tagId?: number): number {
  // tagId，
  if (tagId !== undefined && tagId !== null) {
    return tagId
  }
  //
  return useTagStore.getState().currentTagId
}

export const readMarksTool: Tool = {
  name: 'read_marks',
  description: 'Read all content records (marks) under a specific tag. Uses current selected tag if tagId not specified.',
  category: 'mark',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'tagId',
      type: 'number',
      description: 'Tag ID (optional, uses current selected tag if not specified)',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const tagId = getCurrentTagId(params.tagId)
      const marks = await getMarks(tagId)
      const activeMarks = marks.filter(m => m.deleted === 0)
      return {
        success: true,
        data: activeMarks,
        message: `Found ${activeMarks.length} records`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to read record: ${error}`,
      }
    }
  },
}

export const createMarkTool: Tool = {
  name: 'create_mark',
  description: 'Create a new content record (mark) under a specific tag.',
  category: 'mark',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'tagId',
      type: 'number',
      description: 'Tag ID (use list_tags first to get available tags)',
      required: true,
    },
    {
      name: 'type',
      type: 'string',
      description: 'Mark type: scan (OCR), text, image, link, file, recording',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: 'Main content of the mark (text, OCR result, etc.)',
      required: false,
    },
    {
      name: 'url',
      type: 'string',
      description: 'Related URL or file path',
      required: false,
    },
    {
      name: 'desc',
      type: 'string',
      description: 'Brief description or title',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const mark: Partial<Mark> = {
        tagId: params.tagId,
        type: params.type as 'scan' | 'text' | 'image' | 'link' | 'file' | 'recording',
        content: params.content,
        url: params.url || '',
        desc: params.desc,
      }
      const result = await insertMark(mark)
      return {
        success: true,
        data: { id: result.lastInsertId },
        message: `Successfully created record, ID: ${result.lastInsertId}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to create record: ${error}`,
      }
    }
  },
}

export const updateMarkTool: Tool = {
  name: 'update_mark',
  description: 'Update content of an existing mark.',
  category: 'mark',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'id',
      type: 'number',
      description: 'Mark ID (use read_marks first to get mark IDs)',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: 'New content',
      required: false,
    },
    {
      name: 'desc',
      type: 'string',
      description: 'New description',
      required: false,
    },
    {
      name: 'tagId',
      type: 'number',
      description: 'Move to new tag (optional)',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const marks = await getAllMarks()
      const mark = marks.find(m => m.id === params.id)
      
      if (!mark) {
        return {
          success: false,
          error: `Record with ID ${params.id} not found`,
        }
      }
      
      const updatedMark: Mark = {
        ...mark,
        content: params.content !== undefined ? params.content : mark.content,
        desc: params.desc !== undefined ? params.desc : mark.desc,
        tagId: params.tagId !== undefined ? params.tagId : mark.tagId,
      }

      if (
        updatedMark.content === mark.content &&
        updatedMark.desc === mark.desc &&
        updatedMark.tagId === mark.tagId
      ) {
        return {
          success: true,
          data: { id: mark.id, unchanged: true },
          message: `Record ID: ${params.id} is already the target state; no update needed`,
        }
      }
      
      await updateMark(updatedMark)
      return {
        success: true,
        message: `Successfully updated record ID: ${params.id}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to update record: ${error}`,
      }
    }
  },
}

export const deleteMarkTool: Tool = {
  name: 'delete_mark',
  description: 'Soft delete a mark. Can be restored with restore_mark.',
  category: 'mark',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'id',
      type: 'number',
      description: 'Mark ID to delete',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const marks = await getAllMarks()
      const mark = marks.find(item => item.id === params.id)
      if (!mark || mark.deleted === 1) {
        return {
          success: true,
          data: { id: params.id, alreadyAbsent: true },
          message: `Record ID: ${params.id} is deleted; no repeat needed`,
        }
      }
      await delMark(params.id)
      return {
        success: true,
        data: { id: params.id, alreadyAbsent: false },
        message: `Successfully deleted record ID: ${params.id}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete record: ${error}`,
      }
    }
  },
}

export const restoreMarkTool: Tool = {
  name: 'restore_mark',
  description: 'Restore deleted marks',
  category: 'mark',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'id',
      type: 'number',
      description: 'ID of the mark to restore',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      await restoreMark(params.id)
      return {
        success: true,
        message: `Successfully restored record ID: ${params.id}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to restore record: ${error}`,
      }
    }
  },
}

export const searchMarksTool: Tool = {
  name: 'search_marks',
  description: 'Search content within marks (database records). Uses current selected tag if tagId not specified.',
  category: 'search',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'Search keyword',
      required: true,
    },
    {
      name: 'tagId',
      type: 'number',
      description: 'Tag ID (optional, uses current selected tag if not specified)',
      required: false,
    },
    {
      name: 'type',
      type: 'string',
      description: 'Optional: filter by mark type (scan, text, image, link, file, recording)',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const tagId = getCurrentTagId(params.tagId)
      const marks = await getMarks(tagId)
      let results = marks.filter(mark =>
        mark.deleted === 0 &&
        (mark.content?.toLowerCase().includes(params.query.toLowerCase()) ||
         mark.desc?.toLowerCase().includes(params.query.toLowerCase()))
      )

      if (params.type) {
        results = results.filter(mark => mark.type === params.type)
      }

      return {
        success: true,
        data: results,
        message: `Found ${results.length} matching records`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to search records: ${error}`,
      }
    }
  },
}

export const searchAllMarksTool: Tool = {
  name: 'search_all_marks',
  description: 'Search ALL marks across ALL tags for keywords.',
  category: 'search',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'Search keyword',
      required: true,
    },
    {
      name: 'mode',
      type: 'string',
      description: 'Search mode: fuzzy (default, contains keyword) or exact (exact match)',
      required: false,
    },
    {
      name: 'type',
      type: 'string',
      description: 'Optional: filter by mark type (scan, text, image, link, file, recording)',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const allMarks = await getAllMarks()
      const queryLower = params.query.toLowerCase()

      let results = allMarks.filter(mark => {
        if (mark.deleted === 1) return false

        const contentMatch = params.mode === 'exact'
          ? mark.content?.toLowerCase() === queryLower
          : mark.content?.toLowerCase().includes(queryLower)
        const descMatch = params.mode === 'exact'
          ? mark.desc?.toLowerCase() === queryLower
          : mark.desc?.toLowerCase().includes(queryLower)

        return contentMatch || descMatch
      })

      if (params.type) {
        results = results.filter(mark => mark.type === params.type)
      }

      return {
        success: true,
        data: results,
        message: `Found ${results.length} matching records across all tags`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to search all records: ${error}`,
      }
    }
  },
}

export const createMarksBatchTool: Tool = {
  name: 'create_marks_batch',
  description: 'Batch create multiple marks to avoid loop calls. Use for scenarios requiring multiple marks to be created at once.',
  category: 'mark',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'marks',
      type: 'array',
      description: 'Array of marks to create, each mark contains tagId, type, content, url, desc and other fields',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.marks) || params.marks.length === 0) {
        return {
          success: false,
          error: 'Parameter marks must be a non-empty array',
        }
      }

      const marksToInsert: Partial<Mark>[] = params.marks.map((mark: any) => ({
        tagId: mark.tagId,
        type: mark.type as 'scan' | 'text' | 'image' | 'link' | 'file' | 'recording',
        content: mark.content,
        url: mark.url || '',
        desc: mark.desc,
        createdAt: Date.now(),
        deleted: 0,
      }))

      await insertMarks(marksToInsert)
      
      return {
        success: true,
        data: { count: marksToInsert.length },
        message: `Successfully batch-created ${marksToInsert.length} records`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to batch-create records: ${error}`,
      }
    }
  },
}

export const updateMarksBatchTool: Tool = {
  name: 'update_marks_batch',
  description: 'Batch update multiple marks to avoid loop calls. Each mark must include the id field.',
  category: 'mark',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'marks',
      type: 'array',
      description: 'Array of marks to update, each mark must include id and fields to update',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.marks) || params.marks.length === 0) {
        return {
          success: false,
          error: 'Parameter marks must be a non-empty array',
        }
      }

      const marksToUpdate: Mark[] = params.marks.map((mark: any) => ({
        id: mark.id,
        tagId: mark.tagId,
        type: mark.type,
        content: mark.content,
        url: mark.url,
        desc: mark.desc,
        deleted: mark.deleted ?? 0,
        createdAt: mark.createdAt || Date.now(),
      }))

      await updateMarks(marksToUpdate)
      
      return {
        success: true,
        data: { count: marksToUpdate.length },
        message: `Successfully batch-updated ${marksToUpdate.length} records`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to batch-update records: ${error}`,
      }
    }
  },
}

export const deleteMarksBatchTool: Tool = {
  name: 'delete_marks_batch',
  description: 'Batch delete multiple marks (soft delete, can be restored) to avoid loop calls.',
  category: 'mark',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'ids',
      type: 'array',
      description: 'Array of mark IDs to delete',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.ids) || params.ids.length === 0) {
        return {
          success: false,
          error: 'Parameter ids must be a non-empty array',
        }
      }

      await deleteMarks(params.ids)
      
      return {
        success: true,
        data: { count: params.ids.length },
        message: `Successfully batch-deleted ${params.ids.length} records`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to batch-delete records: ${error}`,
      }
    }
  },
}

export const restoreMarksBatchTool: Tool = {
  name: 'restore_marks_batch',
  description: 'Batch restore deleted marks to avoid loop calls.',
  category: 'mark',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'ids',
      type: 'array',
      description: 'Array of mark IDs to restore',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.ids) || params.ids.length === 0) {
        return {
          success: false,
          error: 'Parameter ids must be a non-empty array',
        }
      }

      await restoreMarks(params.ids)
      
      return {
        success: true,
        data: { count: params.ids.length },
        message: `Successfully batch-restored ${params.ids.length} records`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to batch-restore records: ${error}`,
      }
    }
  },
}

export const markTools: Tool[] = [
  readMarksTool,
  createMarkTool,
  updateMarkTool,
  deleteMarkTool,
  restoreMarkTool,
  searchMarksTool,
  searchAllMarksTool,
  createMarksBatchTool,
  updateMarksBatchTool,
  deleteMarksBatchTool,
  restoreMarksBatchTool,
]
