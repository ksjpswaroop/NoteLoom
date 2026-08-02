import {
  Sparkles,
  Quote,
  Bold,
  Highlighter,
  MoreHorizontal,
  Link2,
  Type,
  Trash2,
  Rows3,
  Columns3,
  AlignCenter,
  Italic,
  Underline,
  Strikethrough,
  Code,
  List,
  ListOrdered,
  CheckSquare,
  SquareCode,
} from 'lucide-react'

const ACTION_META = {
  ai: { label: 'AI', icon: Sparkles },
  bold: { label: 'Bold', icon: Bold },
  highlight: { label: 'Highlight', icon: Highlighter },
  more: { label: 'More', icon: MoreHorizontal },
  italic: { label: 'Italic', icon: Italic },
  underline: { label: 'Underline', icon: Underline },
  strike: { label: 'Strikethrough', icon: Strikethrough },
  code: { label: 'Inline code', icon: Code },
  blockquote: { label: 'Blockquote', icon: Quote },
  bulletList: { label: 'Bullet list', icon: List },
  orderedList: { label: 'Numbered list', icon: ListOrdered },
  taskList: { label: 'Task list', icon: CheckSquare },
  codeBlock: { label: 'Code block', icon: SquareCode },
  'image-src': { label: 'URL', icon: Link2 },
  'image-alt': { label: 'Description', icon: Type },
  'delete-image': { label: 'Delete', icon: Trash2 },
  'add-row': { label: 'Add row', icon: Rows3 },
  'add-column': { label: 'Add column', icon: Columns3 },
  align: { label: 'Align', icon: AlignCenter },
} as const

export function buildMobileEditorContextBarViewModel(actions: string[] = []) {
  return {
    showSummary: false,
    showActionText: false,
    hideScrollbar: true,
    buttonVariant: 'ghost' as const,
    buttonSize: 'icon' as const,
    items: actions
      .filter((action): action is keyof typeof ACTION_META => action in ACTION_META)
      .map((action) => ({
        action,
        ...ACTION_META[action],
      })),
  }
}
