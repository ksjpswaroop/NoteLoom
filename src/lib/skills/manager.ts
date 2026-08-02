/**
 * Skill 
 *
 * Skills 、、。
 * Agent Skills : https://agentskills.io/specification
 */

import {
  SkillContent,
  SkillScope,
  SkillFileInfo,
  SkillMatchScore,
  SkillScript,
  SkillReference,
  SkillAsset,
  SKILL_FILE_NAME,
  SCRIPTS_DIR_NAME,
  REFERENCES_DIR_NAME,
  ASSETS_DIR_NAME,
  REFERENCE_FILE_NAME,
  EXAMPLES_FILE_NAME,
  KEYWORDS_FILE_NAME,
  DEFAULT_SKILL_VERSION,
  DEFAULT_SKILL_ENABLED,
  DEFAULT_USER_INVOCABLE,
} from './types'
import { parseSkillFile, generateSkillId, detectScriptType } from './parser'
import { validateSkillYamlMetadata } from './validator'
import { readFile, readTextFile, readDir, BaseDirectory, DirEntry } from '@tauri-apps/plugin-fs'
import { getFilePathOptions } from '@/lib/workspace'
import { exists } from '@tauri-apps/plugin-fs'
import { Store } from '@tauri-apps/plugin-store'

// ============================================================================
// SkillManager
// ============================================================================

/**
 * Skill 
 *
 * ：
 * - Skills
 * - Skills
 * - Skills
 * - Skill 
 * - 、
 */
class SkillManager {
  private skills: Map<string, SkillContent> = new Map()
  private installedSkills: Map<string, SkillContent> = new Map()
  private skillFiles: Map<string, SkillFileInfo> = new Map()
  private enabledOverrides: Record<string, boolean> = {}
  private initialized = false

  private async hashFile(filePath: string, scope: SkillScope): Promise<string> {
    const bytes = scope === 'global'
      ? await readFile(filePath, { baseDir: BaseDirectory.AppData })
      : await (async () => {
          const options = await getFilePathOptions(filePath)
          return options.baseDir
            ? await readFile(options.path, { baseDir: options.baseDir })
            : await readFile(options.path)
        })()
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  }

  // ========================================================================
  //
  // ========================================================================

