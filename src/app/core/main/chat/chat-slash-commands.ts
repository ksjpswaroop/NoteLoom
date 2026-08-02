import type { LucideIcon } from "lucide-react"
import {
  AudioLines,
  FileDown,
  FilePlus2,
  GitBranch,
  HelpCircle,
  Languages,
  ListTree,
  Network,
  PencilRuler,
  Search,
  Server,
  Sparkles,
  Table2,
  Timer,
  WandSparkles,
  Workflow,
} from "lucide-react"

export interface ChatSlashCommand {
  /** Primary slash token without the leading slash, e.g. "mindmap". */
  id: string
  /** Alternate tokens matched while filtering (without leading slash). */
  aliases?: readonly string[]
  label: string
  description: string
  prompt: string
  icon: LucideIcon
  group: "Capture" | "Diagrams" | "Research" | "Workspace" | "Writing"
}

export const CHAT_SLASH_COMMANDS: readonly ChatSlashCommand[] = [
  {
    id: "note",
    aliases: ["capture", "draft"],
    label: "Draft a note",
    description: "Turn selection or context into a Markdown note",
    prompt:
      "Draft a clear Markdown note from the current selection, linked context, or active file. Use headings, bullet points, and short sections. Ask only if a critical detail is missing.",
    icon: FilePlus2,
    group: "Capture",
  },
  {
    id: "capture",
    aliases: ["mark", "record"],
    label: "Capture a mark",
    description: "Save a concise mark or inbox item",
    prompt:
      "Capture the current selection or context as a concise mark: keep the key idea, source, and any action item. Suggest a short title and optional tags.",
    icon: Sparkles,
    group: "Capture",
  },
  {
    id: "voice",
    aliases: ["audio", "transcript"],
    label: "Voice notes",
    description: "Clean up or structure a voice transcription",
    prompt:
      "Help with voice-oriented capture: clean up the transcription (or guide me if none is attached), remove filler words, keep meaning, and organize it into a usable note with a title and bullet points.",
    icon: AudioLines,
    group: "Capture",
  },
  {
    id: "mindmap",
    aliases: ["mind", "map"],
    label: "Mind map",
    description: "Create a mind map on the canvas",
    prompt:
      "Create a mind map on the NoteLoom canvas for this topic. Use canvas_create_project with canvasType mindmap if needed, then canvas_create_diagram with diagramKind mindmap. Ask for the topic only if it is unclear.",
    icon: Network,
    group: "Diagrams",
  },
  {
    id: "flowchart",
    aliases: ["flow", "process"],
    label: "Flowchart",
    description: "Create a process flowchart on the canvas",
    prompt:
      "Create a flowchart on the NoteLoom canvas for this process. Use canvas_create_project with canvasType flowchart if needed, then canvas_create_diagram with diagramKind flowchart. Ask for the process only if it is unclear.",
    icon: Workflow,
    group: "Diagrams",
  },
  {
    id: "diagram",
    aliases: ["canvas", "architecture"],
    label: "Diagram",
    description: "Create a canvas diagram (architecture, sequence, etc.)",
    prompt:
      "Create a clear diagram on the NoteLoom canvas for this subject. Prefer canvas tools (canvas_create_project then canvas_create_diagram). Choose the best diagramKind (architecture, sequence, orgChart, stateDiagram, or generic). Ask which style only if ambiguous.",
    icon: GitBranch,
    group: "Diagrams",
  },
  {
    id: "timeline",
    aliases: ["schedule", "roadmap"],
    label: "Timeline",
    description: "Create a timeline or roadmap on the canvas",
    prompt:
      "Create a timeline or roadmap on the NoteLoom canvas. Use canvas_create_project with canvasType timeline if needed, then canvas_create_diagram with diagramKind timeline. Infer stages from the context when possible.",
    icon: Timer,
    group: "Diagrams",
  },
  {
    id: "er",
    aliases: ["erd", "entity", "schema"],
    label: "ER diagram",
    description: "Create an entity-relationship diagram",
    prompt:
      "Create an entity-relationship diagram on the NoteLoom canvas with canvas_create_diagram (diagramKind erDiagram). Infer entities and relationships from the context, or ask for the domain if needed.",
    icon: Table2,
    group: "Diagrams",
  },
  {
    id: "mermaid",
    aliases: ["mmd"],
    label: "Mermaid in note",
    description: "Insert a Mermaid diagram into the open note",
    prompt:
      "Add a Mermaid diagram to the current Markdown note using a fenced ```mermaid block. Prefer editor tools so TipTap can render it. Choose the right Mermaid type (flowchart, sequenceDiagram, mindmap, erDiagram, timeline, etc.) from the context.",
    icon: GitBranch,
    group: "Diagrams",
  },
  {
    id: "sketch",
    aliases: ["excalidraw", "draw", "whiteboard"],
    label: "Sketch",
    description: "Create or edit an Excalidraw sketch",
    prompt:
      "Create or update an Excalidraw sketch (.excalidraw) for this idea. Use excalidraw_create / excalidraw_update_elements with clear shapes and labels. Prefer a simple whiteboard layout over a formal flowchart.",
    icon: PencilRuler,
    group: "Diagrams",
  },
  {
    id: "search",
    aliases: ["web", "browse"],
    label: "Web search",
    description: "Research with web search and cite sources",
    prompt:
      "Research this with web_search (and web_read_page when a source needs detail). Summarize the findings clearly and cite the URLs you used:",
    icon: Search,
    group: "Research",
  },
  {
    id: "find",
    aliases: ["notesearch", "kb", "rag"],
    label: "Search notes",
    description: "Find answers in your knowledge base",
    prompt:
      "Search my NoteLoom notes and marks for relevant material, then answer based on what you find:",
    icon: Search,
    group: "Research",
  },
  {
    id: "mcp",
    aliases: ["tools", "servers"],
    label: "MCP tools",
    description: "List or use connected MCP servers",
    prompt:
      "List available MCP servers and tools with mcp_list_tools, then use the right MCP tool(s) for this request. Do not substitute note or editor tools if MCP is required:",
    icon: Server,
    group: "Research",
  },
  {
    id: "export",
    aliases: ["pdf", "docx", "download"],
    label: "Export",
    description: "Prepare content for export (Markdown, PDF, DOCX…)",
    prompt:
      "Help me prepare this note or content for export. Clean structure, fix formatting issues, and recommend the best export format (Markdown, PDF, DOCX, HTML, or image). If I name a format, optimize for that format.",
    icon: FileDown,
    group: "Workspace",
  },
  {
    id: "organize",
    aliases: ["sort", "inbox", "tidy"],
    label: "Organize",
    description: "Organize marks, notes, or tags",
    prompt:
      "Organize my recent marks and notes: group related items, suggest titles/tags/folders, and propose concrete file moves or updates I can approve. Prefer small, reversible steps.",
    icon: WandSparkles,
    group: "Workspace",
  },
  {
    id: "summarize",
    aliases: ["summary", "tldr"],
    label: "Summarize",
    description: "Extract key points and conclusions",
    prompt:
      "Summarize the following content and extract the key points and conclusions:",
    icon: ListTree,
    group: "Writing",
  },
  {
    id: "rewrite",
    aliases: ["polish", "improve"],
    label: "Polish",
    description: "Improve wording without changing meaning",
    prompt:
      "Polish the following content while preserving its meaning. Keep the same language unless I ask otherwise:",
    icon: WandSparkles,
    group: "Writing",
  },
  {
    id: "translate",
    aliases: ["english", "en"],
    label: "Translate to English",
    description: "Translate the content into clear English",
    prompt:
      "Translate the following content into clear, natural English. Preserve meaning, lists, and technical terms:",
    icon: Languages,
    group: "Writing",
  },
  {
    id: "help",
    aliases: ["commands", "?"],
    label: "Help",
    description: "List available chat slash commands",
    prompt: "", // filled dynamically
    icon: HelpCircle,
    group: "Workspace",
  },
]

