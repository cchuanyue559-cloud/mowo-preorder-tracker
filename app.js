'use strict';

const STORAGE_KEY = 'mowo-preorders-v1';
const CHANNEL_NAME = 'mowo-preorders-updates';
const DONE_STATUSES = new Set(['已到货', '已取消']);
const STATUS_META = {
  '待付定金': { className: 'pending' },
  '待补款': { className: 'due' },
  '已补款待发货': { className: 'paid' },
  '已发货': { className: 'shipped' },
  '已到货': { className: 'arrived' },
  '已取消': { className: 'cancelled' },
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const elements = {
  recordsGrid: $('#recordsGrid'),
  statActive: $('#statActive'),
  statDue: $('#statDue'),
  statUpcoming: $('#statUpcoming'),
  statArrived: $('#statArrived'),
  heroTitle: $('#heroTitle'),
  heroSub: $('#heroSub'),
  greeting: $('#greeting'),
  nextCard: $('#nextCard'),
  nextCountdown: $('#nextCountdown'),
  nextName: $('#nextName'),
  nextDetail: $('#nextDetail'),
  nextAction: $('#nextAction'),
  listTitle: $('#listTitle'),
  listCount: $('#listCount'),
  searchInput: $('#searchInput'),
  sortSelect: $('#sortSelect'),
  recordDialog: $('#recordDialog'),
  recordForm: $('#recordForm'),
  recordDialogTitle: $('#recordDialogTitle'),
  recordId: $('#recordId'),
  deleteRecordButton: $('#deleteRecordButton'),
  paymentDialog: $('#paymentDialog'),
  paymentForm: $('#paymentForm'),
  paymentAmount: $('#paymentAmount'),
  paymentName: $('#paymentName'),
  paymentMeta: $('#paymentMeta'),
  paymentError: $('#paymentError'),
  settingsDialog: $('#settingsDialog'),
  settingsCount: $('#settingsCount'),
  importFile: $('#importFile'),
  installButton: $('#installButton'),
  toastRegion: $('#toastRegion'),
};

let records = loadRecords();
let currentFilter = 'all';
let currentSort = 'smart';
let currentQuery = '';
let editingId = null;
let payingId = null;
let nextEventId = null;
let nextEventAction = 'edit';
let deferredInstallPrompt = null;
let channel = null;

try {
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.addEventListener('message', () => {
    records = loadRecords();
    render();
  });
} catch (_) {
  channel = null;
}

const makeId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `record-${Date.now()}-${Math.random().toString(16).slice(2)}`);

function numberValue(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
}

function normalizeRecord(raw = {}) {
  const now = new Date().toISOString();
  const validDate = (value) => {
    if (!value) return '';
    const text = String(value).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
  };
  return {
    id: String(raw.id || makeId()),
    name: String(raw.name || '').trim().slice(0, 80),
    version: String(raw.version || '').trim().slice(0, 50),
    platform: String(raw.platform || '').trim().slice(0, 50),
    orderNo: String(raw.orderNo || '').trim().slice(0, 60),
    preorderDate: validDate(raw.preorderDate),
    releaseDate: validDate(raw.releaseDate),
    paymentDeadline: validDate(raw.paymentDeadline),
    status: STATUS_META[raw.status] ? raw.status : '待补款',
    total: numberValue(raw.total),
    deposit: numberValue(raw.deposit),
    paidBalance: numberValue(raw.paidBalance ?? raw.paid),
    note: String(raw.note || '').trim().slice(0, 300),
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
  };
}

function loadRecords() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeRecord).filter((record) => record.name);
  } catch (error) {
    console.warn('读取本地记录失败', error);
    return [];
  }
}

function saveRecords() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    channel?.postMessage({ type: 'updated' });
    return true;
  } catch (error) {
    console.error('保存记录失败', error);
    showToast('保存失败，请检查浏览器存储空间');
    return false;
  }
}

