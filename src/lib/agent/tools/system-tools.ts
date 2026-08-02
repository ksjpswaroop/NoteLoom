import { Tool, ToolResult } from '../types'
import { skillManager } from '@/lib/skills'
import { executeSkillRuntime, installSkillPythonDependencies } from '@/lib/skills/runtime'
import useArticleStore from '@/stores/article'

/**
 * Skill 
 * AI Skill 
 */
export const selectSkillTool: Tool = {
  name: 'select_skill',
  description: 'Select one or more Skills to guide task execution. On the first iteration, select the most relevant Skills based on the user task. After selection, complete Skill instructions will be provided in subsequent iterations.',
  category: 'system',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'skill_ids',
      type: 'array',
      description: 'List of Skill IDs to select. Choose the most relevant Skills from the available Skills. You can check the ID field in the Skills list.',
      required: true,
    },
  ],
  execute: async (params: Record<string, any>): Promise<ToolResult> => {
    try {
      const { skill_ids } = params

      if (!Array.isArray(skill_ids)) {
        return {
          success: false,
          error: 'skill_ids must be an array',
        }
      }

      // Skill ID
      const validSkills: string[] = []
      const invalidSkills: string[] = []

      for (const skillId of skill_ids) {
        const skill = skillManager.getSkill(skillId)
        if (skill) {
          validSkills.push(skillId)
        } else {
          invalidSkills.push(skillId)
        }
      }

      if (invalidSkills.length > 0) {
        return {
          success: false,
          error: `Invalid Skill ID: ${invalidSkills.join(', ')}`,
        }
      }

      if (validSkills.length === 0) {
        return {
          success: false,
          error: 'No valid Skill selected',
        }
      }

      return {
        success: true,
        data: {
          selected_skills: validSkills,
          count: validSkills.length,
        },
        message: `Selected ${validSkills.length} Skills: ${validSkills.join(', ')}. Full instructions for these Skills will be provided in later steps.`,
      }
    } catch (error) {
      console.error('[select_skill] Execution failed', {
        error: String(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `Failed to select Skill: ${error}`,
      }
    }
  },
}

/**
 * Skill 
 * AI Skill （ KEYWORDS.md、EXAMPLES.md ）
 * .md （ editing.md, pptxgenjs.md）
 */
export const loadSkillContentTool: Tool = {
  name: 'load_skill_content',
  description: 'Get the support file content for the specified Skill. Supports standard files (KEYWORDS.md, EXAMPLES.md, REFERENCE.md) and custom root-level .md files (e.g., editing.md, pptxgenjs.md). These files contain detailed style guides, keyword lists, and usage examples to help better apply the Skill.',
  category: 'system',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'skill_id',
      type: 'string',
      description: 'Skill ID, e.g., "style-detector"',
      required: true,
    },
    {
      name: 'file_type',
      type: 'string',
      description: 'File type or filename to load: supports "keywords" (KEYWORDS.md), "examples" (EXAMPLES.md), "reference" (REFERENCE.md), or a specific filename like "editing.md", "pptxgenjs.md". If not specified, returns all available support file content.',
      required: false,
    },
  ],
  execute: async (params: Record<string, any>): Promise<ToolResult> => {
    try {
      const { skill_id, file_type } = params

      const skill = skillManager.getSkill(skill_id)
      if (!skill) {
        return {
          success: false,
          error: `Skill not found: ${skill_id}`,
        }
      }

      // Skill
      const fileInfo = skillManager.getSkillFileInfo(skill_id)
      if (!fileInfo) {
        return {
          success: false,
          error: `Unable to get Skill file info: ${skill_id}`,
        }
      }

      const results: Record<string, string> = {}

      //
      const standardTypeMapping: Record<string, string> = {
        keywords: 'KEYWORDS.md',
        examples: 'EXAMPLES.md',
        reference: 'REFERENCE.md',
      }

      //
      const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
      const { getFilePathOptions } = await import('@/lib/workspace')
      const { exists } = await import('@tauri-apps/plugin-fs')

      // ：
      const readFile = async (fileName: string, filePath: string): Promise<boolean> => {
        let fileExists = false
        if (skill.metadata.scope === 'global') {
          fileExists = await exists(filePath, { baseDir: BaseDirectory.AppData })
          if (fileExists) {
            try {
              results[fileName] = await readTextFile(filePath, { baseDir: BaseDirectory.AppData })
              return true
            } catch (error) {
              console.error(`[load_skill_content] Failed to read file: ${filePath}`, error)
            }
          }
        } else {
          const options = await getFilePathOptions(filePath)
          fileExists = options.baseDir
            ? await exists(options.path, { baseDir: options.baseDir })
            : await exists(options.path)
          if (fileExists) {
            try {
              if (options.baseDir) {
                results[fileName] = await readTextFile(options.path, { baseDir: options.baseDir })
              } else {
                results[fileName] = await readTextFile(options.path)
              }
              return true
            } catch (error) {
              console.error(`[load_skill_content] Failed to read file: ${filePath}`, error)
            }
          }
        }
        return false
      }

      if (file_type) {
        // file_type，
        const fileName = file_type

        //
        const standardFile = standardTypeMapping[file_type]
        if (standardFile) {
          const filePath = `${fileInfo.directory}/${standardFile}`
          await readFile(file_type, filePath)
        } else {
          // .md （ editing.md, pptxgenjs.md）
          const filePath = `${fileInfo.directory}/${fileName}`
          await readFile(fileName, filePath)
        }
      } else {
        // file_type，
        // 1.
        for (const [type, fileName] of Object.entries(standardTypeMapping)) {
          const filePath = `${fileInfo.directory}/${fileName}`
          await readFile(type, filePath)
        }

        // 2. Skill.references .md
        // references rootMdFiles path （）
        for (const ref of skill.references) {
          // .md （path ）
          if (!ref.path.includes('/') && ref.path.endsWith('.md') && ref.path !== 'SKILL.md') {
            //
            const alreadyLoaded = Object.values(standardTypeMapping).includes(ref.path)
            if (!alreadyLoaded) {
              const filePath = `${fileInfo.directory}/${ref.path}`
              await readFile(ref.name, filePath)
            }
          }
        }
      }

      if (Object.keys(results).length === 0) {
        return {
          success: true,
          data: {
            skill_id,
            available_files: skill.references.map(r => r.name),
            message: 'This Skill has no extra support files; everything is in the main Skill file.',
          },
          message: `Skill "${skill_id}" has no extra support files. Everything needed is in the main Skill instructions.`,
        }
      }

      const loadedFiles = Object.keys(results)
      const totalLength = Object.values(results).reduce((sum, content) => sum + content.length, 0)

      return {
        success: true,
        data: {
          skill_id,
          loaded_files: loadedFiles,
          files: results,
          total_length: totalLength,
        },
        message: `Successfully loaded ${loadedFiles.length} support files (${loadedFiles.join(', ')}), ${totalLength} characters total. This content will help you apply the ${skill_id} Skill.`,
      }
    } catch (error) {
      console.error('[load_skill_content] Execution failed', {
        error: String(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `Failed to load Skill content: ${error}`,
      }
    }
  },
}

/**
 * Skill 
 * Skill scripts/ 。
 */
export const executeSkillScriptTool: Tool = {
  name: 'execute_skill_script',
  description: `Execute one registered script from a loaded Skill.

- script_id must exactly match an entry shown under the Skill's Available Scripts list.
- Arbitrary commands, inline code, modules, absolute script paths, and generated runtime scripts are not supported.
- Pass only data arguments needed by the registered script.
- User-visible files must be written to the SKILL_OUTPUT_DIR environment variable.`,
  category: 'system',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'skill_id',
      type: 'string',
      description: 'The ID of the Skill (e.g., "pptx", "pdf", "weekly")',
      required: true,
    },
    {
      name: 'script_id',
      type: 'string',
      description: 'Registered script ID from the Skill Available Scripts list, e.g. "thumbnail.py" or "office/unpack.py".',
      required: true,
    },
    {
      name: 'args',
      type: 'array',
      description: 'Data arguments passed to the registered script. Maximum 20 items. Do not include an interpreter or script path.',
      required: false,
    },
    {
      name: 'arguments',
      type: 'array',
      description: 'Alias for args. Prefer args; this field is accepted for compatibility with models that emit "arguments".',
      required: false,
    },
    {
      name: 'timeout',
      type: 'number',
      description: 'Timeout in milliseconds for script execution. Default is 60000ms (1 minute). Maximum is 300000ms (5 minutes).',
      required: false,
    },
  ],
  execute: async (params: Record<string, any>): Promise<ToolResult> => executeRegisteredSkillScript(params),
}

