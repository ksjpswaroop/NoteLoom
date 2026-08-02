"use client"

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  FileText,
  Package,
  Palette,
  type LucideIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"

import { getMarkListItemContent } from "@/app/core/main/mark/mark-list-item-content"
import {
  getMarkTypeIconClasses,
  MARK_TYPE_ICONS,
} from "@/app/core/main/mark/mark-type-meta"
import { Button } from "@/components/ui/button"
import { getAllMarks, type Mark } from "@/db/marks"
import { getAllMarkdownFiles, type MarkdownFile } from "@/lib/files"
import { cn } from "@/lib/utils"
import useCanvasStore from "@/stores/canvas"
import { useSkillsStore } from "@/stores/skills"
import type { CanvasProject } from "@/types/canvas"
import type { SkillMetadata } from "@/lib/skills/types"
import {
  CHAT_SLASH_COMMANDS,
  filterChatSlashCommands,
  resolveChatSlashPrompt,
} from "./chat-slash-commands"

export type ComposerMenuMode = "command" | "resource"

export interface ChatComposerMenuHandle {
  moveSelection: (direction: -1 | 1) => void
  selectCurrent: () => void
}

interface ChatComposerMenuProps {
  mode: ComposerMenuMode | null
  query: string
  onClose: () => void
  onCommandSelect: (prompt: string) => void
  onFileSelect: (file: MarkdownFile) => void
  onRecordSelect: (mark: Mark) => void
  onCanvasSelect: (project: CanvasProject) => void
  onSkillSelect: (skill: SkillMetadata) => void
}

interface ComposerMenuItem {
  key: string
  group: string
  label: string
  description: string
  searchText?: string
  slash?: string
  icon: LucideIcon
  iconClassName?: string
  meta?: string
  onSelect: () => void
}

const SELECTION_CLASS = "bg-[#3b82f6]/15 text-foreground ring-1 ring-inset ring-[#3b82f6]/40"

function normalizeSearchText(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[\\/._-]+/g, " ")
    .trim()
}

export const ChatComposerMenu = forwardRef<
  ChatComposerMenuHandle,
  ChatComposerMenuProps
