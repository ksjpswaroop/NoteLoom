import { Tool, ToolResult } from '../types'
import { getTags, insertTag, updateTag, delTag, Tag, insertTags } from '@/db/tags'

export const listTagsTool: Tool = {
  name: 'list_tags',
  description: 'List all tags (organization categories for marks).',
  category: 'tag',
  requiresConfirmation: false,
  parameters: [],
  execute: async (): Promise<ToolResult> => {
    try {
      const tags = await getTags()
      return {
        success: true,
        data: tags,
        message: `Found ${tags.length} tags`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to get tag list: ${error}`,
      }
    }
  },
}

export const createTagTool: Tool = {
  name: 'create_tag',
  description: 'Create a new tag (category) for organizing marks.',
  category: 'tag',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'name',
      type: 'string',
      description: 'Tag name (e.g., "Inbox", "Bookmarks", "Recipes")',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const tags = await getTags()
      const existing = tags.find(tag => tag.name === params.name)
      if (existing) {
        return {
          success: true,
          data: { id: existing.id, name: existing.name, alreadyExists: true },
          message: `Tag "${params.name}" already exists; no create needed`,
        }
      }
      const result = await insertTag({ name: params.name })
      return {
        success: true,
        data: { id: result.lastInsertId, name: params.name, alreadyExists: false },
        message: `Successfully created tag "${params.name}", ID: ${result.lastInsertId}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to create tag: ${error}`,
      }
    }
  },
}

export const updateTagTool: Tool = {
  name: 'update_tag',
  description: 'Update tag name or properties (pin status).',
  category: 'tag',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'id',
      type: 'number',
      description: 'Tag ID (use list_tags first to get tag IDs)',
      required: true,
    },
    {
      name: 'name',
      type: 'string',
      description: 'New tag name',
      required: false,
    },
    {
      name: 'isPin',
      type: 'boolean',
      description: 'Pin or unpin the tag',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const tags = await getTags()
      const tag = tags.find(t => t.id === params.id)
      
      if (!tag) {
        return {
          success: false,
          error: `Tag with ID ${params.id} not found`,
        }
      }
      
      const updatedTag: Tag = {
        ...tag,
        name: params.name !== undefined ? params.name : tag.name,
        isPin: params.isPin !== undefined ? params.isPin : tag.isPin,
      }

      if (updatedTag.name === tag.name && updatedTag.isPin === tag.isPin) {
        return {
          success: true,
          data: { id: tag.id, unchanged: true },
          message: `Tag ID: ${params.id} is already the target state; no update needed`,
        }
      }
      
      await updateTag(updatedTag)
      return {
        success: true,
        message: `Successfully updated tag ID: ${params.id}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to update tag: ${error}`,
      }
    }
  },
}

export const searchTagsTool: Tool = {
  name: 'search_tags',
  description: 'Search tags by name (fuzzy match).',
  category: 'search',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'Search keyword (fuzzy match on tag name)',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const tags = await getTags()
      const queryLower = params.query.toLowerCase()

      const results = tags.filter(tag =>
        tag.name.toLowerCase().includes(queryLower)
      )

      return {
        success: true,
        data: results,
        message: `Found ${results.length} matching tags`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to search tags: ${error}`,
      }
    }
  },
}

export const deleteTagTool: Tool = {
  name: 'delete_tag',
  description: 'Delete a tag and ALL marks under it. Use with caution.',
  category: 'tag',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'id',
      type: 'number',
      description: 'Tag ID to delete (use list_tags first to get tag IDs)',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const tags = await getTags()
      const tag = tags.find(t => t.id === params.id)
      
      if (!tag) {
        return {
          success: true,
          data: { id: params.id, alreadyAbsent: true },
          message: `Tag ID: ${params.id} no longer exists; no delete needed`,
        }
      }
      
      if (tag.isLocked) {
        return {
          success: false,
          error: `Tag "${tag.name}" is locked and cannot be deleted`,
        }
      }
      
      await delTag(params.id)
      return {
        success: true,
        data: { id: params.id, alreadyAbsent: false },
        message: `Successfully deleted tag "${tag.name}"`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete tag: ${error}`,
      }
    }
  },
}

export const createTagsBatchTool: Tool = {
  name: 'create_tags_batch',
  description: 'Batch create multiple tags to avoid loop calls. Use for scenarios requiring multiple tags to be created at once.',
  category: 'tag',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'tags',
      type: 'array',
      description: 'Array of tags to create, each tag contains name and other fields',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.tags) || params.tags.length === 0) {
        return {
          success: false,
          error: 'Parameter tags must be a non-empty array',
        }
      }

      const results = []
      for (const tag of params.tags) {
        const result = await insertTag({ name: tag.name })
        results.push({ name: tag.name, id: result.lastInsertId })
      }
      
      return {
        success: true,
        data: { count: results.length, tags: results },
        message: `Successfully batch-created ${results.length} tags`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to batch-create tags: ${error}`,
      }
    }
  },
}

export const updateTagsBatchTool: Tool = {
  name: 'update_tags_batch',
  description: 'Batch update multiple tags to avoid loop calls. Each tag must include the id field.',
  category: 'tag',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'tags',
      type: 'array',
      description: 'Array of tags to update, each tag must include id and fields to update',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.tags) || params.tags.length === 0) {
        return {
          success: false,
          error: 'Parameter tags must be a non-empty array',
        }
      }

      const allTags = await getTags()
      const tagsToUpdate: Tag[] = []
      
      for (const tagUpdate of params.tags) {
        const existingTag = allTags.find(t => t.id === tagUpdate.id)
        if (!existingTag) {
          return {
            success: false,
            error: `Tag with ID ${tagUpdate.id} not found`,
          }
        }
        
        tagsToUpdate.push({
          ...existingTag,
          name: tagUpdate.name !== undefined ? tagUpdate.name : existingTag.name,
          isPin: tagUpdate.isPin !== undefined ? tagUpdate.isPin : existingTag.isPin,
          isLocked: tagUpdate.isLocked !== undefined ? tagUpdate.isLocked : existingTag.isLocked,
          sortOrder: tagUpdate.sortOrder !== undefined ? tagUpdate.sortOrder : existingTag.sortOrder,
        })
      }

      await insertTags(tagsToUpdate)
      
      return {
        success: true,
        data: { count: tagsToUpdate.length },
        message: `Successfully batch-updated ${tagsToUpdate.length} tags`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to batch-update tags: ${error}`,
      }
    }
  },
}

export const tagTools: Tool[] = [
  listTagsTool,
  createTagTool,
  updateTagTool,
  deleteTagTool,
  searchTagsTool,
  createTagsBatchTool,
  updateTagsBatchTool,
]
