import type { AgentRunStatus, AgentTraceEvent } from "@/lib/agent/types"

export const agentStatusText: Record<AgentRunStatus, string> = {
  idle: "Idle",
  analyzing_images: "Image",
  preparing_context: "Preparing context",
  thinking: "Thinking",
  calling_tool: "Running tool",
  waiting_approval: "Awaiting confirmation",
  applying_change: "Applying changes",
  recovering: "Restoring",
  steering: "Applying follow-up",
  completed: "Completed",
  stopped: "Stopped",
  failed: "Failed",
}

export function formatAgentToolName(name: string) {
  const attachmentToolNames: Record<string, string> = {
    attachment_list: "· Folder",
    attachment_read: "· File",
  }

  if (attachmentToolNames[name]) {
    return attachmentToolNames[name]
  }

  return name
    .replace(/^editor_/, "Editor · ")
    .replace(/^note_/, "Note · ")
    .replace(/^folder_/, "Folder · ")
    .replace(/^tag_/, "Tag · ")
    .replace(/^mark_/, "Record · ")
    .replace(/^memory_/, "Memory · ")
    .replace(/^skill_/, "Skill · ")
    .replace(/^mcp_/, "MCP · ")
    .replace(/^system_/, "System · ")
    .replace(/_/g, " ")
}

function truncateActivityTarget(value: string, maxLength = 48) {
  const normalized = value.trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength - 1)}…`
}

function getStringInput(input: Record<string, unknown> | undefined, key: string) {
  const value = input?.[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function getToolActivityTarget(event: AgentTraceEvent) {
  const input = event.input
  const query = getStringInput(input, "query")
  if (query) {
    return `“${truncateActivityTarget(query)}”`
  }

  if (event.toolName === "mcp_call_tool") {
    const mcpToolName = getStringInput(input, "toolName")
    if (mcpToolName) {
      return truncateActivityTarget(mcpToolName)
    }
  }

  const skillId = getStringInput(input, "skill_id")
  if (skillId) {
    return truncateActivityTarget(skillId)
  }

  const url = getStringInput(input, "url")
  if (url) {
    try {
      return new URL(url).hostname
    } catch {
      return truncateActivityTarget(url)
    }
  }

  for (const key of ["filePath", "fileName", "relativePath", "folderPath", "path"]) {
    const value = getStringInput(input, key)
    if (value) {
      return truncateActivityTarget(formatAgentTarget(value))
    }
  }

  for (const key of ["filePaths", "relativePaths", "folderPaths", "ids"]) {
    const value = input?.[key]
    if (Array.isArray(value) && value.length > 0) {
      return `${value.length}`
    }
  }

  return undefined
}

export function formatAgentToolActivity(event: AgentTraceEvent) {
  const action = event.title || (event.toolName ? formatAgentToolName(event.toolName) : "Running action")
  const target = getToolActivityTarget(event)
  const description = target ? `${action} · ${target}` : action

  if (event.status === "running") {
    return `${description}`
  }

  if (event.status === "error") {
    return `${description}Failed`
  }

  return description
}

export function formatAgentDuration(duration?: number) {
  if (duration === undefined) return ""
  if (duration < 1000) return `${duration}ms`
  return `${(duration / 1000).toFixed(1)}s`
}

export function formatAgentTarget(target: string) {
  const normalized = target.replace(/\\/g, "/")
  return normalized.split("/").filter(Boolean).pop() || target
}