function calculate(record) {
  const total = numberValue(record.total);
  const deposit = numberValue(record.deposit);
  const paidBalance = numberValue(record.paidBalance);
  const due = Math.max(0, round2(total - deposit));
  const remaining = Math.max(0, round2(total - deposit - paidBalance));
  const paidTotal = round2(deposit + paidBalance);
  const progress = total > 0 ? Math.min(100, Math.round((paidTotal / total) * 100)) : 0;
  const deadlineDays = daysUntil(record.paymentDeadline);
  const releaseDays = daysUntil(record.releaseDate);
  const done = DONE_STATUSES.has(record.status);
  const urgent = !done && remaining > 0 && deadlineDays !== null && deadlineDays <= 14;
  const upcoming = !done && !urgent && releaseDays !== null && releaseDays >= 0 && releaseDays <= 30;
  return { total, deposit, paidBalance, due, remaining, paidTotal, progress, deadlineDays, releaseDays, done, urgent, upcoming };
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function todayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function daysUntil(dateText) {
  if (!dateText) return null;
  const [year, month, day] = dateText.split('-').map(Number);
  if (!year || !month || !day) return null;
  const target = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function formatMoney(value) {
  const amount = numberValue(value);
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency', currency: 'CNY', minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(amount);
}

function formatDateCompact(dateText) {
  if (!dateText) return '待定';
  const [year, month, day] = dateText.split('-');
  return `${year}.${month}.${day}`;
}

function formatDateLong(dateText) {
  if (!dateText) return '未设置';
  const [year, month, day] = dateText.split('-');
  return `${year}年${month}月${day}日`;
}

function dayLabel(days, isDeadline = false) {
  if (days === null) return '待定';
  if (days < 0) return isDeadline ? `逾期 ${Math.abs(days)} 天` : `已过 ${Math.abs(days)} 天`;
  if (days === 0) return '今天';
  return `${days} 天后`;
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[char]));
}

function showToast(message) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  elements.toastRegion.appendChild(node);
  window.setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    node.style.transition = 'opacity .18s ease, transform .18s ease';
    window.setTimeout(() => node.remove(), 200);
  }, 2200);
}

function statusClass(status) {
  return STATUS_META[status]?.className || 'pending';
}

