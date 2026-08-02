import { mcpIntegration } from './integration'
import { useMcpStore } from '@/stores/mcp'

/**
 * MCP
 * 
 */
export async function initMcp() {
  try {
    // MCP
    await useMcpStore.getState().initMcpData()
    
    // MCP （）
    await mcpIntegration.initialize()
    
    // MCP
  } catch {
    //
  }
}

/**
 * MCP 
 * 
 */
export async function cleanupMcp() {
  try {
    await mcpIntegration.cleanup()
    // MCP
  } catch {
    //
  }
}