export const installSkillPythonDependenciesTool: Tool = {
  name: 'install_skill_python_dependencies',
  description: `Create or update this Skill's isolated Python environment with explicitly named PyPI packages.

- Use only after a registered Python script reports a missing dependency or the Skill explicitly documents it.
- Never guess packages from arbitrary stderr and never call this tool automatically.
- URLs, local paths, flags, environment markers, and source distributions are rejected.
- Every invocation requires user confirmation.`,
  category: 'system',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'skill_id',
      type: 'string',
      description: 'The installed Skill ID whose isolated Python environment will be updated.',
      required: true,
    },
    {
      name: 'packages',
      type: 'array',
      description: 'Exact PyPI distribution specs, for example ["pypdf>=5", "Pillow"]. Maximum 20.',
      required: true,
    },
  ],
  execute: async (params: Record<string, any>): Promise<ToolResult> => installSkillDependencies(params),
}

export async function installSkillDependencies(
  params: Record<string, any>,
  signal?: AbortSignal
): Promise<ToolResult> {
  const skillId = typeof params.skill_id === 'string' ? params.skill_id : ''
  const packages = Array.isArray(params.packages) ? params.packages.map(String) : []
  if (!skillId || !skillManager.getSkill(skillId)) {
    return { success: false, error: 'Invalid skill_id: Skill is not installed' }
  }
  if (packages.length === 0 || packages.length > 20) {
    return { success: false, error: 'packages must contain between 1 and 20 PyPI package specs' }
  }
  try {
    const result = await installSkillPythonDependencies(skillId, packages, signal)
    return {
      success: true,
      message: `Prepared isolated Python ${result.version} environment for Skill "${skillId}". Installed: ${result.packages.join(', ')}.`,
      data: result,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function executeRegisteredSkillScript(
  params: Record<string, any>,
  signal?: AbortSignal
): Promise<ToolResult> {
    try {
      const { skill_id, script_id, timeout } = params
      const rawArgs = Array.isArray(params.args)
        ? params.args
        : Array.isArray(params.arguments)
          ? params.arguments
          : []
      const args = rawArgs.map((arg) => String(arg))

      if (!skill_id || typeof skill_id !== 'string') {
        return {
          success: false,
          error: 'Invalid skill_id: must be a non-empty string',
        }
      }

      if (!script_id || typeof script_id !== 'string') {
        return {
          success: false,
          error: 'Invalid script_id: must identify a registered Skill script',
        }
      }

      const outcome = await executeSkillRuntime({
        skillId: skill_id,
        scriptId: script_id,
        args,
        timeout,
        signal,
      })

      if (outcome.success && Array.isArray(outcome.data?.output_files) && outcome.data.output_files.length > 0) {
        const articleStore = useArticleStore.getState()
        let insertedAny = false

        for (const outputFile of outcome.data.output_files) {
          const inserted = articleStore.insertLocalEntry(outputFile, false)
          insertedAny = insertedAny || inserted
          await articleStore.ensurePathExpanded(outputFile)
        }

        if (!insertedAny) {
          await articleStore.loadFileTree()
        }
      }

      return outcome
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      console.error('[execute_skill_script] Execution error', {
        error: errorMessage,
        errorStack: error instanceof Error ? error.stack : undefined,
      })

      return {
        success: false,
        error: `Script execution error: ${errorMessage}`,
      }
    }
}

export const systemTools: Tool[] = [
  selectSkillTool,
  loadSkillContentTool,
  executeSkillScriptTool,
  installSkillPythonDependenciesTool,
]
