export async function createNewNoteFromEmptyState({
  setLeftSidebarTab,
  newFile,
}: {
  setLeftSidebarTab: (tab: 'files' | 'notes') => void | Promise<void>
  newFile: () => void | Promise<void>
}) {
  await setLeftSidebarTab('files')
  await newFile()
}

export const ONBOARDING_SAMPLE_RECORD = `This is my first record in NoteLoom.

I can capture scattered thoughts quickly without organizing them first.
Later I can turn these records into a proper note and keep editing.
If the draft feels rough, AI can help polish, rewrite, or highlight key points.
Finished notes stay as local Markdown files that are easy to find and manage.`

export async function startCreateRecordOnboardingStep({
  setLeftSidebarTab,
  openQuickRecord,
}: {
  setLeftSidebarTab: (tab: 'files' | 'notes') => void | Promise<void>
  openQuickRecord: (payload: { prefillText: string }) => void | Promise<void>
}) {
  await setLeftSidebarTab('notes')
  await openQuickRecord({ prefillText: ONBOARDING_SAMPLE_RECORD })
}

export function getOnboardingAgentPrompt({
  intro,
  requirements,
  outro,
}: {
  intro: string
  requirements: string[]
  outro: string
}) {
  return [intro, requirements.filter(Boolean).join('\n'), outro]
    .filter(Boolean)
    .join('\n\n')
}

export function getOnboardingSpotlightTarget(step: 'create-record' | 'organize-note' | 'ai-polish') {
  switch (step) {
    case 'create-record':
      return 'onboarding-target-record-toolbar'
    case 'organize-note':
      return 'onboarding-target-organize-notes'
    case 'ai-polish':
      return 'onboarding-target-chat-input'
  }
}

function isMarkdownPath(path: string) {
  return /\.(md|txt|markdown)$/i.test(path)
}

type OnboardingFileTreeNode = {
  name: string
  parent?: OnboardingFileTreeNode
  children?: OnboardingFileTreeNode[]
  isFile?: boolean
  isDirectory?: boolean
  isSymlink?: boolean
  isLocale?: boolean
  createdAt?: string
  modifiedAt?: string
}

function computedOnboardingPath(node: OnboardingFileTreeNode): string {
  const segments: string[] = []
  let current: OnboardingFileTreeNode | undefined = node

  while (current) {
    if (current.name) {
      segments.unshift(current.name)
    }
    current = current.parent
  }

  return segments.join('/')
}

function getPathPriority(path: string) {
  const name = path.split('/').pop() || path

  if (/^Organized_Note_\d+\.md$/i.test(name) || /^整理笔记_\d+\.md$/i.test(name)) {
    return 2
  }

  if (isMarkdownPath(path)) {
    return 1
  }

  return 0
}

function flattenFileTree(tree: OnboardingFileTreeNode[]): Array<{ path: string; modifiedAt?: string; createdAt?: string }> {
  return tree.flatMap((item) => {
    const currentPath = computedOnboardingPath(item)

    if (item.isFile) {
      return [{
        path: currentPath,
        modifiedAt: item.modifiedAt,
        createdAt: item.createdAt,
      }]
    }

    const childNodes = item.children
    if (!childNodes?.length) {
      return []
    }

    return flattenFileTree(childNodes)
  })
}

export function findRecentOnboardingFile({
  preferredPath,
  activeFilePath,
  openTabPaths,
  fileTree,
}: {
  preferredPath?: string
  activeFilePath?: string
  openTabPaths?: string[]
  fileTree: OnboardingFileTreeNode[]
}) {
  if (preferredPath && isMarkdownPath(preferredPath)) {
    return preferredPath
  }

  const explicitCandidates = [activeFilePath, ...(openTabPaths || [])]
    .filter((path): path is string => typeof path === 'string' && isMarkdownPath(path))

  const fileCandidates = flattenFileTree(fileTree)
    .filter((file) => isMarkdownPath(file.path))
    .sort((a, b) => {
      const priorityDiff = getPathPriority(b.path) - getPathPriority(a.path)
      if (priorityDiff !== 0) {
        return priorityDiff
      }

      const aModified = a.modifiedAt ? new Date(a.modifiedAt).getTime() : 0
      const bModified = b.modifiedAt ? new Date(b.modifiedAt).getTime() : 0
      if (aModified !== bModified) {
        return bModified - aModified
      }

      const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return bCreated - aCreated
    })
    .map((file) => file.path)

  return [...explicitCandidates, ...fileCandidates].find(Boolean) || ''
}
