import { MODULE_BY_KEY } from '@/data/modules'
import { clearPotteryDraft } from '@/data/draft-store'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  // 已归档是终态：归档后不允许再改回整理中等任何状态
  if (current === '已归档') {
    return { ok: false, message: `${meta.entity}已归档，不允许再改回「${target}」` }
  }
  const sources = meta.actionSources?.[action]
  if (sources && !sources.includes(current)) {
    return { ok: false, message: `${meta.entity}当前状态「${current}」不允许执行「${action}」` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

// —— 陶器整理：草稿提交合并与待拼对清单，跨模块数据流都走这里 ——

export type PotteryDraftInput = {
  器形类别: string
  纹饰特征: string
  制作工艺: string
  尺寸测量: string
}

/** 出土遗物页的待拼对清单：陶器整理中「完成整理」后等待拼对的标本。 */
export function listPendingMatching(): EntryRow[] {
  return listRows('pottery').filter((row) => String(row.status) === '已整理')
}

/** 尺寸精度：取文本里第一个小数的位数，位数多的一套精度高。 */
function precisionOf(text: string): number {
  const match = text.match(/\d+\.(\d+)/)
  return match ? match[1].length : 0
}

/**
 * 把整理草稿合并进陶器标本正式记录。
 * 冲突规则：已确认的字段以正式记录为准，草稿不得覆盖；
 * 尺寸都未确认时取精度高的一套；草稿留空的字段保留原记录，
 * 旧标本原本没有制作工艺的，不补空字段。
 */
export function submitPotteryOrganization(id: number, draft: PotteryDraftInput): ActionResult {
  const rows = listRows('pottery')
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的陶器标本` }
  }
  const row = rows[index]
  if (String(row.status) === '已归档') {
    return { ok: false, message: '陶器标本已归档，整理结果不能再改动' }
  }
  const notes: string[] = []
  const updated: EntryRow = { ...row }

  // 器形标签：已确认的标签优先，草稿与之冲突时保留已确认值
  const incomingShape = draft.器形类别.trim()
  if (incomingShape) {
    if (row.器形已确认 === true && incomingShape !== String(row.器形类别 ?? '')) {
      notes.push('器形标签与已确认值冲突，保留已确认标签')
    } else {
      updated.器形类别 = incomingShape
      updated.器形已确认 = true
    }
  }

  // 纹饰：草稿留空不覆盖原记录
  if (draft.纹饰特征.trim()) {
    updated.纹饰特征 = draft.纹饰特征.trim()
  }

  // 制作工艺：草稿留空不覆盖；旧标本原本没这个字段时保留原记录，不补空
  if (draft.制作工艺.trim()) {
    updated.制作工艺 = draft.制作工艺.trim()
  }

  // 尺寸：已确认的尺寸草稿不得覆盖；都未确认时取精度高的一套
  const incomingSize = draft.尺寸测量.trim()
  const currentSize = String(row.尺寸测量 ?? '')
  if (row.尺寸已确认 === true) {
    if (incomingSize && incomingSize !== currentSize) {
      notes.push('尺寸已确认，草稿中的尺寸未覆盖')
    }
  } else if (incomingSize) {
    if (currentSize && precisionOf(incomingSize) < precisionOf(currentSize)) {
      notes.push('草稿尺寸精度低于原记录，保留精度更高的一套')
    } else {
      updated.尺寸测量 = incomingSize
      updated.尺寸已确认 = true
    }
  }

  const next = [...rows]
  next[index] = updated
  saveRows('pottery', next)
  clearPotteryDraft(id)
  const suffix = notes.length ? `（${notes.join('；')}）` : ''
  return { ok: true, message: `陶器标本整理结果已保存${suffix}` }
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
