import { mcpServerManager } from './server-manager'
import { useMcpStore } from '@/stores/mcp'
import type { MCPTool, CallToolResult } from './types'

/**
 * 
 */
export function getSelectedServerTools(): Array<{
  serverId: string
  serverName: string
  tool: MCPTool
}> {
  const store = useMcpStore.getState()
  const result: Array<{ serverId: string; serverName: string; tool: MCPTool }> = []
  
  for (const server of store.servers) {
    if (server.enabled && store.selectedServerIds.includes(server.id)) {
      const tools = mcpServerManager.getServerTools(server.id)
      for (const tool of tools) {
        result.push({
          serverId: server.id,
          serverName: server.name,
          tool,
        })
      }
    }
  }
  
  return result
}

/**
 * ， OpenAI Function Calling 
 */
export function getOpenAIFunctions(selectedServerIds: string[]): any[] {
  const functions: any[] = []
  
  for (const serverId of selectedServerIds) {
    const tools = mcpServerManager.getServerTools(serverId)
    
    for (const tool of tools) {
      // OpenAI Function Calling
      functions.push({
        type: 'function',
        function: {
          name: `${serverId}__${tool.name}`, // ID
          description: tool.description || tool.name,
          parameters: tool.inputSchema || {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      })
    }
  }
  
  return functions
}

/**
 * 
 */
export function searchTools(query: string): Array<{
  serverId: string
  serverName: string
  tool: MCPTool
}> {
  const allTools = getSelectedServerTools()
  
  if (!query.trim()) {
    return allTools
  }
  
  const lowerQuery = query.toLowerCase()
  return allTools.filter(
    ({ tool }) =>
      tool.name.toLowerCase().includes(lowerQuery) ||
      tool.description?.toLowerCase().includes(lowerQuery)
  )
}

/**
 * 
 */
export async function callTool(
  serverId: string,
  toolName: string,
  args: any = {}
): Promise<CallToolResult> {
  return await mcpServerManager.callTool(serverId, toolName, args)
}

/**
 * 
 */
export function validateToolArgs(tool: MCPTool, args: any): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []
  const required = tool.inputSchema.required || []
  
  //
  for (const field of required) {
    if (!(field in args)) {
      errors.push(`Missing required parameter: ${field}`)
    }
  }
  
  // （）
  const properties = tool.inputSchema.properties || {}
  for (const key of Object.keys(args)) {
    if (!(key in properties)) {
      errors.push(`Unknown parameter: ${key}`)
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * 
 */
export function formatToolResult(result: CallToolResult): string {
  if (result.isError) {
    const errorText = result.content.find(content => content.type === 'text')?.text
    return `❌ Error: ${errorText || 'Unknown error'}`
  }
  
  const textContent = result.content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('\n')
  
  return textContent || 'Tool executed successfully'
}

/**
 * OpenAI Function Calling 
 */
export function toolToOpenAIFunction(tool: MCPTool) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.inputSchema,
    },
  }
}
