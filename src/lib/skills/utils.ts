/**
 * Skills 
 *
 * Skills 
 * Agent Skills : https://agentskills.io/specification
 */

import {
  SKILLS_DIR_NAME,
  SCRIPTS_DIR_NAME,
  REFERENCES_DIR_NAME,
  ASSETS_DIR_NAME,
  SKILL_FILE_NAME,
} from './types'

/**
 * Skills 
 */
export function isSkillsFolder(folderName: string): boolean {
  return folderName === SKILLS_DIR_NAME
}

/**
 * Skills 
 */
export function isInSkillsFolder(path: string): boolean {
  const normalizedPath = path.replace(/\\/g, '/')
  return (
    normalizedPath.includes(`/${SKILLS_DIR_NAME}/`) ||
    normalizedPath.startsWith(`${SKILLS_DIR_NAME}/`)
  )
}

/**
 * Skill (scripts/, references/, assets/)
 */
export function isInSkillSubdirectory(path: string): {
  inSkill: boolean
  skillId: string | null
  subdirectory: 'scripts' | 'references' | 'assets' | null
} {
  const normalizedPath = path.replace(/\\/g, '/')

  // scripts/
  const scriptsMatch = normalizedPath.match(
    new RegExp(`${SKILLS_DIR_NAME}/([^/]+)/${SCRIPTS_DIR_NAME}/`)
  )
  if (scriptsMatch) {
    return {
      inSkill: true,
      skillId: scriptsMatch[1],
      subdirectory: 'scripts',
    }
  }

  // references/
  const referencesMatch = normalizedPath.match(
    new RegExp(`${SKILLS_DIR_NAME}/([^/]+)/${REFERENCES_DIR_NAME}/`)
  )
  if (referencesMatch) {
    return {
      inSkill: true,
      skillId: referencesMatch[1],
      subdirectory: 'references',
    }
  }

  // assets/
  const assetsMatch = normalizedPath.match(
    new RegExp(`${SKILLS_DIR_NAME}/([^/]+)/${ASSETS_DIR_NAME}/`)
  )
  if (assetsMatch) {
    return {
      inSkill: true,
      skillId: assetsMatch[1],
      subdirectory: 'assets',
    }
  }

  return {
    inSkill: false,
    skillId: null,
    subdirectory: null,
  }
}

/**
 * Skills 
 */
export function getSkillsFolderIcon(): string {
  return 'Sparkles'  // lucide-react
}

/**
 * 
 */
export function shouldHideKnowledgeBaseOptions(folderName: string, filePath: string): boolean {
  return isSkillsFolder(folderName) || isInSkillsFolder(filePath)
}

/**
 * 
 */
export function filterKnowledgeBaseMenuItems(
  menuItems: any[],
  folderName: string,
  filePath: string
): any[] {
  if (!shouldHideKnowledgeBaseOptions(folderName, filePath)) {
    return menuItems
  }

  //
  return menuItems.filter((item: any) => {
    const itemId = item.props?.id || item.id || ''
    return !itemId.includes('knowledge-base')
  })
}

/**
 * Skill ID 
 * : "skills/code-reviewer" -> "code-reviewer"
 */
export function extractSkillIdFromPath(path: string): string | null {
  const normalizedPath = path.replace(/\\/g, '/')

  // skills
  const skillsFolderPattern = new RegExp(
    `${SKILLS_DIR_NAME}/([^/]+)`
  )
  const match = normalizedPath.match(skillsFolderPattern)

  if (match && match[1]) {
    return match[1]
  }

  return null
}

/**
 * Skill 
 * : "skills/code-reviewer" -> true
 * "skills" -> false
 * "other/code-reviewer" -> false
 */
export function isSkillSubfolder(path: string): boolean {
  return extractSkillIdFromPath(path) !== null
}

/**
 * SKILL.md
 */
export function isSkillFile(fileName: string): boolean {
  return fileName === SKILL_FILE_NAME
}

