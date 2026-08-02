/**
 * Skill 
 *
 * Skill 。
 * Agent Skills : https://agentskills.io/specification
 */

import {
  SkillContent,
  SkillYamlMetadata,
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from './types'
import {
  isValidSkillId,
  isValidSkillName,
  isValidSkillDescription,
} from './parser'

// ============================================================================
//
// ============================================================================

/**
 * Skill YAML ()
 *
 * @param metadata - YAML 
 * @returns 
 */
export function validateSkillYamlMetadata(metadata: SkillYamlMetadata): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []

  // - name
  if (!metadata.name || metadata.name.trim().length === 0) {
    errors.push({
      field: 'name',
      message: 'name field cannot be empty',
      severity: 'error',
    })
  } else if (!isValidSkillName(metadata.name)) {
    errors.push({
      field: 'name',
      message: 'name must be 1–64 characters, lowercase letters, digits, and hyphens only; cannot start or end with a hyphen or contain consecutive hyphens',
      severity: 'error',
    })
  }

  // - description
  if (!metadata.description || metadata.description.trim().length === 0) {
    errors.push({
      field: 'description',
      message: 'description field cannot be empty',
      severity: 'error',
    })
  } else if (!isValidSkillDescription(metadata.description)) {
    errors.push({
      field: 'description',
      message: 'description must be 1–1024 characters',
      severity: 'error',
    })
  }

  // - license
  if (metadata.license) {
    if (metadata.license.length > 200) {
      warnings.push({
        field: 'license',
        message: 'license should not exceed 200 characters',
        severity: 'warning',
      })
    }
  }

  // - compatibility
  if (metadata.compatibility) {
    if (metadata.compatibility.length > 500) {
      errors.push({
        field: 'compatibility',
        message: 'compatibility cannot exceed 500 characters',
        severity: 'error',
      })
    }
  }

  // metadata
  if (metadata.metadata) {
    for (const [key, value] of Object.entries(metadata.metadata)) {
      if (key.length > 50) {
        warnings.push({
          field: 'metadata',
          message: `metadata key "${key}" is too long; keep it under 50 characters`,
          severity: 'warning',
        })
      }
      if (value.length > 500) {
        warnings.push({
          field: 'metadata',
          message: `metadata "${key}" value is too long; keep it under 500 characters`,
          severity: 'warning',
        })
      }
    }
  }

  // allowedTools ()
  if (metadata.allowedTools) {
    const tools = Array.isArray(metadata.allowedTools)
      ? metadata.allowedTools
      : typeof metadata.allowedTools === 'string'
        ? metadata.allowedTools.split(/\s+/).filter(v => v.length > 0)
        : []

    if (tools.length === 0) {
      warnings.push({
        field: 'allowedTools',
        message: 'allowedTools is empty; remove the field or add tools',
        severity: 'warning',
      })
    }

    //
    const invalidTools = tools.filter((tool) => !isValidToolName(tool))
    if (invalidTools.length > 0) {
      errors.push({
        field: 'allowedTools',
        message: `Invalid tool name: ${invalidTools.join(', ')}`,
        severity: 'error',
      })
    }
  }

  // ()
  if (metadata.version && !isValidVersion(metadata.version)) {
    warnings.push({
      field: 'version',
      message: 'Invalid version format; use semver (e.g. 1.0.0)',
      severity: 'warning',
    })
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Skill 
 *
 * @param skill - Skill 
 * @returns 
 */
export function validateSkillContent(skill: SkillContent): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []

  //
  const metadataResult = validateSkillYamlMetadata({
    name: skill.metadata.name,
    description: skill.metadata.description,
    license: skill.metadata.license,
    compatibility: skill.metadata.compatibility,
    metadata: skill.metadata.metadata,
    allowedTools: skill.metadata.allowedTools,
    version: skill.metadata.version,
    author: skill.metadata.author,
    model: skill.metadata.model,
    userInvocable: skill.metadata.userInvocable,
  })
  errors.push(...metadataResult.errors)
  warnings.push(...metadataResult.warnings)

  // ID
  if (!isValidSkillId(skill.metadata.id)) {
    errors.push({
      field: 'id',
      message: 'Invalid Skill ID format; it must match the directory name and the name field format rules',
      severity: 'error',
    })
  }

  // ID name ()
  if (skill.metadata.id !== skill.metadata.name) {
    warnings.push({
      field: 'id',
      message: 'Skill ID should match the name field (recommended by the official spec)',
      severity: 'warning',
    })
  }

  //
  if (!skill.instructions || skill.instructions.trim().length === 0) {
    errors.push({
      field: 'instructions',
      message: 'Instruction content cannot be empty',
      severity: 'error',
    })
  } else {
    //
    if (skill.instructions.length > 10000) {
      warnings.push({
        field: 'instructions',
        message: 'Instruction exceeds 10000 characters; move detailed docs to the references/ directory',
        severity: 'warning',
      })
    }

    if (skill.instructions.length < 50) {
      warnings.push({
        field: 'instructions',
        message: 'Instruction is too short; provide more detail',
        severity: 'warning',
      })
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Skill ID
 *
 * @param id - Skill ID
 * @returns 
 */
export function validateSkillId(id: string): boolean {
  return isValidSkillId(id)
}

// ============================================================================
//
// ============================================================================

/**
 * (semver)
 *
 * @param version - 
 * @returns 
 */
function isValidVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/.test(version)
}

/**
 * 
 *
 * @param toolName - 
 * @returns 
 */
function isValidToolName(toolName: string): boolean {
  // 、、、
  // : Bash, Read, git:*, jq:*
  return /^[a-zA-Z_][a-zA-Z0-9_:*]*$/.test(toolName)
}

// ============================================================================
//
// ============================================================================

/**
 * 
 *
 * @param result - 
 * @returns 
 */
export function formatValidationResult(result: ValidationResult): string {
  const lines: string[] = []

  if (result.valid) {
    lines.push('✓ Validation passed')
  } else {
    lines.push('✗ Validation failed')
  }

  if (result.errors.length > 0) {
    lines.push('\nError:')
    for (const error of result.errors) {
      lines.push(`  - ${error.field}: ${error.message}`)
    }
  }

  if (result.warnings.length > 0) {
    lines.push('\nWarning:')
    for (const warning of result.warnings) {
      lines.push(`  - ${warning.field}: ${warning.message}`)
    }
  }

  return lines.join('\n')
}

/**
 * 
 *
 * @param result - 
 * @returns 
 */
export function getValidationSummary(result: ValidationResult): string {
  if (result.valid) {
    return 'Validation passed'
  }

  const errorCount = result.errors.length
  const warningCount = result.warnings.length

  const parts: string[] = []
  if (errorCount > 0) {
    parts.push(`${errorCount} errors`)
  }
  if (warningCount > 0) {
    parts.push(`${warningCount} warnings`)
  }

  return `Validation failed: ${parts.join(', ')}`
}
