<template>
  <section class="page" data-module="pottery">
    <header class="page-head">
      <div>
        <h2>陶器整理管理</h2>
        <p class="page-desc">维护陶器标本，围绕标本编号、出土单位、器形类别、纹饰特征做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记陶器标本</button>
        <button class="btn" type="button" @click="exportRows">导出陶器整理清单</button>
      </div>
    </header>

    <p v-if="draftBanner" class="draft-banner">{{ draftBanner }}</p>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <section v-if="editingRow" class="edit-panel">
      <header class="edit-head">
        <h3>整理登记：{{ editingRow['标本编号'] }}</h3>
        <span class="edit-hint">改动会自动暂存为草稿，中断后重新进入可继续</span>
      </header>
      <p v-if="conflictNote" class="conflict-note">{{ conflictNote }}</p>
      <div class="form-grid">
        <label class="form-item">
          <span>器形类别</span>
          <select v-model="form.器形类别">
            <option value="">未填写</option>
            <option v-for="tag in shapeTags" :key="tag" :value="tag">{{ tag }}</option>
            <option value="待复核">待复核</option>
          </select>
        </label>
        <label class="form-item">
          <span>纹饰特征</span>
          <input v-model="form.纹饰特征" placeholder="如：绳纹、弦纹" />
        </label>
        <label class="form-item">
          <span>制作工艺</span>
          <input v-model="form.制作工艺" placeholder="旧标本无工艺记录可留空，保留原记录" />
        </label>
        <label class="form-item">
          <span>尺寸测量</span>
          <input
            v-model="form.尺寸测量"
            :disabled="dimensionLocked"
            placeholder="如：口径12.5cm，高8cm"
          />
        </label>
        <label class="form-item">
          <span>尺寸精度</span>
          <select v-model="form.尺寸精度" :disabled="dimensionLocked">
            <option value="">未填写</option>
            <option v-for="item in dimensionPrecisions" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
      </div>
      <p v-if="dimensionLocked" class="edit-hint">尺寸已确认，草稿恢复与再次保存都不会覆盖。</p>
      <div class="edit-actions">
        <button class="btn primary" type="button" @click="submitEntry">提交整理</button>
        <button class="btn" type="button" :disabled="dimensionLocked" @click="confirmDimension">确认尺寸</button>
        <button class="btn ghost" type="button" @click="discardDraft">放弃草稿</button>
        <button class="btn ghost" type="button" @click="closeEditor">关闭</button>
      </div>
      <p v-if="panelMessage" class="panel-message">{{ panelMessage }}</p>
    </section>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            {{ row[column] ?? '—' }}
            <span
              v-if="column === '标本编号' && draftIds.has(Number(row.id))"
              class="draft-badge"
            >草稿</span>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in availableActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button
              v-if="row.status === '整理中'"
              class="link"
              type="button"
              @click="openEditor(row)"
            >
              整理登记
            </button>
            <span v-if="isLocked(row)" class="locked-hint">已锁定</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无陶器整理数据，可先登记陶器标本</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条陶器整理记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  DIMENSION_PRECISIONS,
  SHAPE_TAGS,
  savePotteryEntry,
} from '@/api/pottery-service'
import type { PotteryEntryFields } from '@/api/pottery-service'
import {
  DRAFT_FIELDS,
  clearPotteryDraft,
  listPotteryDrafts,
  loadPotteryDraft,
  mergeDraftForRestore,
  savePotteryDraft,
} from '@/data/pottery-drafts'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('pottery')
const columns = meta.fields
const statuses = meta.statuses
const shapeTags = SHAPE_TAGS
const dimensionPrecisions = DIMENSION_PRECISIONS

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const draftIds = ref<Set<number>>(new Set())
const allRowsSnapshot = ref<EntryRow[]>([])

const editingId = ref<number | null>(null)
const form = ref<Record<string, string>>({})
const panelMessage = ref('')
const draftBanner = ref('')

const editingRow = computed(() =>
  editingId.value === null ? null : (allRowsSnapshot.value.find((row) => Number(row.id) === editingId.value) ?? null),
)
const dimensionLocked = computed(() => editingRow.value?.['尺寸已确认'] === true)
const conflictNote = computed(() => String(editingRow.value?.['冲突说明'] ?? ''))