/**
 * Skill 
 * Skill 
 */
export function getSkillDirectoryStructure(): {
  description: string
  structure: Record<string, { description: string; required: boolean }>
} {
  return {
    description: 'Agent Skills ( )',
    structure: {
      [SKILL_FILE_NAME]: {
        description: 'Skill File ( )',
        required: true,
      },
      [SCRIPTS_DIR_NAME + '/']: {
        description: '( )',
        required: false,
      },
      [REFERENCES_DIR_NAME + '/']: {
        description: '( )',
        required: false,
      },
      [ASSETS_DIR_NAME + '/']: {
        description: '( )',
        required: false,
      },
    },
  }
}

/**
 * Skill 
 */
export function formatSkillList(skills: Array<{ id: string; name: string; description: string }>): string {
  if (skills.length === 0) {
    return 'Skills'
  }

  const lines: string[] = [`Skills (${skills.length} )`, '']

  for (const skill of skills) {
    lines.push(`- ${skill.name}`)
    lines.push(`  ${skill.description}`)
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Skill 
 * 
 */
export function validateSkillDirectoryStructure(files: string[]): {
  valid: boolean
  hasSkillFile: boolean
  hasScriptsDir: boolean
  hasReferencesDir: boolean
  hasAssetsDir: boolean
  warnings: string[]
} {
  const warnings: string[] = []

  //
  const hasSkillFile = files.some(f => f.endsWith(SKILL_FILE_NAME))

  //
  const hasScriptsDir = files.some(f => f.includes(`${SCRIPTS_DIR_NAME}/`))
  const hasReferencesDir = files.some(f => f.includes(`${REFERENCES_DIR_NAME}/`))
  const hasAssetsDir = files.some(f => f.includes(`${ASSETS_DIR_NAME}/`))

  // ()
  const hasOldReferenceFile = files.some(f => f.endsWith('/REFERENCE.md'))
  const hasOldExamplesFile = files.some(f => f.endsWith('/EXAMPLES.md'))
  const hasOldKeywordsFile = files.some(f => f.endsWith('/KEYWORDS.md'))

  if (hasOldReferenceFile) {
    warnings.push(
      'Format REFERENCE.md File， references/'
    )
  }

  if (hasOldExamplesFile) {
    warnings.push(
      'Format EXAMPLES.md File， references/'
    )
  }

  if (hasOldKeywordsFile) {
    warnings.push(
      'Format KEYWORDS.md File， SKILL.md references/'
    )
  }

  return {
    valid: hasSkillFile,
    hasSkillFile,
    hasScriptsDir,
    hasReferencesDir,
    hasAssetsDir,
    warnings,
  }
}

/**
 * Skill ()
 * 
 */
export function getMigrationGuide(): {
  title: string
  description: string
  steps: Array<{ from: string; to: string; description: string }>
} {
  return {
    title: 'Skill',
    description: 'Format Skill Format',
    steps: [
      {
        from: 'REFERENCE.md',
        to: 'references/REFERENCE.md',
        description: 'references/',
      },
      {
        from: 'EXAMPLES.md',
        to: 'references/EXAMPLES.md',
        description: 'references/',
      },
      {
        from: 'KEYWORDS.md',
        to: 'SKILL.md references/KEYWORDS.md',
        description: 'SKILL.md references/',
      },
      {
        from: 'None',
        to: 'scripts/',
        description: 'scripts/',
      },
      {
        from: 'None',
        to: 'assets/',
        description: 'assets/ 、Image',
      },
    ],
  }
}

/**
 * Skill ( Skill)
 */
export function getSkillTemplate(skillName: string, description: string): string {
  return `---
name: ${skillName}
description: ${description}
---
# ${skillName}

Add your skill instructions here.

## When to use

Use this skill when...

## Instructions

1. First step
2. Second step
3. etc.

## Notes

Add any additional notes here.
`
}