function getFilteredRecords() {
  const query = currentQuery.trim().toLowerCase();
  let list = records.filter((record) => {
    if (query) {
      const haystack = [record.name, record.version, record.platform, record.orderNo, record.note].join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    const calc = calculate(record);
    if (currentFilter === 'due') return !calc.done && calc.remaining > 0;
    if (currentFilter === 'upcoming') return calc.upcoming;
    if (currentFilter === 'done') return calc.done;
    return true;
  });

  const dateValue = (value) => value || '9999-12-31';
  const urgencyRank = (record) => {
    const calc = calculate(record);
    if (calc.done) return 5;
    if (calc.urgent && calc.deadlineDays < 0) return 0;
    if (calc.urgent) return 1;
    if (calc.upcoming) return 2;
    return 3;
  };

  list = list.slice().sort((a, b) => {
    if (currentSort === 'release') return dateValue(a.releaseDate).localeCompare(dateValue(b.releaseDate));
    if (currentSort === 'deadline') return dateValue(a.paymentDeadline).localeCompare(dateValue(b.paymentDeadline));
    if (currentSort === 'created') return String(b.createdAt).localeCompare(String(a.createdAt));
    if (currentSort === 'amount') return calculate(b).remaining - calculate(a).remaining;
    const rankDiff = urgencyRank(a) - urgencyRank(b);
    if (rankDiff) return rankDiff;
    return dateValue(a.releaseDate).localeCompare(dateValue(b.releaseDate));
  });
  return list;
}

function getNextEvent() {
  const candidates = [];
  records.forEach((record) => {
    const calc = calculate(record);
    if (calc.done) return;
    if (calc.remaining > 0 && record.paymentDeadline) {
      candidates.push({ record, type: 'payment', date: record.paymentDeadline, days: calc.deadlineDays });
    }
    if (record.releaseDate) {
      candidates.push({ record, type: 'release', date: record.releaseDate, days: calc.releaseDays });
    }
  });
  candidates.sort((a, b) => a.date.localeCompare(b.date));
  return candidates[0] || null;
}

function render() {
  renderSummary();
  renderRecords();
  if (elements.settingsDialog.open) elements.settingsCount.textContent = String(records.length);
}

function renderSummary() {
  const active = records.filter((record) => !DONE_STATUSES.has(record.status));
  const due = active.reduce((sum, record) => sum + calculate(record).remaining, 0);
  const upcoming = records.filter((record) => calculate(record).upcoming).length;
  const arrived = records.filter((record) => record.status === '已到货').length;
  const urgent = records.filter((record) => calculate(record).urgent).length;

  elements.statActive.textContent = String(active.length);
  elements.statDue.textContent = formatMoney(due);
  elements.statUpcoming.textContent = String(upcoming);
  elements.statArrived.textContent = String(arrived);

  const hour = new Date().getHours();
  elements.greeting.textContent = hour < 11 ? '早上好，今天要留意什么？' : hour < 18 ? '今天要留意什么？' : '晚上好，看看接下来的预定。';

  if (!records.length) {
    elements.heroTitle.textContent = '把预定期待办，收进一个地方。';
    elements.heroSub.textContent = '记录全款、定金和补款；临近补款与发售时，一眼就能看到。';
  } else {
    elements.heroTitle.textContent = `还有 ${active.length} 件预定在进行中。`;
    if (urgent > 0) {
      elements.heroSub.textContent = `有 ${urgent} 笔补款临近或逾期，建议先处理。`;
    } else if (upcoming > 0) {
      elements.heroSub.textContent = `有 ${upcoming} 件将在 30 天内发售或出货。`;
    } else {
      elements.heroSub.textContent = '目前没有临近的补款或发售，可以安心等待。';
    }
  }

  const next = getNextEvent();
  nextEventId = next?.record.id || null;
  nextEventAction = next?.type === 'payment' ? 'pay' : 'edit';
  if (next) {
    const typeLabel = next.type === 'payment' ? '补款截止' : '发售 / 出货';
    elements.nextCountdown.textContent = dayLabel(next.days, next.type === 'payment');
    elements.nextName.textContent = next.record.name;
    elements.nextDetail.textContent = `${typeLabel}：${formatDateCompact(next.date)} · ${dayLabel(next.days, next.type === 'payment')}`;
    elements.nextAction.textContent = next.type === 'payment' ? '去补款' : '查看详情';
    elements.nextCard.dataset.action = nextEventAction;
    elements.nextCard.dataset.id = next.record.id;
  } else if (records.length) {
    elements.nextCountdown.textContent = '—';
    elements.nextName.textContent = '目前没有临近的补款或发售';
    elements.nextDetail.textContent = '补款或发售日期填好后，这里会自动提示。';
    elements.nextAction.textContent = '查看全部记录';
    elements.nextCard.dataset.action = 'all';
    elements.nextCard.dataset.id = '';
  } else {
    elements.nextCountdown.textContent = '—';
    elements.nextName.textContent = '还没有需要关注的日期';
    elements.nextDetail.textContent = '添加第一笔预定后，这里会自动提示最近的补款或发售。';
    elements.nextAction.textContent = '添加第一笔';
    elements.nextCard.dataset.action = 'add';
    elements.nextCard.dataset.id = '';
  }
}

function eventDateHTML(dateText, days, isDeadline = false) {
  if (!dateText) return '<strong>待定</strong>';
  const className = days !== null && days < 0 && isDeadline ? ' class="is-overdue"' : '';
  return `<strong${className}>${formatDateCompact(dateText)} · ${dayLabel(days, isDeadline)}</strong>`;
}

function recordCardHTML(record) {
  const calc = calculate(record);
  const status = statusClass(record.status);
  const metaParts = [record.version, record.platform, record.orderNo ? `订单 ${record.orderNo}` : ''].filter(Boolean);
  const alert = calc.urgent
    ? (calc.deadlineDays < 0 ? `补款逾期 ${Math.abs(calc.deadlineDays)} 天` : `补款 ${calc.deadlineDays === 0 ? '今天截止' : `${calc.deadlineDays} 天后截止`}`)
    : calc.upcoming
      ? (calc.releaseDays === 0 ? '今天发售' : `发售 ${calc.releaseDays} 天后`)
      : '';
  const canPay = calc.remaining > 0 && !calc.done;
  const note = record.note ? `<p class="card-note">${escapeHTML(record.note)}</p>` : '';
  return `
    <article class="record-card status-${status} ${calc.urgent ? 'is-urgent' : ''} ${calc.upcoming ? 'is-upcoming' : ''}">
      <div class="card-top">
        <span class="status-badge status-${status}">${escapeHTML(record.status)}</span>
        ${alert ? `<span class="card-alert ${calc.upcoming ? 'upcoming' : ''}">${escapeHTML(alert)}</span>` : ''}
      </div>
      <h3 class="card-title">${escapeHTML(record.name)}</h3>
      <p class="card-subtitle">${metaParts.length ? escapeHTML(metaParts.join(' · ')) : '还没有填写版本或店铺'}</p>
      <div class="card-events">
        <div class="event-block"><span>补款截止</span>${eventDateHTML(record.paymentDeadline, calc.deadlineDays, true)}</div>
        <div class="event-block"><span>发售 / 出货</span>${eventDateHTML(record.releaseDate, calc.releaseDays, false)}</div>
      </div>
      <div class="money-block">
        <div class="money-line"><span>剩余待付</span><strong class="remaining">${formatMoney(calc.remaining)}</strong></div>
        <div class="money-list">
          <span>全款 <b>${formatMoney(calc.total)}</b></span>
          <span>定金 <b>${formatMoney(calc.deposit)}</b></span>
          <span>已补款 <b>${formatMoney(calc.paidBalance)}</b></span>
        </div>
        <div class="progress-track" aria-label="已支付 ${calc.progress}%"><div class="progress-fill" style="width:${calc.progress}%"></div></div>
      </div>
      ${note}
      <div class="card-actions">
        ${canPay ? `<button class="btn btn-primary" type="button" data-action="pay" data-id="${escapeHTML(record.id)}">补款</button>` : ''}
        <button class="btn btn-ghost btn-edit" type="button" data-action="edit" data-id="${escapeHTML(record.id)}">编辑</button>
      </div>
    </article>`;
}

function emptyStateHTML() {
  if (!records.length) {
    return `
      <div class="empty-state">
        <div class="empty-icon"><svg viewBox="0 0 48 48"><path d="M11 14h26v23H11z"/><path d="M11 20h26M17 10v8M31 10v8"/><path d="M18 27h5v5h-5zM26 27h5v5h-5z"/></svg></div>
        <h3>还没有预定记录</h3>
        <p>从第一笔预定开始。只填商品、日期和金额，补款与剩余金额会自动算好。</p>
        <div class="empty-actions">
          <button class="btn btn-primary" type="button" data-action="add">添加第一笔预定</button>
          <button class="btn btn-ghost" type="button" data-action="import">导入备份</button>
        </div>
      </div>`;
  }
  return `
    <div class="empty-state">
      <div class="empty-icon"><svg viewBox="0 0 48 48"><circle cx="21" cy="21" r="11"/><path d="m29 29 8 8M16 21h10"/></svg></div>
      <h3>没有找到符合条件的记录</h3>
      <p>换个筛选条件，或清空搜索词再看看。</p>
      <div class="empty-actions"><button class="btn btn-primary" type="button" data-action="clear-filters">查看全部记录</button></div>
    </div>`;
}

function renderRecords() {
  const list = getFilteredRecords();
  const titleMap = { all: '全部记录', due: '待补款', upcoming: '即将发售', done: '已完成' };
  elements.listTitle.textContent = titleMap[currentFilter] || '全部记录';
  elements.listCount.textContent = `${list.length} 条`;
  elements.recordsGrid.innerHTML = list.length ? list.map(recordCardHTML).join('') : emptyStateHTML();
}

elements.recordsGrid.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'add') return openRecordDialog();
  if (action === 'import') return elements.importFile.click();
  if (action === 'clear-filters') {
    currentFilter = 'all';
    currentQuery = '';
    elements.searchInput.value = '';
    $$('.filter-tab').forEach((tab) => {
      const active = tab.dataset.filter === 'all';
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    return render();
  }
  const id = button.dataset.id;
  if (!id) return;
  if (action === 'pay') return openPaymentDialog(id);
  if (action === 'edit') {
    const record = records.find((item) => item.id === id);
    if (record) openRecordDialog(record);
  }
});

