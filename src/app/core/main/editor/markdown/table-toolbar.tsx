'use client'

import { Editor } from '@tiptap/react'
import {
  Table as TableIcon,
  Columns,
  Rows,
  Trash2,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from 'lucide-react'
import { useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { ButtonGroup, ButtonGroupSeparator } from '@/components/ui/button-group'

interface TableToolbarProps {
  editor: Editor
}

export function TableToolbar({ editor }: TableToolbarProps) {
  const canInsertTable = editor.can().insertTable({ rows: 3, cols: 3, withHeaderRow: true })

  const insertTable = useCallback(() => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
  }, [editor])

  const addColumnBefore = useCallback(() => {
    editor.chain().focus().addColumnBefore().run()
  }, [editor])

  const addColumnAfter = useCallback(() => {
    editor.chain().focus().addColumnAfter().run()
  }, [editor])

  const addRowBefore = useCallback(() => {
    editor.chain().focus().addRowBefore().run()
  }, [editor])

  const addRowAfter = useCallback(() => {
    editor.chain().focus().addRowAfter().run()
  }, [editor])

  const deleteColumn = useCallback(() => {
    editor.chain().focus().deleteColumn().run()
  }, [editor])

  const deleteRow = useCallback(() => {
    editor.chain().focus().deleteRow().run()
  }, [editor])

  const deleteTable = useCallback(() => {
    editor.chain().focus().deleteTable().run()
  }, [editor])

  const setColumnAlignmentLeft = useCallback(() => {
    editor.chain().focus().setCellAttribute('align', 'left').run()
  }, [editor])

  const setColumnAlignmentCenter = useCallback(() => {
    editor.chain().focus().setCellAttribute('align', 'center').run()
  }, [editor])

  const setColumnAlignmentRight = useCallback(() => {
    editor.chain().focus().setCellAttribute('align', 'right').run()
  }, [editor])

  const isTableActive = editor.isActive('table')

  return (
    <div className="table-toolbar relative flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={insertTable}
        disabled={!canInsertTable}
        title="Insert table"
      >
        <TableIcon />
      </Button>

      {isTableActive && (
        <ButtonGroup>
          <Button type="button" variant="ghost" size="icon-sm"
            onClick={addColumnBefore}
            title="Insert column left"
          >
            <Columns className="rotate-180" />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm"
            onClick={addColumnAfter}
            title="Insert column right"
          >
            <Columns />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm"
            onClick={addRowBefore}
            title="Insert row above"
          >
            <Rows className="rotate-180" />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm"
            onClick={addRowAfter}
            title="Insert row below"
          >
            <Rows />
          </Button>
          <ButtonGroupSeparator />
          <Button type="button" variant="ghost" size="icon-sm"
            onClick={setColumnAlignmentLeft}
            title="Align left"
          >
            <AlignLeft />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm"
            onClick={setColumnAlignmentCenter}
            title="Align center"
          >
            <AlignCenter />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm"
            onClick={setColumnAlignmentRight}
            title="Align right"
          >
            <AlignRight />
          </Button>
          <ButtonGroupSeparator />
          <Button type="button" variant="destructive" size="icon-sm"
            onClick={deleteColumn}
            title="Delete column"
          >
            <Trash2 />
          </Button>
          <Button type="button" variant="destructive" size="icon-sm"
            onClick={deleteRow}
            title="Delete row"
          >
            <Rows className="rotate-45" />
          </Button>
          <Button type="button" variant="destructive" size="icon-sm"
            onClick={deleteTable}
            title="Delete table"
          >
            <Trash2 />
          </Button>
        </ButtonGroup>
      )}
    </div>
  )
}
