import { mcpServerManager } from './server-manager'
import { useMcpStore } from '@/stores/mcp'
import { callTool } from './tools'
import type { CallToolResult } from './types'

/**
 * MCP 
 * MCP 
 */
export class MCPIntegration {
  private static instance: MCPIntegration
  
  private constructor() {}
  
  static getInstance(): MCPIntegration {
    if (!MCPIntegration.instance) {
      MCPIntegration.instance = new MCPIntegration()
    }
    return MCPIntegration.instance
  }
  
  /**
 * MCP
 * 
 */
  async initialize(): Promise<void> {
    const store = useMcpStore.getState()
    await mcpServerManager.connectEnabledServers(store.servers)
  }
  
  /**
 * AI 
 * AI 
 */
  async handleToolCall(
    toolName: string,
    args: any
  ): Promise<{
    success: boolean
    result?: CallToolResult
    error?: string
  }> {
    const store = useMcpStore.getState()
    
    //
    let targetServerId: string | null = null
    
    for (const serverId of store.selectedServerIds) {
      const tools = mcpServerManager.getServerTools(serverId)
      if (tools.some(t => t.name === toolName)) {
        targetServerId = serverId
        break
      }
    }
    
    if (!targetServerId) {
      return {
        success: false,
        error: `Tool ${toolName} not found in selected servers`,
      }
    }
    
    try {
      const result = await callTool(targetServerId, toolName, args)
      return {
        success: !result.isError,
        result,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
  
  /**
 * 
 */
  async cleanup(): Promise<void> {
    await mcpServerManager.disconnectAll()
  }
}

//
export const mcpIntegration = MCPIntegration.getInstance()
