/**
 * Skills 
 *
 * Skills AI ， AI 。
 * Agent Skills : https://agentskills.io/specification
 */

// ============================================================================
//
// ============================================================================

/**
 * Skill 
 */
export type SkillScope = 'global' | 'project'

/**
 * Skill 
 */
export type ScriptType = 'python' | 'bash' | 'javascript' | 'node' | 'shell'

/**
 * Skill 
 */
export interface SkillScript {
  name: string                  //
  path: string                  // (scripts/script-name.py)
  type: ScriptType              //
  sha256: string                // ，
  description?: string          //
}

/**
 * Skill 
 */
export interface SkillReference {
  name: string                  //
  path: string                  // (references/reference.md)
  description?: string          //
}

/**
 * Skill (assets/)
 */
export interface SkillAsset {
  name: string                  //
  path: string                  // (assets/template.json)
  type: 'template' | 'image' | 'data' | 'other'
  description?: string          //
}

/**
 * Skill ()
 */
export interface SkillMetadata {
  // ()
  id: string                    // (skill-name, )
  name: string                  // Skill (1-64, )
  description: string           // (1-1024, AI )

  //
  license?: string              //
  compatibility?: string        // (1-500)
  metadata?: Record<string, string>  //

  // ()
  version?: string              // ( metadata.version )
  author?: string               // ( metadata.author )

  //
  scope: SkillScope             // ：() ()

  // ()
  model?: string                //
  allowedTools?: string[]       // ()

  // ()
  userInvocable?: boolean       //

  // ()
  enabled?: boolean             //
  createdAt: number
  updatedAt: number

  //
  dependencies?: SkillDependency[]
}

/**
 * Skill 
 */
export interface SkillContent {
  metadata: SkillMetadata
  instructions: string          // Markdown (SKILL.md )

  //
  scripts: SkillScript[]        // scripts/
  references: SkillReference[]  // references/
  assets: SkillAsset[]          // assets/
}

// ============================================================================
//
// ============================================================================

/**
 * SKILL.md YAML ()
 */
export interface SkillYamlMetadata {
  //
  name: string
  description: string

  // ()
  license?: string
  compatibility?: string
  metadata?: Record<string, string>
  allowedTools?: string[] | string  //

  // ()
  version?: string
  author?: string
  model?: string
  userInvocable?: boolean

  //
  dependencies?: SkillDependency[]
}

/**
 * Skill 
 */
export interface SkillDependency {
  name: string           // ， "requests" "lodash"
  version?: string      // ， ">=2.0.0"（）
  manager: 'pip' | 'npm' | 'yarn' | 'pnpm'  //
}

/**
 * SKILL.md 
 */
export interface ParsedSkillFile {
  metadata: SkillYamlMetadata
  content: string               // Markdown （ YAML ）
  rawContent: string            //
}

// ============================================================================
//
// ============================================================================

/**
 * 
 */
export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
}

/**
 * 
 */
export interface ValidationError {
  field: string
  message: string
  severity: 'error'
}

/**
 * 
 */
export interface ValidationWarning {
  field: string
  message: string
  severity: 'warning'
}

// ============================================================================
//
// ============================================================================

/**
 * Skill 
 */
export interface SkillExecutionResult {
  success: boolean
  skillId: string
  result?: string
  error?: string
  toolsUsed: string[]
  scriptsUsed: string[]          //
  executionTime: number
}

/**
 * Skill 
 */
export interface SkillExecutionRecord {
  id: string
  skillId: string
  skillName: string
  userInput: string
  result: SkillExecutionResult
  timestamp: number
}

// ============================================================================
//
// ============================================================================

/**
 * Skill 
 */
export interface SkillFileInfo {
  id: string                    //
  directory: string             // Skill
  mainFile: string              // SKILL.md

  //
  hasScriptsDir: boolean        // scripts/
  hasReferencesDir: boolean     // references/
  hasAssetsDir: boolean         // assets/

  // (，)
  hasReferenceFile?: boolean    // REFERENCE.md
  hasExamplesFile?: boolean     // EXAMPLES.md
  hasKeywordsFile?: boolean     // KEYWORDS.md

  isValid: boolean              // Skill
  error?: string                //

  //
  scriptCount?: number          //
  referenceCount?: number       //
  assetCount?: number           //
}

// ============================================================================
//
// ============================================================================

/**
 * Skill 
 */
export interface SkillMatchScore {
  skill: SkillContent
  score: number                 // (0-1)
  reasons: string[]             //
}

// ============================================================================
//
// ============================================================================

/**
 * Skill 
 */
export const SKILL_FILE_NAME = 'SKILL.md'

/**
 * 
 */
export const SCRIPTS_DIR_NAME = 'scripts'
export const REFERENCES_DIR_NAME = 'references'
export const ASSETS_DIR_NAME = 'assets'

/**
 * ()
 * @deprecated references/ 
 */
export const REFERENCE_FILE_NAME = 'REFERENCE.md'
export const EXAMPLES_FILE_NAME = 'EXAMPLES.md'
export const KEYWORDS_FILE_NAME = 'KEYWORDS.md'

/**
 * Skills 
 */
export const SKILLS_DIR_NAME = 'skills'

/**
 * 
 */
export const DEFAULT_SKILL_VERSION = '1.0.0'
export const DEFAULT_SKILL_ENABLED = true
export const DEFAULT_USER_INVOCABLE = true

/**
 * 
 */
export const SCRIPT_EXTENSIONS: Record<ScriptType, string[]> = {
  python: ['.py'],
  bash: ['.sh', '.bash'],
  javascript: ['.js', '.mjs'],
  node: ['.js'],
  shell: ['.sh'],
}

/**
 * shebang 
 */
export const SCRIPT_SHEBANG: Record<ScriptType, string[]> = {
  python: ['#!/usr/bin/env python', '#!/usr/bin/python'],
  bash: ['#!/bin/bash', '#!/usr/bin/env bash'],
  javascript: ['#!/usr/bin/env node'],
  node: ['#!/usr/bin/env node'],
  shell: ['#!/bin/sh'],
}
