/**
 * Skill 
 *
 * Skill 。
 * Agent Skills : https://agentskills.io/specification
 */

import type {
  SkillContent,
  SkillExecutionResult,
  SkillExecutionRecord,
} from './types'

// ============================================================================
// SkillExecutor
// ============================================================================

/**
 * Skill 
 *
 * ：
 * - Skill
 * - Skill 
 * - Skill 
 * - (scripts/)
 */
export class SkillExecutor {
  private executionHistory: SkillExecutionRecord[] = []
  private maxHistorySize = 100

  // ========================================================================
  //
  // ========================================================================

  /**
 * Skill
 *
 * ：， AI 
 *
 * @param skill - Skill
 * @param userInput - 
 * @returns 
 */
  formatSkillForExecution(skill: SkillContent, userInput: string): string {
    const sections: string[] = []

    // Skill
    sections.push(`## Using Skill: ${skill.metadata.name}`)
    sections.push('')

    // Skill
    if (skill.metadata.description) {
      sections.push(`**Description**: ${skill.metadata.description}`)
      sections.push('')
    }

    // ()
    if (skill.metadata.compatibility) {
      sections.push(`**Compatibility**: ${skill.metadata.compatibility}`)
      sections.push('')
    }

    // ()
    if (skill.metadata.license) {
      sections.push(`**License**: ${skill.metadata.license}`)
      sections.push('')
    }

    // Skill
    if (skill.metadata.version) {
      sections.push(`**Version**: ${skill.metadata.version}`)
    }
    if (skill.metadata.author) {
      sections.push(`**Author**: ${skill.metadata.author}`)
    }
    sections.push('')

    // ()
    if (skill.scripts && skill.scripts.length > 0) {
      sections.push('**Available Scripts**:')
      for (const script of skill.scripts) {
        sections.push(`  - \`${script.name}\` (${script.type})`)
      }
      sections.push('')
    }

    // ()
    if (skill.references && skill.references.length > 0) {
      sections.push('**Available References**:')
      for (const ref of skill.references) {
        sections.push(`  - [${ref.name}](${ref.path})`)
      }
      sections.push('')
    }

    //
    sections.push('---')
    sections.push('')

    //
    sections.push('### Instructions')
    sections.push('')
    sections.push(skill.instructions)
    sections.push('')

    //
    sections.push('### User Request')
    sections.push('')
    sections.push(`> ${userInput}`)
    sections.push('')

    return sections.join('\n')
  }

  /**
 * Skills 
 *
 * @param skills - Skills 
 * @returns 
 */
  formatSkillsAsSystemPrompt(skills: SkillContent[]): string {
    if (skills.length === 0) {
      return ''
    }

    const sections: string[] = []

    sections.push('# Available Skills')
    sections.push('')
    sections.push(
      `You have access to ${skills.length} specialized skill(s). ` +
      'When the user request matches a skill description, use that skill instructions to guide your response.'
    )
    sections.push('')

    for (const skill of skills) {
      sections.push(`## Skill: ${skill.metadata.name}`)
      sections.push('')

      if (skill.metadata.description) {
        sections.push(`**Description**: ${skill.metadata.description}`)
        sections.push('')
      }

      if (skill.metadata.compatibility) {
        sections.push(`**Compatibility**: ${skill.metadata.compatibility}`)
        sections.push('')
      }

      sections.push(skill.instructions)
      sections.push('')

      //
      if (skill.scripts && skill.scripts.length > 0) {
        sections.push('**Available Scripts**:')
        for (const script of skill.scripts) {
          sections.push(`  - \`${script.name}\` (${script.type})`)
        }
        sections.push('')
      }

      //
      if (skill.metadata.allowedTools && skill.metadata.allowedTools.length > 0) {
        sections.push(
          `**Pre-approved tools**: ${skill.metadata.allowedTools.join(', ')}`
        )
        sections.push('')
      }

      sections.push('---')
      sections.push('')
    }

    return sections.join('\n')
  }

  /**
 * Skill 
 *
 * @param skill - Skill 
 * @returns 
 */
  formatSkillAsSystemPrompt(skill: SkillContent): string {
    return this.formatSkillsAsSystemPrompt([skill])
  }

  /**
 * Skill 
 *
 * @param skill - Skill 
 * @param scriptName - 
 * @returns 
 */
  hasScript(skill: SkillContent, scriptName: string): boolean {
    return skill.scripts.some(s => s.name === scriptName)
  }

  // ========================================================================
  // ()
  // ========================================================================

  /**
 * Skill ()
 * 100 tokens 
 *
 * @param skill - Skill 
 * @returns 
 */
  getMetadataSummary(skill: SkillContent): string {
    const parts: string[] = []
    parts.push(`**${skill.metadata.name}**`)
    parts.push(skill.metadata.description)

    if (skill.metadata.compatibility) {
      parts.push(`*Compatibility: ${skill.metadata.compatibility}*`)
    }

    return parts.join('\n')
  }

