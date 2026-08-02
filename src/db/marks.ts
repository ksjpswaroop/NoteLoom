import { getDb } from "./index"
import { BaseDirectory, exists, mkdir, remove } from "@tauri-apps/plugin-fs"
import { insertActivityEvent } from './activity'
import { truncateActivityText } from '@/lib/activity/events'
import { enqueueAutoDataSync } from '@/lib/sync/auto-data-sync-queue'
import {
  getMarkLocalAssetPath,
  getMarkLocalAssetPaths,
  queueRecordAssetRemoteDeletions,
} from '@/lib/sync/record-assets'
import { getRecordImageThumbnailPath } from '@/lib/record-image-thumbnail'

export { getMarkLocalAssetPath }

export interface Mark {
  id: number
  tagId: number
  type: 'scan' | 'text' | 'image' | 'link' | 'file' | 'recording' | 'todo'
  content?: string
  desc?: string
  url: string
  deleted: 0 | 1
  createdAt: number
}

async function deleteMarkLocalAsset(assetPath: string) {
  const fileExists = await exists(assetPath, { baseDir: BaseDirectory.AppData })
  if (!fileExists) {
    return
  }

  await remove(assetPath, { baseDir: BaseDirectory.AppData })
}

async function deleteMarkLocalAssets(marks: Pick<Mark, 'type' | 'url' | 'content'>[]) {
  const assetPaths = Array.from(new Set(marks.flatMap(getMarkLocalAssetPaths)))
  for (const assetPath of assetPaths) {
    try {
      await deleteMarkLocalAsset(assetPath)
    } catch (error) {
      console.error('Error deleting mark local asset:', assetPath, error)
    }
  }
}

function enqueueRecordsAutoSync(reason: string) {
  enqueueAutoDataSync('records', reason)
}


// marks
export async function initMarksDb() {
  const isExist = await exists('screenshot', { baseDir: BaseDirectory.AppData})
  if (!isExist) {
    await mkdir('screenshot', { baseDir: BaseDirectory.AppData})
  }
  const isImageDirExist = await exists('image', { baseDir: BaseDirectory.AppData })
  if (!isImageDirExist) {
    await mkdir('image', { baseDir: BaseDirectory.AppData })
  }
  const isRecordingDirExist = await exists('recordings', { baseDir: BaseDirectory.AppData })
  if (!isRecordingDirExist) {
    await mkdir('recordings', { baseDir: BaseDirectory.AppData })
  }
  const isTempScreenshotDirExist = await exists('temp_screenshot', { baseDir: BaseDirectory.AppData })
  if (isTempScreenshotDirExist) {
    await remove('temp_screenshot', { baseDir: BaseDirectory.AppData, recursive: true })
  }
  const db = await getDb()
  await db.execute(`
    create table if not exists marks (
      id integer primary key autoincrement,
      tagId integer not null,
      type text not null,
      content text default null,
      url text default null,
      desc text default null,
      deleted integer default 0,
      createdAt integer
    )
  `)
}

export async function getMarks(id: number) {
  const db = await getDb();
  // tagId marks， createdAt
  return await db.select<Mark[]>("select * from marks where tagId = $1 order by createdAt desc", [id])
}

export async function getMarkPreviews(id: number) {
  const db = await getDb()
  return await db.select<Mark[]>(`
    select
      id,
      tagId,
      type,
      substr(content, 1, 500) as content,
      url,
      substr(desc, 1, 500) as desc,
      deleted,
      createdAt
    from marks
    where tagId = $1 and deleted = 0
    order by createdAt desc
  `, [id])
}

export async function getTrashMarkPreviews() {
  const db = await getDb()
  return await db.select<Mark[]>(`
    select
      id,
      tagId,
      type,
      substr(content, 1, 500) as content,
      url,
      substr(desc, 1, 500) as desc,
      deleted,
      createdAt
    from marks
    where deleted = 1
    order by createdAt desc
  `)
}

export async function getMarkById(id: number) {
  const db = await getDb()
  const marks = await db.select<Mark[]>("select * from marks where id = $1", [id])
  return marks[0]
}

export async function updateMarkTag(id: number, tagId: number) {
  const db = await getDb()
  const result = await db.execute("update marks set tagId = $1 where id = $2", [tagId, id])
  enqueueRecordsAutoSync('mark:update-tag')
  return result
}

export async function insertMark(mark: Partial<Mark>) {
  const db = await getDb();
  const createdAt = Date.now();
  const result = await db.execute(
    "insert into marks (tagId, type, content, url, desc, createdAt, deleted) values ($1, $2, $3, $4, $5, $6, $7)",
    [mark.tagId, mark.type,  mark.content, mark.url, mark.desc, createdAt, 0]
  )

  const localImagePath = mark.type && mark.url
    ? getMarkLocalAssetPath({ type: mark.type, url: mark.url })
    : null
  if (localImagePath) {
    await getRecordImageThumbnailPath(localImagePath, 96)
  }

  const preview = truncateActivityText(mark.desc || mark.content || mark.url || '', 140)

  await insertActivityEvent({
    source: 'record',
    title: preview || mark.type || 'record',
    description: preview || mark.type || '',
    tagId: mark.tagId ?? null,
    dedupeKey: result.lastInsertId ? `record:${result.lastInsertId}` : `record:${createdAt}:${mark.type || 'record'}`,
    createdAt,
  })

  enqueueRecordsAutoSync('mark:insert')

  return result
}