elements.nextAction.addEventListener('click', () => {
  const action = elements.nextCard.dataset.action;
  const id = elements.nextCard.dataset.id;
  if (action === 'add') return openRecordDialog();
  if (action === 'pay' && id) return openPaymentDialog(id);
  if (action === 'edit' && id) {
    const record = records.find((item) => item.id === id);
    if (record) return openRecordDialog(record);
  }
  document.querySelector('.records-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

function showDialog(dialog) {
  if (!dialog.open) dialog.showModal();
  document.body.classList.add('modal-open');
}

function closeDialog(dialog) {
  if (dialog?.open) dialog.close();
}

function updateModalBodyState() {
  const anyOpen = [elements.recordDialog, elements.paymentDialog, elements.settingsDialog].some((dialog) => dialog.open);
  document.body.classList.toggle('modal-open', anyOpen);
}

function openRecordDialog(record = null) {
  editingId = record?.id || null;
  elements.recordForm.reset();
  elements.recordId.value = record?.id || '';
  elements.recordDialogTitle.textContent = record ? '编辑预定' : '新增预定';
  elements.deleteRecordButton.hidden = !record;
  $('#name').value = record?.name || '';
  $('#version').value = record?.version || '';
  $('#platform').value = record?.platform || '';
  $('#orderNo').value = record?.orderNo || '';
  $('#preorderDate').value = record?.preorderDate || todayISO();
  $('#releaseDate').value = record?.releaseDate || '';
  $('#paymentDeadline').value = record?.paymentDeadline || '';
  $('#status').value = record?.status || '待补款';
  $('#total').value = record?.total ? String(record.total) : '';
  $('#deposit').value = record?.deposit ? String(record.deposit) : '';
  $('#paidBalance').value = record?.paidBalance ? String(record.paidBalance) : '';
  $('#note').value = record?.note || '';
  $('#formError').textContent = '';
  updateFormCalc();
  showDialog(elements.recordDialog);
  window.setTimeout(() => $('#name').focus(), 80);
}

function updateFormCalc() {
  const total = numberValue($('#total').value);
  const deposit = numberValue($('#deposit').value);
  const paidBalance = numberValue($('#paidBalance').value);
  const due = Math.max(0, round2(total - deposit));
  const remaining = Math.max(0, round2(total - deposit - paidBalance));
  const paidTotal = round2(deposit + paidBalance);
  $('#formDue').textContent = formatMoney(due);
  $('#formRemaining').textContent = formatMoney(remaining);
  $('#formPaidTotal').textContent = formatMoney(paidTotal);
}

function validateRecordForm() {
  const name = $('#name').value.trim();
  const total = numberValue($('#total').value);
  const deposit = numberValue($('#deposit').value);
  const paidBalance = numberValue($('#paidBalance').value);
  if (!name) return '请填写商品名称。';
  if (!$('#total').value.trim()) return '请填写全款或预计总价。';
  if (deposit > total + 0.001) return '定金不能超过全款。';
  if (deposit + paidBalance > total + 0.001) return '定金与已补款合计不能超过全款。';
  return '';
}

elements.recordForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const error = validateRecordForm();
  if (error) {
    $('#formError').textContent = error;
    return;
  }
  const existing = editingId ? records.find((record) => record.id === editingId) : null;
  const now = new Date().toISOString();
  const record = normalizeRecord({
    id: existing?.id || makeId(),
    name: $('#name').value,
    version: $('#version').value,
    platform: $('#platform').value,
    orderNo: $('#orderNo').value,
    preorderDate: $('#preorderDate').value,
    releaseDate: $('#releaseDate').value,
    paymentDeadline: $('#paymentDeadline').value,
    status: $('#status').value,
    total: numberValue($('#total').value),
    deposit: numberValue($('#deposit').value),
    paidBalance: numberValue($('#paidBalance').value),
    note: $('#note').value,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });
  if (existing) {
    records = records.map((item) => item.id === existing.id ? record : item);
  } else {
    records = [record, ...records];
  }
  if (!saveRecords()) return;
  closeDialog(elements.recordDialog);
  render();
  showToast(existing ? '预定已更新' : '预定已添加');
});

elements.deleteRecordButton.addEventListener('click', () => {
  if (!editingId) return;
  const record = records.find((item) => item.id === editingId);
  if (!record) return;
  if (!window.confirm(`确定删除“${record.name}”吗？此操作不可撤销。`)) return;
  records = records.filter((item) => item.id !== editingId);
  saveRecords();
  closeDialog(elements.recordDialog);
  render();
  showToast('记录已删除');
});

['total', 'deposit', 'paidBalance'].forEach((id) => {
  $(`#${id}`).addEventListener('input', updateFormCalc);
});

function openPaymentDialog(id) {
  const record = records.find((item) => item.id === id);
  if (!record) return;
  const calc = calculate(record);
  if (calc.remaining <= 0) {
    showToast('这笔预定已经没有待付款');
    return;
  }
  payingId = id;
  elements.paymentName.textContent = record.name;
  elements.paymentMeta.textContent = `剩余待付 ${formatMoney(calc.remaining)} · 已付 ${formatMoney(calc.paidTotal)}`;
  elements.paymentAmount.value = '';
  elements.paymentAmount.max = String(calc.remaining);
  elements.paymentError.textContent = '';
  showDialog(elements.paymentDialog);
  window.setTimeout(() => elements.paymentAmount.focus(), 80);
}

elements.paymentForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const record = records.find((item) => item.id === payingId);
  if (!record) return;
  const calc = calculate(record);
  const amount = numberValue(elements.paymentAmount.value);
  if (!elements.paymentAmount.value.trim() || amount <= 0) {
    elements.paymentError.textContent = '请输入大于 0 的补款金额。';
    return;
  }
  if (amount > calc.remaining + 0.001) {
    elements.paymentError.textContent = '补款金额不能超过剩余待付。';
    return;
  }
  const newPaid = round2(calc.paidBalance + amount);
  const newRemaining = Math.max(0, round2(calc.remaining - amount));
  const updated = {
    ...record,
    paidBalance: newPaid,
    status: newRemaining <= 0 && ['待付定金', '待补款'].includes(record.status) ? '已补款待发货' : record.status,
    updatedAt: new Date().toISOString(),
  };
  records = records.map((item) => item.id === record.id ? updated : item);
  if (!saveRecords()) return;
  closeDialog(elements.paymentDialog);
  render();
  showToast(newRemaining <= 0 ? '已补清，状态更新为已补款待发货' : `已记录补款 ${formatMoney(amount)}`);
});

