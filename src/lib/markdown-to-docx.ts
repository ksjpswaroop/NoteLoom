import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
  type IParagraphOptions,
} from 'docx'
import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'

type MdToken = Token

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
})

const HEADING_LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const

interface InlineStyle {
  bold?: boolean
  italics?: boolean
  code?: boolean
  link?: string
}

function createTextRun(text: string, style: InlineStyle = {}) {
  return new TextRun({
    text,
    bold: style.bold,
    italics: style.italics,
    font: style.code ? 'Courier New' : undefined,
    size: style.code ? 20 : undefined,
    color: style.link ? '0969DA' : undefined,
    underline: style.link ? {} : undefined,
  })
}

function collectInlineRuns(
  tokens: MdToken[],
  startIndex: number,
  baseStyle: InlineStyle = {},
): { runs: TextRun[]; nextIndex: number } {
  const runs: TextRun[] = []
  const styleStack: InlineStyle[] = [{ ...baseStyle }]
  let index = startIndex

  const currentStyle = () => styleStack[styleStack.length - 1] ?? baseStyle

  while (index < tokens.length) {
    const token = tokens[index]

    if (token.type === 'inline') {
      const nested = collectInlineRuns(token.children ?? [], 0, currentStyle())
      runs.push(...nested.runs)
      index += 1
      continue
    }

    if (token.type.endsWith('_close') && !token.type.startsWith('image')) {
      styleStack.pop()
      index += 1
      if (
        token.type === 'heading_close'
        || token.type === 'paragraph_close'
        || token.type === 'list_item_close'
        || token.type === 'bullet_list_close'
        || token.type === 'ordered_list_close'
        || token.type === 'blockquote_close'
      ) {
        break
      }
      continue
    }

    switch (token.type) {
      case 'text':
      case 'code_inline':
        runs.push(createTextRun(token.content, {
          ...currentStyle(),
          code: token.type === 'code_inline' || currentStyle().code,
        }))
        break
      case 'softbreak':
      case 'hardbreak':
        runs.push(createTextRun('\n', currentStyle()))
        break
      case 'strong_open':
        styleStack.push({ ...currentStyle(), bold: true })
        break
      case 'em_open':
        styleStack.push({ ...currentStyle(), italics: true })
        break
      case 's_open':
        styleStack.push({ ...currentStyle() })
        break
      case 'link_open':
        styleStack.push({
          ...currentStyle(),
          link: token.attrGet('href') || undefined,
        })
        break
      case 'image':
        runs.push(createTextRun(token.content || token.attrGet('alt') || '[image]', currentStyle()))
        break
      case 'html_inline':
        break
      default:
        if (token.children?.length) {
          const nested = collectInlineRuns(token.children, 0, currentStyle())
          runs.push(...nested.runs)
        } else if (token.content) {
          runs.push(createTextRun(token.content, currentStyle()))
        }
        break
    }

    index += 1
  }

  return { runs, nextIndex: index }
}

function paragraphFromInline(
  tokens: MdToken[],
  startIndex: number,
  options: IParagraphOptions = {},
  baseStyle: InlineStyle = {},
): { paragraph: Paragraph; nextIndex: number } {
  const { runs, nextIndex } = collectInlineRuns(tokens, startIndex, baseStyle)
  return {
    paragraph: new Paragraph({
      ...options,
      children: runs.length > 0 ? runs : [createTextRun('', baseStyle)],
    }),
    nextIndex,
  }
}