export function getChatSlashCommandTokens(command: ChatSlashCommand): string[] {
  return [command.id, ...(command.aliases || [])]
}

export function buildChatSlashHelpPrompt(
  commands: readonly ChatSlashCommand[] = CHAT_SLASH_COMMANDS
): string {
  const lines = commands
    .filter(command => command.id !== "help")
    .map(command => {
      const aliases = (command.aliases || [])
        .map(alias => `/${alias}`)
        .join(", ")
      const aliasNote = aliases ? ` (aliases: ${aliases})` : ""
      return `- \`/${command.id}\` — ${command.label}: ${command.description}${aliasNote}`
    })

  return [
    "Here are the available chat slash commands in NoteLoom. Briefly explain which ones fit my current task, then wait for my choice:",
    "",
    ...lines,
  ].join("\n")
}

export function resolveChatSlashPrompt(command: ChatSlashCommand): string {
  if (command.id === "help") {
    return buildChatSlashHelpPrompt()
  }
  return command.prompt
}

export function filterChatSlashCommands(
  commands: readonly ChatSlashCommand[],
  query: string
): ChatSlashCommand[] {
  const normalized = query
    .toLocaleLowerCase()
    .replace(/^\/+/, "")
    .replace(/[\\/._-]+/g, " ")
    .trim()
  if (!normalized) return [...commands]

  const terms = normalized.split(/\s+/).filter(Boolean)

  return commands.filter(command => {
    const haystack = [
      command.id,
      ...(command.aliases || []),
      command.label,
      command.description,
      command.group,
      command.prompt,
    ]
      .join(" ")
      .toLocaleLowerCase()

    return terms.every(term =>
      haystack.includes(term)
      || getChatSlashCommandTokens(command).some(token => token.startsWith(term))
    )
  })
}