  /**
 * ()
 *
 * @param skill - Skill 
 * @param referenceName - 
 * @returns 
 */
  async loadReference(
    skill: SkillContent,
    referenceName: string
  ): Promise<string | null> {
    const reference = skill.references.find(r => r.name === referenceName)
    if (!reference) {
      return null
    }

    try {
      const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
      const { getFilePathOptions } = await import('@/lib/workspace')

      let content: string
      if (skill.metadata.scope === 'global') {
        content = await readTextFile(reference.path, { baseDir: BaseDirectory.AppData })
      } else {
        const options = await getFilePathOptions(reference.path)
        if (options.baseDir) {
          content = await readTextFile(options.path, { baseDir: options.baseDir })
        } else {
          content = await readTextFile(options.path)
        }
      }

      return content
    } catch (error) {
      console.error(`Failed to read reference doc: ${reference.path}`, error)
      return null
    }
  }

  /**
 * ()
 *
 * @param skill - Skill 
 * @param assetName - 
 * @returns 
 */
  async loadAsset(
    skill: SkillContent,
    assetName: string
  ): Promise<string | null> {
    const asset = skill.assets.find(a => a.name === assetName)
    if (!asset) {
      return null
    }

    try {
      const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
      const { getFilePathOptions } = await import('@/lib/workspace')

      let content: string
      if (skill.metadata.scope === 'global') {
        content = await readTextFile(asset.path, { baseDir: BaseDirectory.AppData })
      } else {
        const options = await getFilePathOptions(asset.path)
        if (options.baseDir) {
          content = await readTextFile(options.path, { baseDir: options.baseDir })
        } else {
          content = await readTextFile(options.path)
        }
      }

      return content
    } catch (error) {
      console.error(`Failed to read asset file: ${asset.path}`, error)
      return null
    }
  }

  // ========================================================================
  //
  // ========================================================================

  /**
 * 
 *
 * @param skillId - Skill ID
 * @param userInput - 
 * @param result - 
 * @returns 
 */
  createExecutionRecord(
    skillId: string,
    skillName: string,
    userInput: string,
    result: SkillExecutionResult
  ): SkillExecutionRecord {
    const record: SkillExecutionRecord = {
      id: this.generateRecordId(),
      skillId,
      skillName,
      userInput,
      result,
      timestamp: Date.now(),
    }

    //
    this.executionHistory.unshift(record)

    //
    if (this.executionHistory.length > this.maxHistorySize) {
      this.executionHistory = this.executionHistory.slice(0, this.maxHistorySize)
    }

    return record
  }

  /**
 * 
 *
 * @param limit - 
 * @returns 
 */
  getExecutionHistory(limit?: number): SkillExecutionRecord[] {
    if (limit) {
      return this.executionHistory.slice(0, limit)
    }
    return [...this.executionHistory]
  }

  /**
 * Skill 
 *
 * @param skillId - Skill ID
 * @param limit - 
 * @returns 
 */
  getSkillExecutionHistory(skillId: string, limit?: number): SkillExecutionRecord[] {
    const records = this.executionHistory.filter(r => r.skillId === skillId)
    if (limit) {
      return records.slice(0, limit)
    }
    return records
  }

  /**
 * 
 */
  clearExecutionHistory(): void {
    this.executionHistory = []
  }

  // ========================================================================
  //
  // ========================================================================

  /**
 * Skill 
 *
 * @param skill - Skill 
 * @param toolName - 
 * @returns 
 */
  isToolAllowed(skill: SkillContent, toolName: string): boolean {
    if (!skill.metadata.allowedTools || skill.metadata.allowedTools.length === 0) {
      return false
    }
    return skill.metadata.allowedTools.includes(toolName)
  }

  /**
 * Skill 
 *
 * @param skill - Skill 
 * @returns 
 */
  getAllowedTools(skill: SkillContent): string[] {
    return skill.metadata.allowedTools || []
  }

  // ========================================================================
  //
  // ========================================================================

  /**
 * ID
 */
  private generateRecordId(): string {
    return `record-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  /**
 * 
 *
 * @param success - 
 * @param skillId - Skill ID
 * @param result - 
 * @param error - 
 * @param toolsUsed - 
 * @param scriptsUsed - 
 * @param startTime - 
 * @returns 
 */
  createExecutionResult(
    success: boolean,
    skillId: string,
    result?: string,
    error?: string,
    toolsUsed: string[] = [],
    scriptsUsed: string[] = [],
    startTime?: number
  ): SkillExecutionResult {
    const executionTime = startTime
      ? Date.now() - startTime
      : 0

    return {
      success,
      skillId,
      result,
      error,
      toolsUsed,
      scriptsUsed,
      executionTime,
    }
  }
}

// ============================================================================
//
// ============================================================================

export const skillExecutor = new SkillExecutor()
