import { copyFile, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions } from '@/lib/workspace'
import useArticleStore from '@/stores/article'
import emitter from '@/lib/emitter'

export async function importMidsceneNoteToWorkspace(options: {
  notePath: string
  noteFileName: string
  steps?: Array<{ screenshotPath?: string; screenshotRelativePath?: string }>
}): Promise<{ workspaceNotePath: string }> {
  const folder = 'automations'
  const noteName = options.noteFileName.endsWith('.md')
    ? options.noteFileName
    : `${options.noteFileName}.md`
  const relativeNotePath = `${folder}/${noteName}`

  let markdown = await readTextFile(options.notePath)

  for (const relative of [folder, `${folder}/screenshots`]) {
    const opts = await getFilePathOptions(relative)
    try {
      if (opts.baseDir !== undefined) {
        await mkdir(opts.path, { baseDir: opts.baseDir, recursive: true })
      } else {
        await mkdir(opts.path, { recursive: true })
      }
    } catch {
      // Directory may already exist.
    }
  }

  if (Array.isArray(options.steps)) {
    for (const step of options.steps) {
      if (!step.screenshotPath || !step.screenshotRelativePath) continue
      const fileName = step.screenshotRelativePath.split('/').pop()
      if (!fileName) continue
      const destOpts = await getFilePathOptions(`${folder}/screenshots/${fileName}`)
      try {
        if (destOpts.baseDir !== undefined) {
          await copyFile(step.screenshotPath, destOpts.path, { toPathBaseDir: destOpts.baseDir })
        } else {
          await copyFile(step.screenshotPath, destOpts.path)
        }
        markdown = markdown.replaceAll(
          `](${step.screenshotRelativePath})`,
          `](screenshots/${fileName})`,
        )
      } catch {
        // Keep runner-relative links if copy fails.
      }
    }
  }

  const noteOpts = await getFilePathOptions(relativeNotePath)
  if (noteOpts.baseDir !== undefined) {
    await writeTextFile(noteOpts.path, markdown, { baseDir: noteOpts.baseDir })
  } else {
    await writeTextFile(noteOpts.path, markdown)
  }

  const articleStore = useArticleStore.getState()
  const inserted = articleStore.insertLocalEntry(relativeNotePath, false)
  await articleStore.ensurePathExpanded(relativeNotePath)
  if (!inserted) {
    await articleStore.loadFileTree()
  }
  emitter.emit('editor-file-content-updated', {
    path: relativeNotePath,
    content: markdown,
  })

  return { workspaceNotePath: relativeNotePath }
}
