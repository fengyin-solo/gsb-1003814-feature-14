<template>
  <section class="page" data-module="pottery">
    <header class="page-head">
      <div>
        <h2>陶器整理管理</h2>
        <p class="page-desc">
          维护陶器标本，围绕标本编号、出土单位、器形类别、纹饰特征做登记、筛选与状态流转。
          整理中的器形、纹饰、工艺与尺寸会自动保存草稿，中断后重新进入可从上次未提交位置继续。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记陶器标本</button>
        <button class="btn" type="button" @click="exportRows">导出陶器整理清单</button>
      </div>
    </header>

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

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <section v-if="editing" class="editor-panel">
      <div class="editor-head">
        <strong>整理陶器标本：{{ editing.标本编号 }}</strong>
        <span v-if="draftSavedAt" class="notice-text">草稿已自动保存 · {{ draftSavedAt }}</span>
      </div>
      <div class="editor-grid">
        <label class="editor-field">
          <span>器形类别</span>
          <input ref="shapeInput" v-model="form.器形类别" @input="persistDraft('器形类别')" />
          <em v-if="shapeConflict" class="conflict-text">
            与已确认标签「{{ editing.器形类别 }}」冲突，保存时以已确认标签为准
          </em>
        </label>
        <label class="editor-field">
          <span>纹饰特征</span>
          <input ref="decorInput" v-model="form.纹饰特征" @input="persistDraft('纹饰特征')" />
        </label>
        <label class="editor-field">
          <span>制作工艺</span>
          <input
            ref="craftInput"
            v-model="form.制作工艺"
            placeholder="旧标本无工艺记录可留空，原记录保持不变"
            @input="persistDraft('制作工艺')"
          />
        </label>
        <label class="editor-field">
          <span>尺寸测量</span>
          <input
            ref="sizeInput"
            v-model="form.尺寸测量"
            :disabled="sizeLocked"
            placeholder="如：高24.5cm，口径18.05cm"
            @input="persistDraft('尺寸测量')"
          />
          <em v-if="sizeLocked" class="conflict-text">尺寸已确认，草稿恢复不会覆盖</em>
        </label>
      </div>
      <div class="editor-actions">
        <button class="btn primary" type="button" @click="submitOrganization">保存整理结果</button>
        <button class="btn ghost" type="button" @click="discardDraft">放弃草稿</button>
        <button class="btn ghost" type="button" @click="closeEditor">收起面板</button>
      </div>
    </section>

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
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <template v-if="row.status !== '已归档'">
              <button class="link" type="button" @click="openEditorFromRow(row)">整理</button>
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </template>
            <span v-else class="muted-text">已归档 · 不可变更</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无陶器整理数据，可先登记陶器标本</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条陶器整理记录</span>
      <span v-if="notice" class="notice-text">{{ notice }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  submitPotteryOrganization,
} from '@/api/local-service'
import {
  clearPotteryDraft,
  listPotteryDrafts,
  loadPotteryDraft,
  savePotteryDraft,
} from '@/data/draft-store'
import type { PotteryDraft } from '@/data/draft-store'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('pottery')
const columns = ["标本编号", "出土单位", "器形类别", "纹饰特征", "制作工艺", "器表颜色", "尺寸测量", "整理状态"]
const actions = ["开始整理", "完成整理", "登记拼对", "归档"]
const statuses = ["待整理", "整理中", "已整理", "已拼对", "已归档"]
const stats = [{"label": "标本总数", "value": 0}, {"label": "已整理数", "value": 0}, {"label": "待整理数", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const notice = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// —— 草稿恢复：编辑中的标本、表单与冲突提示 ——
const editing = ref<EntryRow | null>(null)
const form = reactive({ 器形类别: '', 纹饰特征: '', 制作工艺: '', 尺寸测量: '' })
const sizeLocked = ref(false)
const draftSavedAt = ref('')
const shapeInput = ref<HTMLInputElement | null>(null)
const decorInput = ref<HTMLInputElement | null>(null)
const craftInput = ref<HTMLInputElement | null>(null)
const sizeInput = ref<HTMLInputElement | null>(null)

const shapeConflict = computed(() => {
  const row = editing.value
  if (!row || row.器形已确认 !== true) {
    return false
  }
  const incoming = form.器形类别.trim()
  return incoming !== '' && incoming !== String(row.器形类别 ?? '')
})

function persistDraft(field: string) {
  const row = editing.value
  if (!row) {
    return
  }
  const draft: PotteryDraft = {
    specimenId: Number(row.id),
    标本编号: String(row.标本编号 ?? ''),
    器形类别: form.器形类别,
    纹饰特征: form.纹饰特征,
    制作工艺: form.制作工艺,
    尺寸测量: form.尺寸测量,
    lastField: field,
    updatedAt: new Date().toISOString(),
  }
  savePotteryDraft(draft)
  draftSavedAt.value = new Date().toLocaleTimeString()
}

/** 草稿值优先，空值回退到正式记录；旧标本缺字段时拿到空串，不补默认值。 */
function pickValue(draftValue: string | undefined, recordValue: unknown): string {
  return draftValue && draftValue.trim() ? draftValue : String(recordValue ?? '')
}

function fillForm(row: EntryRow, draft: PotteryDraft | null) {
  // 恢复规则：已确认的尺寸以正式记录为准，重复恢复草稿也不覆盖
  const confirmedSize = row.尺寸已确认 === true
  sizeLocked.value = confirmedSize
  form.器形类别 = pickValue(draft?.器形类别, row.器形类别)
  form.纹饰特征 = pickValue(draft?.纹饰特征, row.纹饰特征)
  form.制作工艺 = pickValue(draft?.制作工艺, row.制作工艺)
  form.尺寸测量 = confirmedSize
    ? String(row.尺寸测量 ?? '')
    : pickValue(draft?.尺寸测量, row.尺寸测量)
}

function focusField(field: string) {
  const inputs: Record<string, typeof shapeInput> = {
    器形类别: shapeInput,
    纹饰特征: decorInput,
    制作工艺: craftInput,
    尺寸测量: sizeInput,
  }
  inputs[field]?.value?.focus()
}

function openEditor(row: EntryRow, draft: PotteryDraft | null) {
  editing.value = row
  fillForm(row, draft)
  draftSavedAt.value = draft ? new Date(draft.updatedAt).toLocaleTimeString() : ''
  if (draft) {
    nextTick(() => focusField(draft.lastField))
  }
}

function openEditorFromRow(row: EntryRow) {
  openEditor(row, loadPotteryDraft(Number(row.id)))
}

function closeEditor() {
  editing.value = null
  draftSavedAt.value = ''
}

function discardDraft() {
  const row = editing.value
  if (row) {
    clearPotteryDraft(Number(row.id))
  }
  closeEditor()
  notice.value = '已放弃未提交的整理草稿'
}

function submitOrganization() {
  const row = editing.value
  if (!row) {
    return
  }
  errorMessage.value = ''
  const result = submitPotteryOrganization(Number(row.id), { ...form })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  notice.value = result.message
  closeEditor()
  reload()
}

/** 重新进入页面：有未提交草稿时恢复到上次中断的位置。 */
function resumeLatestDraft() {
  const [latest] = listPotteryDrafts()
  if (!latest) {
    return
  }
  const row = rows.value.find((item) => Number(item.id) === latest.specimenId)
  if (!row || String(row.status) === '已归档') {
    // 标本已归档或不存在，草稿作废，避免恢复出可改归档记录的入口
    clearPotteryDraft(latest.specimenId)
    return
  }
  openEditor(row, latest)
  notice.value = `已恢复「${latest.标本编号}」上次未提交的整理草稿，从字段「${latest.lastField}」继续`
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
  notice.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  notice.value = result.message
  if (action === '归档') {
    // 归档即终态：未提交的草稿一并作废，面板里也不能再改
    clearPotteryDraft(Number(row.id))
    if (Number(editing.value?.id) === Number(row.id)) {
      closeEditor()
    }
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '陶器整理列表读取失败'
  }
}

onMounted(() => {
  reload()
  resumeLatestDraft()
})
</script>
