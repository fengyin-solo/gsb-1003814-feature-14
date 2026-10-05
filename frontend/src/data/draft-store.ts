// 陶器整理草稿：独立于正式记录的本地暂存。
// 网络中断、页面关闭都不丢，重新进入时从上次未提交的位置继续。
const DRAFT_STORAGE_KEY = 'field-archaeology-digital:pottery-drafts'

export type PotteryDraft = {
  specimenId: number
  标本编号: string
  器形类别: string
  纹饰特征: string
  制作工艺: string
  尺寸测量: string
  /** 最后编辑的字段，恢复时聚焦，回到上次未提交的位置 */
  lastField: string
  /** ISO 时间，多份草稿时按它挑最近的一份恢复 */
  updatedAt: string
}

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
    return {}
  }
}

function writeDrafts(drafts: Record<string, PotteryDraft>): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(drafts))
}

export function savePotteryDraft(draft: PotteryDraft): void {
  const drafts = readDrafts()
  drafts[String(draft.specimenId)] = draft
  writeDrafts(drafts)
}

export function loadPotteryDraft(specimenId: number): PotteryDraft | null {
  return readDrafts()[String(specimenId)] ?? null
}

/** 全部草稿按保存时间倒序，恢复时取第一条即「上次未提交位置」。 */
export function listPotteryDrafts(): PotteryDraft[] {
  return Object.values(readDrafts()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function clearPotteryDraft(specimenId: number): void {
  const drafts = readDrafts()
  delete drafts[String(specimenId)]
  writeDrafts(drafts)
}
