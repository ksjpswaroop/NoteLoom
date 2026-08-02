import { TooltipButton } from "@/components/tooltip-button"
import { FilePlus } from "lucide-react"
import { useTranslations } from 'next-intl'
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from "@tauri-apps/plugin-fs";
import useMarkStore from "@/stores/mark";
import { insertMark } from "@/db/marks";
import { useEffect, useCallback } from 'react'
import emitter from '@/lib/emitter'
import { extractTextFromPDF } from '@/lib/pdf'
import { v4 as uuid } from 'uuid'
import { toast } from '@/hooks/use-toast'
import { useRecordCompletion } from './use-record-completion'
import { getDefaultRecordSaveTagId } from '@/lib/record-save-target'

//
const codeExtensions = [
  // Web
  'js', 'jsx', 'ts', 'tsx', 'html', 'css', 'scss', 'sass', 'less', 'vue', 'svelte', 'php', 'mjs', 'mts',
  //
  'py', 'java', 'cpp', 'c', 'cs', 'go', 'rb', 'rs', 'swift', 'kt', 'scala', 'dart', 'lua', 'r',
  // /
  'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'graphql', 'sql',
  // Shell
  'sh', 'bash', 'zsh', 'fish', 'ps1',
  //
  'asm', 'pl', 'clj', 'ex', 'elm', 'f90', 'hs', 'jl', 'swift', 'ml'
];
const textFileExtensions = ['txt', 'md', 'csv'];
const pdfExtensions = ['pdf'];

export function ControlFile() {
  const t = useTranslations();
  const { addQueue, setQueue, removeQueue } = useMarkStore()
  const completeRecord = useRecordCompletion()

  const handleSelectFile = useCallback(() => {
    selectFile()
  }, [])

  useEffect(() => {
    emitter.on('toolbar-shortcut-file', handleSelectFile)
    return () => {
      emitter.off('toolbar-shortcut-file', handleSelectFile)
    }
  }, [handleSelectFile])

  async function selectFile() {
    const filePath = await open({
      multiple: false,
      directory: false,
    });
    if (!filePath) return

    await readFileByPath(filePath)
  }

  async function saveFileRecord(path: string, desc: string, content: string, tagId: number) {
    const result = await insertMark({
      tagId,
      type: 'file',
      desc,
      content,
      url: path
    })
    const markId = Number(result.lastInsertId || 0) || null
    await completeRecord({
      markId,
      tagId,
      typeLabel: t('record.mark.type.file'),
    })
  }

  async function readFileByPath(path: string) {
    const tagId = await getDefaultRecordSaveTagId()
    const ext = path.substring(path.lastIndexOf('.') + 1)
    // （）
    const fileName = path.split('/').pop() || path.split('\\').pop() || path
    // ：
    const desc = fileName
    let content = ''

    // PDF
    if (pdfExtensions.includes(ext)) {
      const queueId = uuid()
      try {
        addQueue({ queueId, tagId, progress: t('record.mark.progress.cacheFile'), type: 'file', startTime: Date.now() })
        content = await extractTextFromPDF(path, (progress) => {
          setQueue(queueId, { progress })
        })
        setQueue(queueId, { progress: t('record.mark.progress.save') })
      } catch (error) {
        console.error('PDF extraction failed:', error)
        content = 'PDF text extraction failed'
      }
      removeQueue(queueId)

      // url ，
      await saveFileRecord(path, desc, content, tagId)
      return
    }
    //
    else if ([...textFileExtensions, ...codeExtensions].includes(ext)) {
      try {
        content = await readTextFile(path)
        content = content.replace(/'/g, '')
      } catch (error) {
        console.error('File text read failed:', error)
        content = t('record.capture.fileReadFailed')
      }
    }
    // Unsupported file type
    else {
      content = t('record.capture.fileUnsupportedContent')
      toast({
        title: t('record.capture.fileUnsupportedSaved'),
        description: t('record.capture.fileUnsupportedDescription'),
      })
    }

    // Store the full path in the url field so clicking opens the folder
    await saveFileRecord(path, desc, content, tagId)
  }

  return (
    <TooltipButton icon={<FilePlus />} tooltipText={t('record.mark.type.file')} onClick={selectFile} />
  )
}