$$('[data-pay-fill]').forEach((button) => {
  button.addEventListener('click', () => {
    const record = records.find((item) => item.id === payingId);
    if (!record) return;
    const remaining = calculate(record).remaining;
    elements.paymentAmount.value = String(button.dataset.payFill === 'half' ? round2(remaining / 2) : remaining);
    elements.paymentError.textContent = '';
  });
});

function openSettings() {
  elements.settingsCount.textContent = String(records.length);
  elements.installButton.hidden = !deferredInstallPrompt;
  showDialog(elements.settingsDialog);
}

$('#addButton').addEventListener('click', () => openRecordDialog());
$('#fab').addEventListener('click', () => openRecordDialog());
$('#settingsButton').addEventListener('click', openSettings);
$('#footerSettings').addEventListener('click', openSettings);

$$('[data-close-dialog]').forEach((button) => {
  button.addEventListener('click', () => closeDialog(document.getElementById(button.dataset.closeDialog)));
});

[elements.recordDialog, elements.paymentDialog, elements.settingsDialog].forEach((dialog) => {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeDialog(dialog);
  });
  dialog.addEventListener('close', updateModalBodyState);
});

$$('.filter-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    currentFilter = tab.dataset.filter;
    $$('.filter-tab').forEach((item) => {
      const active = item === tab;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    });
    renderRecords();
  });
});