export async function getAllMarks() {
  const db = await getDb();
  return await db.select<Mark[]>("select * from marks order by createdAt desc")
}

export async function updateMark(mark: Mark) {
  const db = await getDb();
  const previousMarks = await db.select<Mark[]>("select type, url, content from marks where id = $1", [mark.id])
  const res = await db.execute(
    "update marks set tagId = $1, url = $2, desc = $3, content = $4, createdAt = $5 where id = $6",
    [mark.tagId, mark.url, mark.desc, mark.content, mark.createdAt, mark.id]
  )
  const previousMark = previousMarks[0]
  if (
    previousMark &&
    JSON.stringify(getMarkLocalAssetPaths(previousMark).sort())
      !== JSON.stringify(getMarkLocalAssetPaths(mark).sort())
  ) {
    await queueRecordAssetRemoteDeletions([previousMark])
  }
  enqueueRecordsAutoSync('mark:update')
  return res 
}

export async function restoreMark(id: number) {
  const db = await getDb();
  const createdAt = Date.now();
  const result = await db.execute(
    "update marks set deleted = $1, createdAt = $2 where id = $3",
    [0, createdAt, id]
  )
  enqueueRecordsAutoSync('mark:restore')
  return result
}

export async function delMark(id: number) {
  const db = await getDb();
  // deleted ，
  const res = await db.select<Mark[]>("select * from marks where id = $1", [id])
  if (res[0].deleted === undefined) {
    await db.execute("alter table marks add column deleted integer default 0")
  }
  const createdAt = Date.now();
  const result = await db.execute(
    "update marks set deleted = $1, createdAt = $2 where id = $3",
    [1, createdAt, id]
  )
  enqueueRecordsAutoSync('mark:delete')
  return result
}

export async function deleteAllMarks() {
  const db = await getDb();
  return await db.execute("delete from marks")
}

export async function insertMarks(marks: Partial<Mark>[]) {
  const db = await getDb();
  try {
    for (const mark of marks) {
      if (mark.id) {
        const exists = await db.select<Mark[]>("select * from marks where id = $1", [mark.id])
        if (exists.length > 0) {
          await db.execute(
            "update marks set tagId = $1, type = $2, content = $3, url = $4, desc = $5, createdAt = $6, deleted = $7 where id = $8",
            [mark.tagId, mark.type, mark.content, mark.url, mark.desc, mark.createdAt, mark.deleted, mark.id]
          );
          continue
        }

        await db.execute(
          "insert into marks (id, tagId, type, content, url, desc, createdAt, deleted) values ($1, $2, $3, $4, $5, $6, $7, $8)",
          [mark.id, mark.tagId, mark.type, mark.content, mark.url, mark.desc, mark.createdAt, mark.deleted]
        );
        continue
      }

      await db.execute(
        "insert into marks (tagId, type, content, url, desc, createdAt, deleted) values ($1, $2, $3, $4, $5, $6, $7)",
        [mark.tagId, mark.type, mark.content, mark.url, mark.desc, mark.createdAt, mark.deleted]
      );
    }
    enqueueRecordsAutoSync('mark:bulk-insert')
  } catch (error) {
    console.error('Error inserting marks:', error);
    throw error;
  }
}

export async function delMarkForever(id: number) {
  const db = await getDb();
  const marks = await db.select<Mark[]>("select type, url, content from marks where id = $1", [id])
  await queueRecordAssetRemoteDeletions(marks)
  await deleteMarkLocalAssets(marks)
  const result = await db.execute("delete from marks where id = $1", [id])
  enqueueRecordsAutoSync('mark:delete-forever')
  return result
}

export async function clearTrash() {
  const db = await getDb();
  const marks = await db.select<Mark[]>("select type, url, content from marks where deleted = $1", [1])
  await queueRecordAssetRemoteDeletions(marks)
  await deleteMarkLocalAssets(marks)
  const result = await db.execute("delete from marks where deleted = $1", [1])
  enqueueRecordsAutoSync('mark:clear-trash')
  return result
}

export async function updateMarks(marks: Mark[]) {
  const db = await getDb();
  try {
    for (const mark of marks) {
      await db.execute(
        "update marks set tagId = $1, url = $2, desc = $3, content = $4, createdAt = $5 where id = $6",
        [mark.tagId, mark.url, mark.desc, mark.content, mark.createdAt, mark.id]
      );
    }
    enqueueRecordsAutoSync('mark:bulk-update')
  } catch (error) {
    console.error('Error updating marks:', error);
    throw error;
  }
}

export async function deleteMarks(ids: number[]) {
  const db = await getDb();
  const createdAt = Date.now();
  try {
    for (const id of ids) {
      await db.execute(
        "update marks set deleted = $1, createdAt = $2 where id = $3",
        [1, createdAt, id]
      );
    }
    enqueueRecordsAutoSync('mark:bulk-delete')
  } catch (error) {
    console.error('Error deleting marks:', error);
    throw error;
  }
}

export async function restoreMarks(ids: number[]) {
  const db = await getDb();
  const createdAt = Date.now();
  try {
    for (const id of ids) {
      await db.execute(
        "update marks set deleted = $1, createdAt = $2 where id = $3",
        [0, createdAt, id]
      );
    }
    enqueueRecordsAutoSync('mark:bulk-restore')
  } catch (error) {
    console.error('Error restoring marks:', error);
    throw error;
  }
}
