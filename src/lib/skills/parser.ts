/**
 * SKILL.md 
 *
 * SKILL.md ， YAML Markdown 。
 * Agent Skills : https://agentskills.io/specification
 */

import {
  ParsedSkillFile,
  SkillYamlMetadata,
  ScriptType,
  SCRIPT_EXTENSIONS,
  SCRIPT_SHEBANG,
} from './types'
import { parse as parseYaml } from 'yaml'

// ============================================================================
//
// ============================================================================

/**
 * SKILL.md 
 *
 * @param content - SKILL.md 
 * @returns Skill 
 */
export function parseSkillFile(content: string): ParsedSkillFile {
  // YAML
  if (!content.startsWith('---')) {
    return {
      metadata: {
        name: '',
        description: '',
      },
      content: content.trim(),
      rawContent: content,
    }
  }

  // YAML
  const yamlEnd = content.indexOf('\n---', 3)
  if (yamlEnd === -1) {
    throw new Error('Invalid SKILL.md: YAML frontmatter not properly closed')
  }

  const yamlContent = content.slice(3, yamlEnd).trim()
  const markdownContent = content.slice(yamlEnd + 4).trim()

  // YAML
  const metadata = parseYamlMetadata(yamlContent)

  return {
    metadata,
    content: markdownContent,
    rawContent: content,
  }
}

/**
 * YAML 
 *
 * @param yamlContent - YAML 
 * @returns 
 */
function parseYamlMetadata(yamlContent: string): SkillYamlMetadata {
  const parsed: unknown = parseYaml(yamlContent)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid SKILL.md: YAML frontmatter must be an object')
  }

  const value = parsed as Record<string, unknown>
  const stringValue = (input: unknown): string | undefined => {
    if (typeof input === 'string') return input
    if (typeof input === 'number' || typeof input === 'boolean') return String(input)
    return undefined
  }
  const metadataValue = value.metadata
  const metadata = metadataValue && typeof metadataValue === 'object' && !Array.isArray(metadataValue)
    ? Object.fromEntries(Object.entries(metadataValue).flatMap(([key, item]) => {
        const normalized = stringValue(item)
        return normalized === undefined ? [] : [[key, normalized]]
      }))
    : undefined
  const allowedToolsValue = value['allowed-tools'] ?? value.allowedTools
  const allowedTools = Array.isArray(allowedToolsValue)
    ? allowedToolsValue.map(stringValue).filter((tool): tool is string => Boolean(tool))
    : stringValue(allowedToolsValue)?.split(/\s+/).filter(Boolean)
  const userInvocableValue = value.userInvocable ?? value['user-invocable']

  return {
    name: stringValue(value.name) ?? '',
    description: stringValue(value.description) ?? '',
    license: stringValue(value.license),
    compatibility: stringValue(value.compatibility),
    metadata,
    allowedTools,
    version: stringValue(value.version) ?? metadata?.version,
    author: stringValue(value.author) ?? metadata?.author,
    model: stringValue(value.model),
    userInvocable: typeof userInvocableValue === 'boolean' ? userInvocableValue : undefined,
  }
}

// ============================================================================
//
// ============================================================================

/**
 * Skill SKILL.md 
 *
 * @param metadata - Skill 
 * @param instructions - 
 * @returns SKILL.md 
 */
