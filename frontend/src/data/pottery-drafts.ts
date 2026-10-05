// 陶器整理草稿：独立于业务数据持久化，网络中断、页面关闭后重新进入都能从上次未提交位置继续。
import type { EntryRow } from './types'

const DRAFT_STORAGE_KEY = 'field-archaeology-digital:pottery-drafts'

/** 整理中允许暂存的字段：器形、纹饰、工艺、尺寸（含精度）。 */
export type PotteryDraft = {
  specimenId: number
  器形类别: string
  纹饰特征: string
  制作工艺: string
  尺寸测量: string
  尺寸精度: string
  updatedAt: string
}

export const DRAFT_FIELDS = ['器形类别', '纹饰特征', '制作工艺', '尺寸测量', '尺寸精度'] as const

function readDrafts(): Record<string, PotteryDraft> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {}
  }
  const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY)
  if (!raw) {
    return {}
  }
  try {
    return JSON.parse(raw) as Record<string, PotteryDraft>
  } catch {
    window.localStorage.removeItem(DRAFT_STORAGE_KEY)
    return {}
  }
}

function writeDrafts(drafts: Record<string, PotteryDraft>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(drafts))
  }
}

export function listPotteryDrafts(): PotteryDraft[] {
  return Object.values(readDrafts()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function loadPotteryDraft(specimenId: number): PotteryDraft | null {
  return readDrafts()[String(specimenId)] ?? null
}

export function savePotteryDraft(draft: Omit<PotteryDraft, 'updatedAt'>): PotteryDraft {
  const drafts = readDrafts()
  const next: PotteryDraft = { ...draft, updatedAt: new Date().toISOString() }
  drafts[String(draft.specimenId)] = next
  writeDrafts(drafts)
  return next
}

export function clearPotteryDraft(specimenId: number): void {
  const drafts = readDrafts()
  if (String(specimenId) in drafts) {
    delete drafts[String(specimenId)]
    writeDrafts(drafts)
  }
}

/**
 * 把草稿合并到标本行上，供恢复未提交位置使用。
 * 已确认的尺寸（行上 尺寸已确认 为真）以行内记录为准，重复恢复也不会被草稿覆盖。
 */
export function mergeDraftForRestore(row: EntryRow, draft: PotteryDraft): Record<string, string> {
  const dimensionLocked = row['尺寸已确认'] === true
  const restored: Record<string, string> = {}
  for (const field of DRAFT_FIELDS) {
    if (dimensionLocked && (field === '尺寸测量' || field === '尺寸精度')) {
      restored[field] = String(row[field] ?? '')
      continue
    }
    restored[field] = draft[field] ?? String(row[field] ?? '')
  }
  return restored
}
