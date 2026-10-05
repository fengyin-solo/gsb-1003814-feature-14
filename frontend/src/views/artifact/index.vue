<template>
  <section class="page" data-module="artifact">
    <header class="page-head">
      <div>
        <h2>出土遗物管理</h2>
        <p class="page-desc">维护出土遗物，围绕器物编号、出土探方、出土层位、器物质地做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记出土遗物</button>
        <button class="btn" type="button" @click="exportRows">导出出土遗物清单</button>
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
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无出土遗物数据，可先登记出土遗物</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条出土遗物记录</span>
      <span v-if="notice" class="notice-text">{{ notice }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <section class="matching-panel">
      <h3>待拼对清单（陶器整理完成，等待拼对）</h3>
      <table v-if="pendingMatching.length" class="data-table">
        <thead>
          <tr>
            <th>标本编号</th>
            <th>出土单位</th>
            <th>器形类别</th>
            <th>纹饰特征</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in pendingMatching" :key="String(item.id)">
            <td>{{ item.标本编号 ?? '—' }}</td>
            <td>{{ item.出土单位 ?? '—' }}</td>
            <td>{{ item.器形类别 ?? '—' }}</td>
            <td>{{ item.纹饰特征 ?? '—' }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="confirmMatching(item)">登记拼对</button>
              <RouterLink class="link" to="/pottery">前往陶器整理</RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty-state">暂无待拼对的陶器标本，陶器整理「完成整理」后会进入此清单</p>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  listPendingMatching,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('artifact')
const columns = ["器物编号", "出土探方", "出土层位", "器物质地", "器物类型", "完残程度", "登记人", "登记状态"]
const actions = ["完成清洗", "分配编号", "办理入库"]
const statuses = ["已采集", "已清洗", "已编号", "已入库", "借出展示"]
const stats = [{"label": "遗物总数", "value": 0}, {"label": "已入库数", "value": 0}, {"label": "待清洗数", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const notice = ref('')
const filters = ref<Record<string, string>>({})
// 待拼对清单：陶器整理模块「完成整理」后流转过来的标本
const pendingMatching = ref<EntryRow[]>([])
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '出土遗物登记入口尚未接入审批流'
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

/** 在待拼对清单里直接登记拼对：改的是陶器整理模块的标本状态。 */
function confirmMatching(row: EntryRow) {
  errorMessage.value = ''
  notice.value = ''
  const result = applyAction('pottery', Number(row.id), '登记拼对')
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  notice.value = result.message
  reloadMatching()
}

function reloadMatching() {
  pendingMatching.value = listPendingMatching()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '出土遗物列表读取失败'
  }
}

onMounted(() => {
  reload()
  reloadMatching()
})
</script>
