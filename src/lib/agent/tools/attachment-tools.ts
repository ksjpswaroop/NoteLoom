import { readDir, readTextFile } from '@tauri-apps/plugin-fs'
import { extractTextFromPDF } from '@/lib/pdf'
import {
  getAttachmentExtension,
  isReadableAttachmentName,
  resolveAttachmentChildPath,
} from '@/lib/chat-attachments'
import type { AgentTool } from '../types'

const MAX_BATCH_ATTACHMENT_CONTENT_CHARS = 8000

function getAttachment(id: unknown, context: Parameters<AgentTool['execute']>[1]) {
  if (typeof id !== 'string') return undefined
  return context.context.attachments?.find((attachment) => attachment.id === id)
}

export const listAttachmentsTool: AgentTool = {
  name: 'attachment_list',
  title: 'List attachment directory',
  description: 'List the immediate children of a user-selected folder attachment. Paths are relative to the selected folder and symbolic links are not followed.',
  category: 'attachment',
  risk: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      attachmentId: { type: 'string', description: 'Attachment ID from the current attachment context.' },
      relativePath: { type: 'string', description: 'Optional subfolder path relative to the selected folder.' },
    },
    required: ['attachmentId'],
    additionalProperties: false,
  },
  execute: async (input, context) => {
    const attachment = getAttachment(input.attachmentId, context)
    if (!attachment) return { ok: false, message: 'Attachment does not exist or is no longer authorized for this run.', error: 'ATTACHMENT_NOT_AVAILABLE' }
    if (attachment.kind !== 'folder') return { ok: false, message: 'This attachment is not a folder.', error: 'ATTACHMENT_NOT_FOLDER' }
    try {
      const relativePath = typeof input.relativePath === 'string' ? input.relativePath : ''
      const directoryPath = await resolveAttachmentChildPath(attachment, relativePath)
      const entries = (await readDir(directoryPath))
        .filter((entry) => !entry.name.startsWith('.'))
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => ({
          name: entry.name,
          kind: entry.isDirectory ? 'folder' : 'file',
          readable: entry.isDirectory || (!entry.isSymlink && isReadableAttachmentName(entry.name)),
          symlink: entry.isSymlink,
        }))
      return {
        ok: true,
        message: `Listed ${entries.length} items in attachment folder ${attachment.name}.`,
        data: { attachmentId: attachment.id, attachmentName: attachment.name, relativePath, entries },
      }
    } catch (error) {
      return { ok: false, message: `Unable to list attachment directory: ${String(error)}`, error: 'ATTACHMENT_LIST_FAILED' }
    }
  },
}

export const readAttachmentTool: AgentTool = {
  name: 'attachment_read',
  title: 'Read attachment',
  description: 'Read user-selected text, code, CSV, Markdown, or PDF attachments. For a folder summary, pass every relevant readable path together in relativePaths; use relativePath only when one file is sufficient. Use relative paths only.',
  category: 'attachment',
  risk: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      attachmentId: { type: 'string', description: 'Attachment ID from the current attachment context.' },
      relativePath: { type: 'string', description: 'Required for folder attachments; omit for a selected file.' },
      relativePaths: {
        type: 'array',
        description: 'Up to 20 relevant readable paths inside one folder attachment. Prefer this for folder-wide summary or analysis.',
        items: { type: 'string' },
      },
      startLine: { type: 'number', description: 'Optional 1-based start line.' },
      endLine: { type: 'number', description: 'Optional inclusive end line.' },
    },
    required: ['attachmentId'],
    additionalProperties: false,
  },
  execute: async (input, context) => {
    const attachment = getAttachment(input.attachmentId, context)
    if (!attachment) return { ok: false, message: 'Attachment does not exist or is no longer authorized for this run.', error: 'ATTACHMENT_NOT_AVAILABLE' }
    const relativePath = typeof input.relativePath === 'string' ? input.relativePath : ''
    const relativePaths = Array.isArray(input.relativePaths)
      ? [...new Set(input.relativePaths.filter((path): path is string => typeof path === 'string' && path.trim().length > 0))].slice(0, 20)
      : []
    const requestedPaths = attachment.kind === 'file'
      ? ['']
      : relativePaths.length > 0
        ? relativePaths
        : relativePath
          ? [relativePath]
          : []
    if (requestedPaths.length === 0) {
      return { ok: false, message: 'Reading a folder attachment requires relativePath or relativePaths.', error: 'ATTACHMENT_PATH_REQUIRED' }
    }

    const results: Array<{
      path: string
      ok: boolean
      startLine?: number
      endLine?: number
      totalLines?: number
      content?: string
      truncated?: boolean
      error?: string
    }> = []
    const perFileContentLimit = Math.max(
      500,
      Math.floor(MAX_BATCH_ATTACHMENT_CONTENT_CHARS / requestedPaths.length)
    )

    for (const path of requestedPaths) {
      const displayName = attachment.kind === 'file' ? attachment.name : path.split('/').pop() || path
      if (!isReadableAttachmentName(displayName)) {
        results.push({ path: path || attachment.name, ok: false, error: 'ATTACHMENT_UNSUPPORTED' })
        continue
      }

      try {
        const targetPath = await resolveAttachmentChildPath(attachment, path)
        const extension = getAttachmentExtension(displayName)
        const content = extension === 'pdf'
          ? await extractTextFromPDF(targetPath)
          : await readTextFile(targetPath)
        const lines = content.replace(/\r\n/g, '\n').split('\n')
        const startLine = Number.isInteger(input.startLine) ? Math.max(1, Number(input.startLine)) : 1
        const endLine = Number.isInteger(input.endLine)
          ? Math.min(lines.length, Math.max(startLine, Number(input.endLine)))
          : lines.length
        const selected = lines.slice(startLine - 1, endLine)
          .map((line, index) => `${startLine + index} | ${line}`)
          .join('\n')
        const truncated = requestedPaths.length > 1 && selected.length > perFileContentLimit
        results.push({
          path: path || attachment.name,
          ok: true,
          startLine,
          endLine,
          totalLines: lines.length,
          content: truncated ? `${selected.slice(0, perFileContentLimit)}\n…content truncated; continue reading by line.` : selected,
          truncated,
        })
      } catch (error) {
        results.push({ path: path || attachment.name, ok: false, error: String(error) })
      }
    }

    if (results.length === 1) {
      const [result] = results
      if (!result.ok) {
        return {
          ok: false,
          message: result.error === 'ATTACHMENT_UNSUPPORTED'
            ? `Attachment ${result.path} format does not support content reading; use the provided metadata only.`
            : `Unable to read attachment: ${result.error}`,
          error: result.error || 'ATTACHMENT_READ_FAILED',
        }
      }
      return {
        ok: true,
        message: `Read ${result.path} lines ${result.startLine}-${result.endLine} of ${result.totalLines}.`,
        data: { name: result.path, startLine: result.startLine, endLine: result.endLine, totalLines: result.totalLines, content: result.content },
      }
    }

    const readCount = results.filter((result) => result.ok).length
    const truncatedCount = results.filter((result) => result.truncated).length
    return {
      ok: readCount > 0,
 message: `Batch-read ${readCount}/${results.length} attachment files${truncatedCount > 0 ? `, ${truncatedCount} truncated` : ''}.`,
      data: { requestedCount: results.length, readCount, files: results },
      error: readCount > 0 ? undefined : 'ATTACHMENT_READ_FAILED',
    }
  },
}

export const attachmentTools = [listAttachmentsTool, readAttachmentTool]
