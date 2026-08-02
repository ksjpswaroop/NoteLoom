import { mcpIntegration } from './integration'
import { useMcpStore } from '@/stores/mcp'

/**
 * MCP
 * 
 */
export async function initMcp() {
  try {
    await useMcpStore.getState().initMcpData()
    // Only connects servers the user has configured and left enabled.
    await mcpIntegration.initialize()
  } catch (error) {
    console.error('[MCP] Failed to initialize MCP on launch:', error)
  }
}

/**
 * Disconnect all MCP servers (e.g. app teardown).
 */
export async function cleanupMcp() {
  try {
    await mcpIntegration.cleanup()
  } catch (error) {
    console.error('[MCP] Failed to clean up MCP connections:', error)
  }
}
