"use client"
import * as React from "react"
import { AgentPlan } from "@/components/ui/agent-plan"
import { FileText, ChevronRight, Database, ExternalLink } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState } from "react"
import useArticleStore from "@/stores/article"
import { AgentRunTimeline } from "./agent-run-timeline"
import type { AgentRunStatus, AgentSkillSummary, AgentTraceEvent, ToolCall } from "@/lib/agent/types"

interface RagSourceDetail {
  filepath: string
  filename: string
  content: string
}

interface AgentPanelWithRagProps {
  // RAG
  ragSources?: string[]
  ragSourceDetails?: RagSourceDetail[]

  // Agent
  agentHistoryJson?: string

  // Agent （）
  isRunning?: boolean
  isThinking?: boolean
  currentThought?: string
  thoughtHistory?: string[]
  completedSteps?: Array<{
    thought: string
    action?: { tool: string; params: Record<string, any> }
    observation?: string
    duration?: number
  }>
  currentAction?: string
  currentObservation?: string
  toolCalls?: Array<{
    id: string
    toolName: string
    params: Record<string, any>
    result?: { success: boolean; message?: string; data?: any; error?: string }
    status: "pending" | "running" | "success" | "error"
    timestamp: number
  }>
  pendingConfirmation?: {
    toolName: string
    params: Record<string, any>
    originalContent?: string
    modifiedContent?: string
    filePath?: string
    from?: number
    to?: number
    canApproveForSession?: boolean
    sessionApprovalType?: "runtime-script"
    sessionApprovalKey?: string
  }
  confirmationHistory?: Array<{
    toolName: string
    params: Record<string, any>
    status: "pending" | "confirmed" | "cancelled"
    timestamp: number
    scope?: "once" | "conversation"
    sessionApprovalType?: "runtime-script"
    sessionApprovalKey?: string
  }>
  currentStepStartTime?: number
  onConfirm?: (scope?: "once" | "conversation") => void
  onCancel?: () => void
}

interface StructuredAgentHistory {
  runId?: string
  status?: AgentRunStatus
  traceEvents?: AgentTraceEvent[]
  toolCalls?: ToolCall[]
  loadedSkills?: AgentSkillSummary[]
}

/**
 * Agent - Agent 
 */