>(function ChatComposerMenu({
  mode,
  query,
  onClose,
  onCommandSelect,
  onFileSelect,
  onRecordSelect,
  onCanvasSelect,
  onSkillSelect,
}, ref) {
  const t = useTranslations("record.chat.input.composerMenu")
  const projects = useCanvasStore(state => state.projects)
  const loadProjects = useCanvasStore(state => state.loadProjects)
  const skillsEnabled = useSkillsStore(state => state.enabled)
  const skills = useSkillsStore(state => state.skills)
  const skillsInitialized = useSkillsStore(state => state.initialized)
  const initSkills = useSkillsStore(state => state.initSkills)
  const refreshSkills = useSkillsStore(state => state.refreshSkills)
  const [files, setFiles] = useState<MarkdownFile[]>([])
  const [records, setRecords] = useState<Mark[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selectedItemRef = useRef<HTMLButtonElement>(null)
  const listboxId = "chat-composer-menu-listbox"

  useEffect(() => {
    if (mode !== "resource") return

    let active = true
    setLoading(true)

    const fileTask = getAllMarkdownFiles().then(nextFiles => {
      if (!active) return
      setFiles([...nextFiles].sort((left, right) =>
        left.relativePath.localeCompare(right.relativePath, undefined, { numeric: true })
      ))
    })
    const recordTask = getAllMarks().then(nextRecords => {
      if (!active) return
      setRecords(nextRecords.filter(record => record.deleted === 0).slice(0, 200))
    })
    const canvasTask = projects.length === 0 ? loadProjects() : Promise.resolve()

    void Promise.allSettled([fileTask, recordTask, canvasTask]).then(() => {
      if (active) setLoading(false)
    })

    return () => {
      active = false
    }
  }, [loadProjects, mode, projects.length])

  useEffect(() => {
    if (mode !== "command") return

    void (skillsInitialized ? refreshSkills() : initSkills())
  }, [initSkills, mode, refreshSkills, skillsInitialized])

  const items = useMemo<ComposerMenuItem[]>(() => {
    if (mode === "command") {
      const commands = filterChatSlashCommands(CHAT_SLASH_COMMANDS, query).map(command => ({
        key: `command:${command.id}`,
        group: command.group,
        label: command.label,
        description: command.description,
        slash: `/${command.id}`,
        searchText: [command.id, ...(command.aliases || [])].join(" "),
        icon: command.icon,
        onSelect: () => onCommandSelect(resolveChatSlashPrompt(command)),
      }))

      const skillQuery = normalizeSearchText(query)
      const skillTerms = skillQuery.split(/\s+/).filter(Boolean)
      const skillItems = (skillsEnabled ? skills : [])
        .filter(skill => skill.enabled !== false && skill.userInvocable !== false)
        .filter(skill => {
          if (skillTerms.length === 0) return true
          const haystack = normalizeSearchText(`${skill.name} ${skill.description}`)
          return skillTerms.every(term => haystack.includes(term))
        })
        .map(skill => ({
          key: `skill:${skill.id}`,
          group: t("skills.title"),
          label: skill.name,
          description: skill.description,
          icon: Package,
          meta: t(`skills.scope.${skill.scope}`),
          onSelect: () => onSkillSelect(skill),
        }))

      return [...commands, ...skillItems]
    }

    if (mode !== "resource") return []

    return [
      ...files.map(file => ({
        key: `file:${file.path}`,
        group: t("resources.files"),
        label: file.name,
        description: "",
        searchText: file.relativePath,
        icon: FileText,
        onSelect: () => onFileSelect(file),
      })),
      ...records.map(record => {
        const content = getMarkListItemContent(record)
        return {
          key: `record:${record.id}`,
          group: t("resources.records"),
          label: content.title || t("resources.untitledRecord"),
          description: content.preview || t("resources.recordFallback"),
          icon: MARK_TYPE_ICONS[record.type],
          iconClassName: getMarkTypeIconClasses(record.type),
          onSelect: () => onRecordSelect(record),
        }
      }),
      ...projects.map(project => ({
        key: `canvas:${project.id}`,
        group: t("resources.canvases"),
        label: project.title,
        description: t("resources.canvasSummary", {
          nodes: project.document.nodes.length,
          edges: project.document.edges.length,
        }),
        icon: Palette,
        onSelect: () => onCanvasSelect(project),
      })),
    ]
  }, [
    files,
    mode,
    onCanvasSelect,
    onCommandSelect,
    onFileSelect,
    onRecordSelect,
    onSkillSelect,
    projects,
    query,
    records,
    skills,
    skillsEnabled,
    t,
  ])

  const filteredItems = useMemo(() => {
    if (mode === "command") {
      // Commands and skills are already filtered above so slash aliases match reliably.
      return items
    }

    const queryTerms = normalizeSearchText(query).split(/\s+/).filter(Boolean)
    if (queryTerms.length === 0) return items

    return items.filter(item => {
      const searchableText = normalizeSearchText(
        `${item.label} ${item.description} ${item.searchText || ""}`
      )
      return queryTerms.every(term => searchableText.includes(term))
    })
  }, [items, mode, query])

  const groups = useMemo(
    () => Array.from(new Set(filteredItems.map(item => item.group))),
    [filteredItems]
  )

  useEffect(() => {
    setSelectedIndex(0)
  }, [mode, query])

  useEffect(() => {
    if (selectedIndex >= filteredItems.length) {
      setSelectedIndex(Math.max(0, filteredItems.length - 1))
    }
  }, [filteredItems.length, selectedIndex])

  useEffect(() => {
    selectedItemRef.current?.scrollIntoView({ block: "nearest" })
  }, [query, selectedIndex])

  function selectItem(item: ComposerMenuItem) {
    item.onSelect()
    onClose()
  }

  useImperativeHandle(ref, () => ({
    moveSelection(direction) {
      if (filteredItems.length === 0) return
      setSelectedIndex(current =>
        (current + direction + filteredItems.length) % filteredItems.length
      )
    },
    selectCurrent() {
      const item = filteredItems[selectedIndex]
      if (item) selectItem(item)
    },
  }), [filteredItems, onClose, selectedIndex])

  if (mode === null) return null

  const activeOptionId = filteredItems[selectedIndex]
    ? `${listboxId}-option-${selectedIndex}`
    : undefined

  return (
    <div
      id={listboxId}
      className="absolute inset-x-1 bottom-[calc(100%+0.375rem)] z-30 max-h-[min(22rem,46vh)] overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg"
      role="listbox"
      aria-label={mode === "command" ? t("commands.title") : t("resources.title")}
      aria-activedescendant={activeOptionId}
    >
      {loading && filteredItems.length === 0 ? (
        <div className="px-2 py-4 text-center text-xs text-muted-foreground">
          {t("loading")}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="px-2 py-4 text-center text-xs text-muted-foreground">
          {t("empty")}
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {groups.map(group => (
            <div key={group} role="group" aria-label={group} className="flex flex-col">
              <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                {group}
              </div>
              {filteredItems.map((item, index) => {
                if (item.group !== group) return null
                const Icon = item.icon
                const selected = selectedIndex === index
                const optionId = `${listboxId}-option-${index}`

                return (
                  <Button
                    key={item.key}
                    id={optionId}
                    ref={selected ? selectedItemRef : undefined}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-auto min-h-8 w-full justify-start rounded-lg px-2 py-1.5",
                      selected && SELECTION_CLASS
                    )}
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setSelectedIndex(index)}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => selectItem(item)}
                  >
                    <Icon
                      data-icon="inline-start"
                      className={cn("size-3.5 shrink-0", item.iconClassName)}
                    />
                    <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left">
                      <span className="flex w-full min-w-0 items-baseline gap-1.5">
                        {item.slash ? (
                          <span className="shrink-0 font-mono text-[11px] text-[#3b82f6]">
                            {item.slash}
                          </span>
                        ) : null}
                        <span className="truncate text-xs font-medium">
                          {item.label}
                        </span>
                        {item.meta ? (
                          <span className="ml-auto shrink-0 text-[11px] font-normal text-muted-foreground">
                            {item.meta}
                          </span>
                        ) : null}
                      </span>
                      {item.description ? (
                        <span className="w-full truncate text-[11px] font-normal text-muted-foreground">
                          {item.description}
                        </span>
                      ) : null}
                    </span>
                  </Button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

ChatComposerMenu.displayName = "ChatComposerMenu"