const stats = computed(() => [
  { label: '标本总数', value: allRowsSnapshot.value.length },
  {
    label: '已整理数',
    value: allRowsSnapshot.value.filter((row) => ['已整理', '已拼对', '已归档'].includes(String(row.status))).length,
  },
  {
    label: '待整理数',
    value: allRowsSnapshot.value.filter((row) => String(row.status) === '待整理').length,
  },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function isLocked(row: EntryRow): boolean {
  return meta.lockedStatuses?.includes(String(row.status)) ?? false
}

function availableActions(row: EntryRow): string[] {
  if (isLocked(row)) {
    return []
  }
  const status = String(row.status)
  return meta.actions.filter((action) => {
    const from = meta.actionFrom?.[action]
    return !from || from.includes(status)
  })
}

function formFromRow(row: EntryRow): Record<string, string> {
  return Object.fromEntries(DRAFT_FIELDS.map((field) => [field, String(row[field] ?? '')]))
}

// 草稿自动暂存：整理中的每次改动都落 localStorage，网络中断后重新进入可从上次位置继续。
// 程序化赋值（打开面板、放弃草稿）时抑制自动暂存，只有用户真实改动才写草稿。
const suppressAutosave = ref(false)

watch(
  form,
  (value) => {
    if (suppressAutosave.value || editingId.value === null || Object.keys(value).length === 0) {
      return
    }
    savePotteryDraft({ specimenId: editingId.value, ...(value as PotteryEntryFields) })
    draftIds.value = new Set(listPotteryDrafts().map((draft) => draft.specimenId))
  },
  { deep: true },
)

function assignForm(next: Record<string, string>) {
  suppressAutosave.value = true
  form.value = next
  void nextTick(() => {
    suppressAutosave.value = false
  })
}

function openEditor(row: EntryRow) {
  if (isLocked(row)) {
    errorMessage.value = `${meta.entity}已${row.status}，状态已锁定，不允许再修改`
    return
  }
  editingId.value = Number(row.id)
  panelMessage.value = ''
  const draft = loadPotteryDraft(Number(row.id))
  if (draft) {
    // 恢复草稿：已确认的尺寸以记录为准，重复恢复也不会被覆盖。
    assignForm(mergeDraftForRestore(row, draft))
    panelMessage.value = `已恢复未提交草稿（保存于 ${formatTime(draft.updatedAt)}）`
  } else {
    assignForm(formFromRow(row))
  }
}

function closeEditor() {
  editingId.value = null
  form.value = {}
  panelMessage.value = ''
}

function submitEntry() {
  if (editingId.value === null) {
    return
  }
  const result = savePotteryEntry(editingId.value, form.value as PotteryEntryFields)
  panelMessage.value = result.message
  if (!result.ok) {
    return
  }
  clearPotteryDraft(editingId.value)
  reload()
}

function confirmDimension() {
  if (editingId.value === null) {
    return
  }
  const result = savePotteryEntry(editingId.value, form.value as PotteryEntryFields, {
    confirmDimension: true,
  })
  panelMessage.value = result.message
  if (result.ok) {
    reload()
  }
}

function discardDraft() {
  if (editingId.value === null || !editingRow.value) {
    return
  }
  clearPotteryDraft(editingId.value)
  assignForm(formFromRow(editingRow.value))
  panelMessage.value = '草稿已放弃，已恢复为记录中的内容'
  reload()
}

function formatTime(iso: string): string {
  const time = new Date(iso)
  return Number.isNaN(time.getTime()) ? iso : time.toLocaleString('zh-CN', { hour12: false })
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '陶器标本登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    allRowsSnapshot.value = listEntries(meta.key).items
    draftIds.value = new Set(listPotteryDrafts().map((draft) => draft.specimenId))
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '陶器整理列表读取失败'
  }
}

onMounted(() => {
  reload()
  // 网络中断后重新进入：找到最近未提交的草稿，从上次位置继续。
  const [latest] = listPotteryDrafts()
  if (!latest) {
    return
  }
  const row = listEntries(meta.key).items.find((item) => Number(item.id) === latest.specimenId)
  if (!row || isLocked(row)) {
    clearPotteryDraft(latest.specimenId)
    draftIds.value = new Set(listPotteryDrafts().map((draft) => draft.specimenId))
    return
  }
  openEditor(row)
  draftBanner.value = `检测到未提交的整理草稿，已从上次位置继续（标本 ${String(row['标本编号'])}，保存于 ${formatTime(latest.updatedAt)}）`
})
</script>