elements.searchInput.addEventListener('input', () => {
  currentQuery = elements.searchInput.value;
  renderRecords();
});

elements.sortSelect.addEventListener('change', () => {
  currentSort = elements.sortSelect.value;
  renderRecords();
});

document.addEventListener('keydown', (event) => {
  const tag = document.activeElement?.tagName;
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag);
  if (typing || document.body.classList.contains('modal-open')) return;
  if (event.key.toLowerCase() === 'n') {
    event.preventDefault();
    openRecordDialog();
  }
  if (event.key === '/') {
    event.preventDefault();
    elements.searchInput.focus();
  }
});

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function backupFilename(extension) {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `模玩预定簿_${stamp}.${extension}`;
}

$('#exportJsonButton').addEventListener('click', () => {
  const payload = {
    app: '模玩预定簿',
    version: 1,
    exportedAt: new Date().toISOString(),
    records,
  };
  downloadBlob(backupFilename('json'), new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }));
  showToast('完整备份已导出');
});

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

$('#exportCsvButton').addEventListener('click', () => {
  const header = ['商品名称', '版本规格', '平台店铺', '订单号', '预定日期', '发售出货日', '补款截止日', '状态', '全款', '定金', '补款应付', '已补款', '剩余待付', '备注'];
  const rows = records.map((record) => {
    const calc = calculate(record);
    return [
      record.name, record.version, record.platform, record.orderNo, record.preorderDate,
      record.releaseDate, record.paymentDeadline, record.status, calc.total, calc.deposit,
      calc.due, calc.paidBalance, calc.remaining, record.note,
    ].map(csvCell).join(',');
  });
  const csv = '\ufeff' + [header.map(csvCell).join(','), ...rows].join('\r\n');
  downloadBlob(backupFilename('csv'), new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  showToast('CSV 已导出');
});

$('#importButton').addEventListener('click', () => elements.importFile.click());

elements.importFile.addEventListener('change', async () => {
  const file = elements.importFile.files?.[0];
  elements.importFile.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const incomingRaw = Array.isArray(parsed) ? parsed : parsed.records;
    if (!Array.isArray(incomingRaw)) throw new Error('文件里没有记录列表');
    const incoming = incomingRaw.map(normalizeRecord).filter((record) => record.name);
    if (!incoming.length) throw new Error('没有可导入的记录');
    if (!window.confirm(`准备导入 ${incoming.length} 条记录。相同 ID 的记录会被更新，是否继续？`)) return;
    const map = new Map(records.map((record) => [record.id, record]));
    incoming.forEach((record) => map.set(record.id, record));
    records = Array.from(map.values());
    if (!saveRecords()) return;
    render();
    showToast(`已导入 ${incoming.length} 条记录`);
  } catch (error) {
    console.error(error);
    showToast('导入失败，请确认文件是完整备份 JSON');
  }
});

$('#clearDataButton').addEventListener('click', () => {
  if (!records.length) {
    showToast('当前没有记录');
    return;
  }
  if (!window.confirm(`确定清空全部 ${records.length} 条记录吗？此操作不可撤销，建议先导出备份。`)) return;
  records = [];
  saveRecords();
  closeDialog(elements.settingsDialog);
  render();
  showToast('全部记录已清空');
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  elements.installButton.hidden = false;
});

elements.installButton.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  try {
    await deferredInstallPrompt.userChoice;
  } finally {
    deferredInstallPrompt = null;
    elements.installButton.hidden = true;
  }
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  elements.installButton.hidden = true;
  showToast('已安装到主屏幕');
});

window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY) return;
  records = loadRecords();
  render();
});

window.addEventListener('online', () => showToast('网络已恢复'));
window.addEventListener('offline', () => showToast('当前离线，本地记录仍可使用'));

if ('serviceWorker' in navigator && ['http:', 'https:'].includes(location.protocol)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('Service worker 注册失败', error));
  });
}

if (navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {});
}

render();
