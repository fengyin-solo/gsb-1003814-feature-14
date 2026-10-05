// 陶器整理专属业务规则：保存合并、尺寸与器形冲突裁决、待拼对清单。
// 通用状态流转仍在 local-service，这里只承载陶器自己的数据流约束。
import { listRows, saveRows } from '@/data/local-store'
import { moduleMeta } from '@/api/local-service'
import type { ActionResult, EntryRow } from '@/data/types'

const MODULE_KEY = 'pottery'

export const DIMENSION_PRECISIONS = ['精确到毫米', '精确到厘米', '估计值'] as const

export const SHAPE_TAGS = ['碗', '钵', '盆', '罐', '鼎', '豆', '壶', '杯'] as const

/** 器形标签对应的常规口径范围（cm），用于尺寸与器形标签的冲突核对。 */
const SHAPE_CALIBER_RANGES: Record<string, [number, number]> = {
  碗: [8, 25],
  钵: [10, 30],
  盆: [20, 50],
  罐: [15, 60],
  鼎: [15, 50],
  豆: [8, 20],
  壶: [8, 30],
  杯: [4, 12],
}

export type PotteryEntryFields = {
  器形类别: string
  纹饰特征: string
  制作工艺: string
  尺寸测量: string
  尺寸精度: string
}

export type SavePotteryOptions = {
  /** 确认尺寸：把本次尺寸写为已确认，之后草稿恢复与再次保存都不能覆盖。 */
  confirmDimension?: boolean
}

/** 从尺寸测量文本里解析口径数值（cm），支持「口径12.5cm」「口径 12.5」等写法。 */
export function parseCaliber(dimension: string): number | null {
  const matched = dimension.match(/口径\s*[:：]?\s*(\d+(?:\.\d+)?)/)
  if (!matched) {
    return null
  }
  const value = Number(matched[1])
  return Number.isFinite(value) ? value : null
}

/**
 * 尺寸精度与器形标签冲突裁决：精度达到厘米级及以上的尺寸测量（定量）优先于器形标签（定性），
 * 标签置为「待复核」并标记异常；尺寸仅为估计值时让位于器形标签，仅提示复核尺寸。
 * 返回落库使用的字段与冲突说明（无冲突时 conflictNote 为空串）。
 */
export function resolveShapeDimension(fields: PotteryEntryFields): {
  fields: PotteryEntryFields
  conflictNote: string
  abnormal: boolean
} {
  const shape = fields.器形类别.trim()
  const caliber = parseCaliber(fields.尺寸测量)
  if (!shape || shape === '待复核' || caliber === null || !(shape in SHAPE_CALIBER_RANGES)) {
    return { fields, conflictNote: '', abnormal: false }
  }
  const [min, max] = SHAPE_CALIBER_RANGES[shape]
  if (caliber >= min && caliber <= max) {
    return { fields, conflictNote: '', abnormal: false }
  }
  const rangeText = `${min}–${max}cm`
  const precisionText = fields.尺寸精度 ? `，${fields.尺寸精度}` : ''
  if (fields.尺寸精度 === '估计值') {
    return {
      fields,
      conflictNote: `尺寸测量（口径${caliber}cm）为估计值，与器形标签「${shape}」常规口径${rangeText}不符，已保留器形标签，请复核尺寸`,
      abnormal: true,
    }
  }
  return {
    fields: { ...fields, 器形类别: '待复核' },
    conflictNote: `尺寸测量（口径${caliber}cm${precisionText}）超出器形标签「${shape}」常规口径${rangeText}，已以尺寸测量为准，器形待复核`,
    abnormal: true,
  }
}

function findRow(id: number): { rows: EntryRow[]; index: number } {
  const rows = listRows(MODULE_KEY)
  return { rows, index: rows.findIndex((row) => Number(row.id) === id) }
}

/**
 * 保存陶器整理字段（器形、纹饰、工艺、尺寸）。
 * 合并规则：空值不覆盖原记录——旧标本没有制作工艺等字段时保持原样；
 * 已确认的尺寸不允许再被改动；已归档标本锁定，任何字段都不可再改。
 */
export function savePotteryEntry(
  id: number,
  fields: PotteryEntryFields,
  options: SavePotteryOptions = {},
): ActionResult {
  const meta = moduleMeta(MODULE_KEY)
  const { rows, index } = findRow(id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const row = rows[index]
  if (meta.lockedStatuses?.includes(String(row.status))) {
    return { ok: false, message: `${meta.entity}已${row.status}，状态已锁定，不允许再修改` }
  }

  const dimensionLocked = row['尺寸已确认'] === true
  const incoming: PotteryEntryFields = { ...fields }
  const notices: string[] = []
  if (dimensionLocked) {
    const changed =
      incoming.尺寸测量.trim() !== String(row['尺寸测量'] ?? '').trim() ||
      incoming.尺寸精度.trim() !== String(row['尺寸精度'] ?? '').trim()
    if (changed) {
      notices.push('尺寸已确认，本次提交的尺寸改动未生效')
    }
    incoming.尺寸测量 = String(row['尺寸测量'] ?? '')
    incoming.尺寸精度 = String(row['尺寸精度'] ?? '')
  }

  const resolved = resolveShapeDimension(incoming)
  const next: EntryRow = { ...row }
  const merged: PotteryEntryFields = resolved.fields
  for (const field of Object.keys(merged) as (keyof PotteryEntryFields)[]) {
    const value = String(merged[field] ?? '').trim()
    if (value === '') {
      continue
    }
    next[field] = value
  }
  if (resolved.conflictNote) {
    next['冲突说明'] = resolved.conflictNote
    next.abnormal = true
    notices.push(resolved.conflictNote)
  } else {
    // 本次保存没有冲突：清掉旧的冲突说明，异常标记一并复位。
    delete next['冲突说明']
    next.abnormal = false
  }
  if (options.confirmDimension) {
    if (String(next['尺寸测量'] ?? '').trim() === '') {
      return { ok: false, message: '尺寸测量为空，不能确认尺寸' }
    }
    next['尺寸已确认'] = true
  }

  const nextRows = [...rows]
  nextRows[index] = next
  saveRows(MODULE_KEY, nextRows)
  const base = options.confirmDimension ? `${meta.entity}尺寸已确认` : `${meta.entity}整理内容已保存`
  return { ok: true, message: [base, ...notices].join('；') }
}

/** 待拼对清单：陶器整理完成（已整理）、等待登记拼对的标本，供出土遗物页使用。 */
export function listPendingMatching(): EntryRow[] {
  return listRows(MODULE_KEY).filter((row) => String(row.status) === '已整理')
}