export function serializeSkillFile(
  metadata: SkillYamlMetadata,
  instructions: string
): string {
  const yamlLines: string[] = ['---']

  //
  yamlLines.push(`name: ${metadata.name}`)
  yamlLines.push(`description: ${metadata.description}`)

  // ()
  if (metadata.license) {
    yamlLines.push(`license: ${metadata.license}`)
  }

  if (metadata.compatibility) {
    yamlLines.push(`compatibility: ${metadata.compatibility}`)
  }

  // metadata
  if (metadata.metadata && Object.keys(metadata.metadata).length > 0) {
    yamlLines.push(`metadata:`)
    for (const [key, value] of Object.entries(metadata.metadata)) {
      yamlLines.push(`  ${key}: ${value}`)
    }
  }

  // allowedTools ()
  if (metadata.allowedTools && metadata.allowedTools.length > 0) {
    const toolsValue = Array.isArray(metadata.allowedTools)
      ? metadata.allowedTools.join(' ')
      : metadata.allowedTools
    yamlLines.push(`allowed-tools: ${toolsValue}`)
  }

  // ()
  if (metadata.version && !metadata.metadata?.version) {
    yamlLines.push(`version: ${metadata.version}`)
  }

  if (metadata.author && !metadata.metadata?.author) {
    yamlLines.push(`author: ${metadata.author}`)
  }

  if (metadata.model) {
    yamlLines.push(`model: ${metadata.model}`)
  }

  if (metadata.userInvocable !== undefined) {
    yamlLines.push(`userInvocable: ${metadata.userInvocable}`)
  }

  yamlLines.push('---')

  // Markdown
  const content = yamlLines.join('\n') + '\n\n' + instructions.trim() + '\n'

  return content
}

// ============================================================================
//
// ============================================================================

/**
 * Skill ID
 *
 * @param directoryName - Skill 
 * @returns Skill ID (kebab-case)
 */
export function generateSkillId(directoryName: string): string {
  return directoryName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Skill ID 
 *
 * ：
 * - 1-64 
 * - 、
 * - 
 * - 
 *
 * @param id - Skill ID
 * @returns 
 */
export function isValidSkillId(id: string): boolean {
  if (id.length < 1 || id.length > 64) {
    return false
  }
  if (id.startsWith('-') || id.endsWith('-')) {
    return false
  }
  if (id.includes('--')) {
    return false
  }
  return /^[a-z0-9-]+$/.test(id)
}

/**
 * name ()
 *
 * @param name - Skill 
 * @returns 
 */
export function isValidSkillName(name: string): boolean {
  if (name.length < 1 || name.length > 64) {
    return false
  }
  if (name.startsWith('-') || name.endsWith('-')) {
    return false
  }
  if (name.includes('--')) {
    return false
  }
  // unicode
  return /^[\p{Ll}0-9-]+$/u.test(name)
}

/**
 * description ()
 *
 * @param description - Skill 
 * @returns 
 */
export function isValidSkillDescription(description: string): boolean {
  return description.length >= 1 && description.length <= 1024
}

/**
 * 
 *
 * @param filename - 
 * @param content - (， shebang )
 * @returns null
 */
export function detectScriptType(filename: string, content?: string): ScriptType | null {
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase()

  //
  for (const [type, extensions] of Object.entries(SCRIPT_EXTENSIONS)) {
    if (extensions.includes(ext)) {
      return type as ScriptType
    }
  }

  // shebang
  if (content) {
    const firstLine = content.split('\n')[0].trim()
    for (const [type, shebangs] of Object.entries(SCRIPT_SHEBANG)) {
      if (shebangs.some(s => firstLine.startsWith(s))) {
        return type as ScriptType
      }
    }
  }

  return null
}

/**
 * SKILL.md 
 *
 * Markdown : [text](path.md)
 * 
 *
 * @param content - Markdown 
 * @returns 
 */
export function extractReferenceLinks(content: string): string[] {
  const linkRegex = /\[([^\]]+)\]\(([^)]+\.md)\)/g
  const links: string[] = []

  let match
  while ((match = linkRegex.exec(content)) !== null) {
    links.push(match[2])
  }

  return links
}

/**
 * SKILL.md 
 *
 * "Run the extraction script: scripts/extract.py" 
 *
 * @param content - Markdown 
 * @returns 
 */
export function extractScriptReferences(content: string): string[] {
  const patterns = [
    /scripts\/[^\s\)]+/g,
    /`scripts\/[^\s`]+`/g,
  ]

  const scripts: string[] = []

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(content)) !== null) {
      const scriptPath = match[0].replace(/`/g, '')
      scripts.push(scriptPath)
    }
  }

  return scripts
}