  /**
 * Skill 
 * Skills
 */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    const store = await Store.load('store.json')
    this.enabledOverrides = await store.get<Record<string, boolean>>('skills.enabledSkills') || {}
    await this.discoverSkills()
    this.initialized = true
  }

  /**
 * Skills
 */
  async reload(): Promise<void> {
    this.skills.clear()
    this.installedSkills.clear()
    this.skillFiles.clear()
    this.initialized = false
    await this.initialize()
  }

  // ========================================================================
  //
  // ========================================================================

  /**
 * Skills
 */
  async discoverSkills(): Promise<void> {
    // Skills
    await this.discoverGlobalSkills()

    // Skill Skill 。
    await this.discoverProjectSkills()
  }

  /**
 * Skills
 */
  private async discoverProjectSkills(): Promise<void> {
    try {
      const skillsDirExists = await this.directoryExists('skills', 'project')
      if (!skillsDirExists) {
        return
      }

      const skillDirs = await this.listSkillDirectories('skills', 'project')

      for (const dirName of skillDirs) {
        try {
          await this.loadSkillFromDirectory('skills', dirName, 'project')
        } catch (error) {
          console.error(`Skill Failed: ${dirName}`, error)
        }
      }
    } catch (error) {
      console.error('Skills Failed', error)
    }
  }

  /**
 * Skills
 */
  private async discoverGlobalSkills(): Promise<void> {
    try {
      const skillsDirExists = await this.directoryExists('skills', 'global')
      if (!skillsDirExists) {
        return
      }

      const skillDirs = await this.listSkillDirectories('skills', 'global')

      for (const dirName of skillDirs) {
        try {
          await this.loadSkillFromDirectory('skills', dirName, 'global')
        } catch (error) {
          console.error(`Skill Failed: ${dirName}`, error)
        }
      }
    } catch (error) {
      console.error('Skills Failed', error)
    }
  }

  /**
 * Skill
 */
  private async loadSkillFromDirectory(
    baseDir: string,
    dirName: string,
    scope: SkillScope
  ): Promise<void> {
    const skillId = generateSkillId(dirName)
    const skillDirPath = `${baseDir}/${dirName}`
    const skillFilePath = `${skillDirPath}/${SKILL_FILE_NAME}`

    // SKILL.md
    const fileExists = await this.fileExists(skillFilePath, scope)
    if (!fileExists) {
      this.skillFiles.set(skillId, {
        id: skillId,
        directory: skillDirPath,
        mainFile: skillFilePath,
        hasScriptsDir: false,
        hasReferencesDir: false,
        hasAssetsDir: false,
        isValid: false,
        error: 'SKILL.md File does not exist',
      })
      return
    }

    // SKILL.md
    const content = await this.readFileContent(skillFilePath, scope)

    // Skill
    const parsed = parseSkillFile(content)

    //
    const validation = validateSkillYamlMetadata(parsed.metadata)
    if (!validation.valid) {
      this.skillFiles.set(skillId, {
        id: skillId,
        directory: skillDirPath,
        mainFile: skillFilePath,
        hasScriptsDir: false,
        hasReferencesDir: false,
        hasAssetsDir: false,
        isValid: false,
        error: validation.errors.map((e) => e.message).join('; '),
      })
      return
    }

    //
    const hasScriptsDir = await this.directoryExists(
      `${skillDirPath}/${SCRIPTS_DIR_NAME}`,
      scope
    )
    const hasReferencesDir = await this.directoryExists(
      `${skillDirPath}/${REFERENCES_DIR_NAME}`,
      scope
    )
    const hasAssetsDir = await this.directoryExists(
      `${skillDirPath}/${ASSETS_DIR_NAME}`,
      scope
    )

    // ：
    const hasReferenceFile = await this.fileExists(
      `${skillDirPath}/${REFERENCE_FILE_NAME}`,
      scope
    )
    const hasExamplesFile = await this.fileExists(
      `${skillDirPath}/${EXAMPLES_FILE_NAME}`,
      scope
    )
    const hasKeywordsFile = await this.fileExists(
      `${skillDirPath}/${KEYWORDS_FILE_NAME}`,
      scope
    )

    // (scripts/)
    const scripts: SkillScript[] = []
    if (hasScriptsDir) {
      const scriptFiles = await this.loadScriptsFromDirectory(
        `${skillDirPath}/${SCRIPTS_DIR_NAME}`,
        scope
      )
      scripts.push(...scriptFiles)
    }

    // (references/)
    const references: SkillReference[] = []
    if (hasReferencesDir) {
      const referenceFiles = await this.loadReferencesFromDirectory(
        `${skillDirPath}/${REFERENCES_DIR_NAME}`,
        scope
      )
      references.push(...referenceFiles)
    }

    // ： REFERENCE.md
    if (hasReferenceFile && !hasReferencesDir) {
      const refContent = await this.readFileContent(
        `${skillDirPath}/${REFERENCE_FILE_NAME}`,
        scope
      )
      references.push({
        name: REFERENCE_FILE_NAME,
        path: REFERENCE_FILE_NAME,
        description: 'Legacy reference file (consider moving to references/)',
      })
      //
      parsed.content += '\n\n---\n\n## (Legacy)\n\n' + refContent
    }

    // (assets/)
    const assets: SkillAsset[] = []
    if (hasAssetsDir) {
      const assetFiles = await this.loadAssetsFromDirectory(
        `${skillDirPath}/${ASSETS_DIR_NAME}`,
        scope
      )
      assets.push(...assetFiles)
    }

    // ： KEYWORDS.md
    if (hasKeywordsFile) {
      const keywordsContent = await this.readFileContent(
        `${skillDirPath}/${KEYWORDS_FILE_NAME}`,
        scope
      )
      parsed.content += '\n\n---\n\n## (Legacy)\n\n' + keywordsContent
    }

    // .md （ SKILL.md ）
    const rootMdFiles = await this.loadRootMdFiles(skillDirPath, scope)
    references.push(...rootMdFiles)

    // Skill
    const now = Date.now()
    const skill: SkillContent = {
      metadata: {
        id: skillId,
        name: parsed.metadata.name,
        description: parsed.metadata.description,
        license: parsed.metadata.license,
        compatibility: parsed.metadata.compatibility,
        metadata: parsed.metadata.metadata,
        version: parsed.metadata.version || parsed.metadata.metadata?.version || DEFAULT_SKILL_VERSION,
        author: parsed.metadata.author || parsed.metadata.metadata?.author,
        scope,
        model: parsed.metadata.model,
        allowedTools: Array.isArray(parsed.metadata.allowedTools)
          ? parsed.metadata.allowedTools
          : typeof parsed.metadata.allowedTools === 'string'
            ? parsed.metadata.allowedTools.split(/\s+/).filter(v => v.length > 0)
            : undefined,
        userInvocable: parsed.metadata.userInvocable ?? DEFAULT_USER_INVOCABLE,
        enabled: this.enabledOverrides[skillId] ?? DEFAULT_SKILL_ENABLED,
        createdAt: now,
        updatedAt: now,
      },
      instructions: parsed.content,
      scripts,
      references,
      assets,
    }

    // Skill
    this.registerSkill(skill)

    //
    this.skillFiles.set(skillId, {
      id: skillId,
      directory: skillDirPath,
      mainFile: skillFilePath,
      hasScriptsDir,
      hasReferencesDir,
      hasAssetsDir,
      hasReferenceFile,
      hasExamplesFile,
      hasKeywordsFile,
      isValid: true,
      scriptCount: scripts.length,
      referenceCount: references.length,
      assetCount: assets.length,
    })
  }

  /**
 * scripts/ ，。
 */
  private async loadScriptsFromDirectory(
    scriptsDir: string,
    scope: SkillScope,
    basePath: string = '',
    depth: number = 0
  ): Promise<SkillScript[]> {
    const scripts: SkillScript[] = []

    // ，。
    const maxDepth = 10

    try {
      let entries: DirEntry[]

      if (scope === 'global') {
        entries = await readDir(scriptsDir, { baseDir: BaseDirectory.AppData })
      } else {
        const options = await getFilePathOptions(scriptsDir)
        if (options.baseDir) {
          entries = await readDir(options.path, { baseDir: options.baseDir })
        } else {
          entries = await readDir(options.path)
        }
      }

      for (const entry of entries) {
        //
        if (entry.name.startsWith('.')) {
          continue
        }

        const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name

        if (entry.isFile) {
          //
          const scriptType = detectScriptType(entry.name)
          if (!scriptType) {
            // ，（）
            continue
          }

          // scriptsDir already points at the current recursion level. Using
          // relativePath here duplicates parent segments (for example
          // scripts/office/office/soffice.py) and silently drops nested scripts
          // when hashing fails.
          const scriptPath = `${scriptsDir}/${entry.name}`
          scripts.push({
            name: relativePath, // （ "office/unpack.py"）
            path: scriptPath,
            type: scriptType,
            sha256: await this.hashFile(scriptPath, scope),
          })
        } else if (entry.isDirectory && depth < maxDepth) {
          // （ maxDepth ）
          const subScripts = await this.loadScriptsFromDirectory(
            `${scriptsDir}/${entry.name}`,
            scope,
            relativePath,
            depth + 1
          )
          scripts.push(...subScripts)
        }
      }
    } catch (error) {
      console.error(`[SkillManager] Failed: ${scriptsDir}`, error)
    }

    return scripts
  }

  /**
 * references/ 
 */
  private async loadReferencesFromDirectory(
    referencesDir: string,
    scope: SkillScope
  ): Promise<SkillReference[]> {
    const references: SkillReference[] = []

    try {
      let entries: DirEntry[]

      if (scope === 'global') {
        entries = await readDir(referencesDir, { baseDir: BaseDirectory.AppData })
      } else {
        const options = await getFilePathOptions(referencesDir)
        if (options.baseDir) {
          entries = await readDir(options.path, { baseDir: options.baseDir })
        } else {
          entries = await readDir(options.path)
        }
      }

      for (const entry of entries) {
        //
        if (entry.name.startsWith('.')) {
          continue
        }

        // markdown
        if (entry.isFile && entry.name.endsWith('.md')) {
          references.push({
            name: entry.name,
            path: `${referencesDir}/${entry.name}`,
          })
        }
      }
    } catch (error) {
      console.error(`Failed: ${referencesDir}`, error)
    }

    return references
  }

  /**
 * assets/ 
 */
  private async loadAssetsFromDirectory(
    assetsDir: string,
    scope: SkillScope
  ): Promise<SkillAsset[]> {
    const assets: SkillAsset[] = []

    try {
      let entries: DirEntry[]

      if (scope === 'global') {
        entries = await readDir(assetsDir, { baseDir: BaseDirectory.AppData })
      } else {
        const options = await getFilePathOptions(assetsDir)
        if (options.baseDir) {
          entries = await readDir(options.path, { baseDir: options.baseDir })
        } else {
          entries = await readDir(options.path)
        }
      }

      for (const entry of entries) {
        //
        if (entry.name.startsWith('.')) {
          continue
        }

        if (entry.isFile) {
          const ext = entry.name.substring(entry.name.lastIndexOf('.')).toLowerCase()
          const assetPath = `${assetsDir}/${entry.name}`

          //
          let type: SkillAsset['type'] = 'other'
          if (['.json', '.yaml', '.yml', '.toml'].includes(ext)) {
            type = 'data'
          } else if (
            ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(ext)
          ) {
            type = 'image'
          } else if (
            ['.md', '.txt', '.template'].includes(ext) ||
            entry.name.includes('template')
          ) {
            type = 'template'
          }

          assets.push({
            name: entry.name,
            path: assetPath,
            type,
          })
        }
      }
    } catch (error) {
      console.error(`Failed: ${assetsDir}`, error)
    }

    return assets
  }

  /**
 * skill .md （ editing.md, pptxgenjs.md）
 * skill .md （ SKILL.md ）
 */
  private async loadRootMdFiles(
    skillDirPath: string,
    scope: SkillScope
  ): Promise<SkillReference[]> {
    const references: SkillReference[] = []

    try {
      let entries: DirEntry[]

      if (scope === 'global') {
        entries = await readDir(skillDirPath, { baseDir: BaseDirectory.AppData })
      } else {
        const options = await getFilePathOptions(skillDirPath)
        if (options.baseDir) {
          entries = await readDir(options.path, { baseDir: options.baseDir })
        } else {
          entries = await readDir(options.path)
        }
      }

      for (const entry of entries) {
        // .md ， SKILL.md
        if (
          entry.isFile &&
          entry.name.endsWith('.md') &&
          entry.name !== SKILL_FILE_NAME
        ) {
          references.push({
            name: entry.name, // "pptxgenjs.md", "editing.md"
            path: entry.name,
            description: `Additional reference file: ${entry.name}`,
          })
        }
      }
    } catch (error) {
      console.error(`[SkillManager] Root directory .md FileFailed: ${skillDirPath}`, error)
    }

    return references
  }

  // ========================================================================
  //
  // ========================================================================

  /**
 * Skill
 */
  registerSkill(skill: SkillContent): void {
    this.installedSkills.set(
      `${skill.metadata.scope}:${skill.metadata.id}`,
      skill
    )
    this.skills.set(skill.metadata.id, skill)
  }

  /**
 * Skill
 */
  unregisterSkill(skillId: string): void {
    this.skills.delete(skillId)
    for (const key of this.installedSkills.keys()) {
      if (key.endsWith(`:${skillId}`)) {
        this.installedSkills.delete(key)
      }
    }
    this.skillFiles.delete(skillId)
  }

  // ========================================================================
  // Skills
  // ========================================================================

  /**
 * Skills
 */
  getAllSkills(): SkillContent[] {
    return Array.from(this.skills.values())
  }

  /**
 * Skills， Skill Skill。
 */
  getAllInstalledSkills(): SkillContent[] {
    return Array.from(this.installedSkills.values())
  }

  /**
 * Skills
 */
  getSkillsByScope(scope: SkillScope): SkillContent[] {
    return this.getAllInstalledSkills().filter(
      (skill) => skill.metadata.scope === scope
    )
  }

  /**
 * Skills
 */
  async getEnabledSkills(): Promise<SkillContent[]> {
    return this.getAllSkills().filter(
      (skill) => skill.metadata.enabled !== false
    )
  }

  /**
 * Skills
 */
  getUserInvocableSkills(): SkillContent[] {
    return this.getAllSkills().filter(
      (skill) => skill.metadata.enabled !== false && skill.metadata.userInvocable !== false
    )
  }

  /**
 * ID Skill
 */
  getSkill(id: string): SkillContent | undefined {
    return this.skills.get(id)
  }

  /**
 * Skill 
 */
  hasSkill(id: string): boolean {
    return this.skills.has(id)
  }

  /**
 * Skill 
 */
  getSkillScripts(skillId: string): SkillScript[] {
    const skill = this.getSkill(skillId)
    return skill?.scripts || []
  }

  /**
 * Skill 
 */
  getSkillReferences(skillId: string): SkillReference[] {
    const skill = this.getSkill(skillId)
    return skill?.references || []
  }

  /**
 * Skill 
 */
  getSkillAssets(skillId: string): SkillAsset[] {
    const skill = this.getSkill(skillId)
    return skill?.assets || []
  }

  // ========================================================================
  //
  // ========================================================================

  /**
 * Skills
 *
 * @param userInput - 
 * @param maxResults - 
 * @returns Skills （）
 */
  async matchRelevantSkills(
    userInput: string,
    maxResults: number = 3
  ): Promise<SkillContent[]> {
    const enabledSkills = await this.getEnabledSkills()
    const scores: SkillMatchScore[] = []

    for (const skill of enabledSkills) {
      const score = this.calculateMatchScore(skill, userInput)
      if (score.score > 0) {
        scores.push(score)
      }
    }

    //
    scores.sort((a, b) => b.score - a.score)

    const result = scores
      .slice(0, maxResults)
      .map((score) => score.skill)

    return result
  }

  /**
 * Skill 
 */
  private calculateMatchScore(
    skill: SkillContent,
    userInput: string
  ): SkillMatchScore {
    const description = skill.metadata.description.toLowerCase()
    const input = userInput.toLowerCase()
    const reasons: string[] = []
    let score = 0

    //
    if (description.includes(input)) {
      score += 1
      reasons.push('Translated message')
    }

    //
    const keywords = this.extractKeywords(description)
    const matchedKeywords = keywords.filter((keyword) =>
      input.includes(keyword)
    )
    if (matchedKeywords.length > 0) {
      score += matchedKeywords.length * 0.5
      reasons.push(`${matchedKeywords.join(', ')}`)
    }

    // （）
    if (this.hasSemanticOverlap(description, input)) {
      score += 0.3
      reasons.push('Semantically related')
    }

    return {
      skill,
      score: Math.min(score, 1), // 0-1
      reasons,
    }
  }

  /**
 * 
 */
  private extractKeywords(description: string): string[] {
    const keywords: string[] = []

    // （）
    const quoteRegex = /[""""「」『』\[\]（）()](.+?)[""""「」『』\[\]（）()]/g
    let match
    while ((match = quoteRegex.exec(description)) !== null) {
      keywords.push(match[1].toLowerCase())
    }

    // "...""..."
    const triggerRegex = /当(?:.*?)?(.+?)(?:时使用|时调用|时)/gi
    let triggerMatch
    while ((triggerMatch = triggerRegex.exec(description)) !== null) {
      keywords.push(triggerMatch[1].toLowerCase())
    }

    // "..."
    const aboutRegex = /关于[""""「」『』\[\]（）()]?([^""""「」『』\[\]（）()\s]+)[""""「」『』\[\]】()]?的内容/g
    let aboutMatch
    while ((aboutMatch = aboutRegex.exec(description)) !== null) {
      keywords.push(aboutMatch[1].toLowerCase())
    }

    // （2-4）
    const chineseWords = description.match(/[\u4e00-\u9fa5]{2,4}/g) || []
    keywords.push(...chineseWords)

    //
    const englishWords = description.match(/[a-zA-Z]{2,}/g) || []
    keywords.push(...englishWords.map(w => w.toLowerCase()))

    return keywords
  }

  /**
 * 
 */
  private hasSemanticOverlap(text1: string, text2: string): boolean {
    const words1 = new Set(text1.split(/\s+/))
    const words2 = new Set(text2.split(/\s+/))

    let overlap = 0
    for (const word of words2) {
      if (words1.has(word)) {
        overlap++
      }
    }

    // 20%
    return overlap / words2.size >= 0.2
  }

  // ========================================================================
  //
  // ========================================================================

  /**
 * Skill 
 */
  validateSkill(content: string): { valid: boolean; errors: string[] } {
    try {
      const parsed = parseSkillFile(content)
      const validation = validateSkillYamlMetadata(parsed.metadata)

      return {
        valid: validation.valid,
        errors: validation.errors.map((e) => e.message),
      }
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : String(error)],
      }
    }
  }

  // ========================================================================
  //
  // ========================================================================

  /**
 * 
 */
  private async fileExists(
    path: string,
    scope: SkillScope
  ): Promise<boolean> {
    try {
      if (scope === 'global') {
        return await exists(path, { baseDir: BaseDirectory.AppData })
      } else {
        const options = await getFilePathOptions(path)
        if (options.baseDir) {
          return await exists(options.path, { baseDir: options.baseDir })
        }
        return await exists(options.path)
      }
    } catch {
      return false
    }
  }

  /**
 * 
 */
  private async directoryExists(
    path: string,
    scope: SkillScope
  ): Promise<boolean> {
    return this.fileExists(path, scope)
  }

  /**
 * Skill 
 */
  private async listSkillDirectories(
    baseDir: string,
    scope: SkillScope
  ): Promise<string[]> {
    const dirs: string[] = []

    try {
      let entries: DirEntry[]

      if (scope === 'global') {
        entries = await readDir(baseDir, { baseDir: BaseDirectory.AppData })
      } else {
        const options = await getFilePathOptions(baseDir)
        if (options.baseDir) {
          entries = await readDir(options.path, { baseDir: options.baseDir })
        } else {
          entries = await readDir(options.path)
        }
      }

      for (const entry of entries) {
        if (entry.isDirectory && !entry.name.startsWith('.')) {
          dirs.push(entry.name)
        }
      }
    } catch (error) {
      console.error(`Failed: ${baseDir}`, error)
    }

    return dirs
  }

  /**
 * 
 */
  private async readFileContent(
    path: string,
    scope: SkillScope
  ): Promise<string> {
    if (scope === 'global') {
      return await readTextFile(path, { baseDir: BaseDirectory.AppData })
    } else {
      const options = await getFilePathOptions(path)
      if (options.baseDir) {
        return await readTextFile(options.path, { baseDir: options.baseDir })
      }
      return await readTextFile(options.path)
    }
  }

  /**
 * Skill 
 */
  getSkillFileInfo(id: string): SkillFileInfo | undefined {
    return this.skillFiles.get(id)
  }

  /**
 * Skill 
 */
  getAllSkillFileInfo(): SkillFileInfo[] {
    return Array.from(this.skillFiles.values())
  }

  /**
   * Read one installed Skill resource through a logical path.
   *
   * Agent-facing callers must never resolve Skill resources through note
   * paths. Keeping this lookup inside the manager makes the installed Skill
   * package a separate, read-only namespace.
   */
  async readSkillResource(id: string, resourcePath: string): Promise<string> {
    const skill = this.skills.get(id)
    const fileInfo = this.skillFiles.get(id)
    if (!skill || !fileInfo) {
      throw new Error(`Skill not found: ${id}`)
    }

    const normalized = resourcePath.replace(/\\/g, '/').replace(/^\.\//, '')
    const segments = normalized.split('/')
    if (
      !normalized
      || normalized.startsWith('/')
      || /^[a-zA-Z]:\//.test(normalized)
      || segments.some(segment => !segment || segment === '.' || segment === '..')
    ) {
      throw new Error('Invalid Skill resource path')
    }

    if (normalized === 'SKILL.md') {
      return skill.instructions
    }

    const relativeToSkill = (storedPath: string) => {
      const normalizedStored = storedPath.replace(/\\/g, '/')
      const normalizedDirectory = fileInfo.directory.replace(/\\/g, '/').replace(/\/+$/, '')
      return normalizedStored.startsWith(`${normalizedDirectory}/`)
        ? normalizedStored.slice(normalizedDirectory.length + 1)
        : normalizedStored
    }

    const resources = [
      ...skill.scripts.map(script => ({ logicalPath: `scripts/${script.name}`, storedPath: script.path })),
      ...skill.references.map(reference => ({
        logicalPath: relativeToSkill(reference.path),
        storedPath: reference.path.includes('/')
          ? reference.path
          : `${fileInfo.directory}/${reference.path}`,
      })),
      ...skill.assets.map(asset => ({
        logicalPath: relativeToSkill(asset.path),
        storedPath: asset.path.includes('/')
          ? asset.path
          : `${fileInfo.directory}/${asset.path}`,
      })),
    ]
    const resource = resources.find(candidate => candidate.logicalPath === normalized)
    if (!resource) {
      throw new Error(`Skill resource is not registered: ${normalized}`)
    }

    const content = await this.readFileContent(resource.storedPath, skill.metadata.scope)
    const maxLength = 100_000
    return content.length > maxLength
      ? `${content.slice(0, maxLength)}\n\n[Resource truncated at ${maxLength} characters]`
      : content
  }
}

// ============================================================================
//
// ============================================================================

export const skillManager = new SkillManager()

// （）
export function resetSkillManager(): void {
  ;(skillManager as any).skills.clear()
  ;(skillManager as any).installedSkills.clear()
  ;(skillManager as any).skillFiles.clear()
  ;(skillManager as any).initialized = false
}