function tokensToParagraphs(tokens: MdToken[]): Paragraph[] {
  const paragraphs: Paragraph[] = []
  let index = 0
  let orderedListDepth = 0
  let bulletListDepth = 0

  while (index < tokens.length) {
    const token = tokens[index]

    if (token.type === 'heading_open') {
      const level = Number(token.tag.replace('h', '')) - 1
      const result = paragraphFromInline(tokens, index + 1, {
        heading: HEADING_LEVELS[Math.min(Math.max(level, 0), 5)],
        spacing: { before: 240, after: 120 },
      })
      paragraphs.push(result.paragraph)
      index = result.nextIndex + 1
      continue
    }

    if (token.type === 'paragraph_open') {
      const result = paragraphFromInline(tokens, index + 1, {
        spacing: { after: 160 },
      })
      paragraphs.push(result.paragraph)
      index = result.nextIndex + 1
      continue
    }

    if (token.type === 'blockquote_open') {
      index += 1
      while (index < tokens.length && tokens[index].type !== 'blockquote_close') {
        if (tokens[index].type === 'paragraph_open') {
          const result = paragraphFromInline(tokens, index + 1, {
            spacing: { after: 120 },
            indent: { left: 420 },
            border: {
              left: {
                color: 'D0D7DE',
                space: 12,
                style: BorderStyle.SINGLE,
                size: 24,
              },
            },
          }, { italics: true })
          paragraphs.push(result.paragraph)
          index = result.nextIndex + 1
          continue
        }
        index += 1
      }
      index += 1
      continue
    }

    if (token.type === 'bullet_list_open') {
      bulletListDepth += 1
      index += 1
      continue
    }

    if (token.type === 'bullet_list_close') {
      bulletListDepth = Math.max(0, bulletListDepth - 1)
      index += 1
      continue
    }

    if (token.type === 'ordered_list_open') {
      orderedListDepth += 1
      index += 1
      continue
    }

    if (token.type === 'ordered_list_close') {
      orderedListDepth = Math.max(0, orderedListDepth - 1)
      index += 1
      continue
    }

    if (token.type === 'list_item_open') {
      const isOrdered = orderedListDepth > 0 && bulletListDepth === 0
      const level = Math.max(0, (isOrdered ? orderedListDepth : bulletListDepth) - 1)
      index += 1

      while (index < tokens.length && tokens[index].type !== 'list_item_close') {
        if (
          tokens[index].type === 'paragraph_open'
          || tokens[index].type === 'heading_open'
        ) {
          const result = paragraphFromInline(tokens, index + 1, {
            numbering: {
              reference: isOrdered ? 'export-ordered-list' : 'export-bullet-list',
              level,
            },
            spacing: { after: 80 },
          })
          paragraphs.push(result.paragraph)
          index = result.nextIndex + 1
          continue
        }
        index += 1
      }
      index += 1
      continue
    }

    if (token.type === 'fence' || token.type === 'code_block') {
      const lines = (token.content || '').replace(/\n$/, '').split('\n')
      for (const line of lines.length > 0 ? lines : ['']) {
        paragraphs.push(new Paragraph({
          spacing: { after: 40 },
          shading: { type: 'clear', fill: 'F6F8FA' },
          children: [createTextRun(line || ' ', { code: true })],
        }))
      }
      paragraphs.push(new Paragraph({ children: [] }))
      index += 1
      continue
    }

    if (token.type === 'hr') {
      paragraphs.push(new Paragraph({
        border: {
          bottom: {
            color: 'D0D7DE',
            space: 1,
            style: BorderStyle.SINGLE,
            size: 6,
          },
        },
        spacing: { before: 120, after: 120 },
        children: [],
      }))
      index += 1
      continue
    }

    if (token.type === 'inline') {
      const result = paragraphFromInline(tokens, index, {
        spacing: { after: 160 },
      })
      paragraphs.push(result.paragraph)
      index = result.nextIndex
      continue
    }

    index += 1
  }

  if (paragraphs.length === 0) {
    paragraphs.push(new Paragraph({ children: [createTextRun('')] }))
  }

  return paragraphs
}

export async function markdownToDocxBlob(markdownSource: string, title: string): Promise<Blob> {
  const tokens = markdown.parse(markdownSource || '', {})
  const children = tokensToParagraphs(tokens)

  const document = new Document({
    creator: 'NoteLoom',
    title,
    description: `Exported from NoteLoom — ${title}`,
    numbering: {
      config: [
        {
          reference: 'export-bullet-list',
          levels: [0, 1, 2, 3, 4].map((level) => ({
            level,
            format: LevelFormat.BULLET,
            text: '•',
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 720 + level * 360, hanging: 360 },
              },
            },
          })),
        },
        {
          reference: 'export-ordered-list',
          levels: [0, 1, 2, 3, 4].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 720 + level * 360, hanging: 360 },
              },
            },
          })),
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          margin: {
            top: 720,
            right: 720,
            bottom: 720,
            left: 720,
          },
        },
      },
      children,
    }],
  })

  return await Packer.toBlob(document)
}