export function AgentPanelWithRag({
  ragSources = [],
  ragSourceDetails = [],
  agentHistoryJson,
  isRunning = false,
  isThinking = false,
  currentThought = "",
  thoughtHistory = [],
  completedSteps = [],
  currentAction = "",
  currentObservation = "",
  toolCalls = [],
  pendingConfirmation,
  confirmationHistory = [],
  currentStepStartTime,
  onConfirm,
  onCancel,
}: AgentPanelWithRagProps) {
  const t = useTranslations()
  const [isRagExpanded, setIsRagExpanded] = useState(false)
  const [expandedFiles, setExpandedFiles] = useState<string[]>([])
  const { setActiveFilePath, readArticle } = useArticleStore()

  const structuredHistory = React.useMemo<StructuredAgentHistory | null>(() => {
    if (!agentHistoryJson) {
      return null
    }

    try {
      const parsed = JSON.parse(agentHistoryJson) as StructuredAgentHistory
      return parsed && typeof parsed === "object" ? parsed : null
    } catch {
      return null
    }
  }, [agentHistoryJson])

  const hasStructuredHistory = Boolean(
    structuredHistory?.runId ||
    structuredHistory?.status ||
    structuredHistory?.traceEvents?.length
  )

  //
  const detailMap = React.useMemo(
    () => new Map(ragSourceDetails.map((d) => [d.filename, d])),
    [ragSourceDetails]
  )

  //
  const handleOpenFile = (e: React.MouseEvent, filepath: string) => {
    e.stopPropagation()
    setActiveFilePath(filepath)
    readArticle(filepath)
  }

  //
  const toggleFileExpansion = (filename: string) => {
    setExpandedFiles((prev) =>
      prev.includes(filename)
        ? prev.filter((f) => f !== filename)
        : [...prev, filename]
    )
  }

  // ： agentHistoryJson，；
  const mode: "live" | "history" = agentHistoryJson ? "history" : "live"

  // RAG Agent ，
  const hasRag = ragSources.length > 0
  const hasAgent = agentHistoryJson || isRunning || thoughtHistory.length > 0

  if (!hasRag && !hasAgent) {
    return null
  }

  if (hasStructuredHistory) {
    return (
      <AgentRunTimeline
        status={structuredHistory?.status || "completed"}
        isRunning={false}
        traceEvents={structuredHistory?.traceEvents || []}
        toolCalls={structuredHistory?.toolCalls || []}
        ragSources={ragSources}
        ragSourceDetails={ragSourceDetails}
        loadedSkills={structuredHistory?.loadedSkills || []}
      />
    )
  }

  return (
    <div className="w-full">
      <div className="overflow-hidden">
        <ul className="space-y-2">
          {/* */}
          {hasRag && (
            <>
              <li>
                <button
                  type="button"
                  className="group flex min-h-11 w-full items-center gap-2 py-2 text-left"
                  onClick={() => setIsRagExpanded(!isRagExpanded)}
                  aria-expanded={isRagExpanded}
                >
                  <div className="shrink-0">
                    <Database className="size-4.5 text-blue-500" />
                  </div>
                  <div className="flex min-w-0 grow items-center justify-between">
                    <span className="text-sm">
                      {t("record.chat.ragSources.label", { count: ragSources.length })}
                    </span>
                    <ChevronRight
                      className={`size-4 text-muted-foreground shrink-0 transition-transform ${
                        isRagExpanded ? "rotate-90" : ""
                      }`}
                    />
                  </div>
                </button>
              </li>

              {/* */}
              {isRagExpanded && ragSources.map((source) => {
                const hasDetail = detailMap.has(source)
                const detail = detailMap.get(source)
                const isFileExpanded = expandedFiles.includes(source)

                return (
                  <li key={source} className="mt-1">
                    <button
                      type="button"
                      className="group flex min-h-11 w-full items-center gap-2 py-1 text-left disabled:cursor-default"
                      onClick={() => hasDetail && toggleFileExpansion(source)}
                      disabled={!hasDetail}
                      aria-expanded={hasDetail ? isFileExpanded : undefined}
                    >
                      <div className="shrink-0">
                        <div className="size-4.5" />
                      </div>
                      <div className="shrink-0">
                        <FileText className="size-4 text-muted-foreground" />
                      </div>
                      <div className="flex min-w-0 grow items-center justify-between gap-2">
                        <span
                          className={`truncate text-sm ${
                            hasDetail
                              ? "text-foreground group-hover:text-primary transition-colors"
                              : "text-muted-foreground"
                          }`}
                        >
                          {source}
                        </span>
                        {hasDetail && (
                          <ChevronRight
                            className={`size-4 text-muted-foreground shrink-0 transition-transform ${
                              isFileExpanded ? "rotate-90" : ""
                            }`}
                          />
                        )}
                      </div>
                    </button>

                    {/* */}
                    {isFileExpanded && hasDetail && detail?.content && (
                      <div className="border-muted mt-1 mr-2 mb-1.5 ml-10">
                        <div className="text-muted-foreground border-foreground/20 border-l border-dashed pl-3 text-xs">
                          <div className="flex items-center justify-between gap-2 py-1">
                            <div className="flex items-center gap-2">
                              <Database className="size-3.5 text-blue-500 shrink-0" />
                              <span className="font-medium text-xs">{t('record.chat.agent.observation')}</span>
                            </div>
                            {detail?.filepath && (
                              <button
                                onClick={(e) => handleOpenFile(e, detail.filepath)}
                                className="shrink-0 flex items-center gap-1 text-xs text-primary hover:underline"
                                title={t("record.chat.ragSources.openFile", { defaultValue: "Open file" })}
                              >
                                <ExternalLink className="size-3" />
                                <span>{t('record.chat.ragSources.openFile')}</span>
                              </button>
                            )}
                          </div>
                          <p className="whitespace-pre-wrap wrap-break-word py-1 text-xs leading-relaxed">
                            {detail.content}
                          </p>
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </>
          )}

          {/* Agent - AgentPlan embedded */}
          {hasAgent && (
            <AgentPlan
              mode={mode}
              isRunning={isRunning}
              isThinking={isThinking}
              currentThought={currentThought}
              thoughtHistory={thoughtHistory}
              completedSteps={completedSteps}
              currentAction={currentAction}
              currentObservation={currentObservation}
              toolCalls={toolCalls}
              pendingConfirmation={pendingConfirmation}
              confirmationHistory={confirmationHistory}
              currentStepStartTime={currentStepStartTime}
              historyJson={agentHistoryJson}
              onConfirm={onConfirm}
              onCancel={onCancel}
              embedded={true}
            />
          )}
        </ul>
      </div>
    </div>
  )
}
