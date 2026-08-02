import { mcpServerManager } from '@/lib/mcp/server-manager'
import { useMcpStore } from '@/stores/mcp'
import { agentToolRegistry } from '../tool-registry'
import type { AgentTool } from '../types'

export function getAllTools(): AgentTool[] {
  return agentToolRegistry.listTools()
}

export async function getAllToolsAsync(): Promise<AgentTool[]> {
  return agentToolRegistry.listTools()
}

export function getAllToolsSync(): AgentTool[] {
  return agentToolRegistry.listTools()
}

/**
 * Ensure selected, enabled MCP servers are connected before an agent turn.
 * Tools are resolved live from the MCP store/catalog — this only repairs connections.
 */
export async function reloadMcpTools(): Promise<void> {
  const store = useMcpStore.getState()
  await store.initMcpData()

  const latest = useMcpStore.getState()
  for (const serverId of latest.selectedServerIds) {
    const server = latest.servers.find((entry) => entry.id === serverId)
    if (!server?.enabled) continue

    const status = latest.getServerState(serverId)?.status
    if (status === 'connected' || status === 'connecting') continue

    try {
      await mcpServerManager.connectServer(server)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[MCP] Failed to connect selected server "${server.name}":`, message)
    }
  }
}

export function getToolByName(name: string): AgentTool | undefined {
  return agentToolRegistry.getTool(name)
}

export function getToolsByCategory(category: AgentTool['category']): AgentTool[] {
  return agentToolRegistry.listTools().filter((tool) => tool.category === category)
}

export function getToolDescriptions(): string {
  return agentToolRegistry.listTools().map((tool) => {
    return `### ${tool.name}
${tool.title}
${tool.description}
Category: ${tool.category}
Risk: ${tool.risk}`
  }).join('\n\n')
}

export * from '../tool-registry'
export * from './note-tools'
export * from './chat-tools'
export * from './tag-tools'
export * from './mark-tools'
export * from './folder-tools'
export * from './system-tools'
export * from './memory-tools'
export * from './editor-tools'
export * from './midscene-tools'
