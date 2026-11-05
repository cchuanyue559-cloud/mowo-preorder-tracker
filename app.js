'use strict';

const STORAGE_KEY = 'mowo-preorders-v1';
const WISHLIST_KEY = 'mowo-wishlist-v1';
const CHANNEL_NAME = 'mowo-preorders-updates';
const MEDIA_DB_NAME = 'mowo-preorder-media';
const MEDIA_STORE_NAME = 'images';
const MAX_IMAGE_DIMENSION = 800;
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
  addButton: $('#addButton'),
  viewTabs: $$('.view-tab'),
  preorderView: $('#preorderView'),
  wishlistView: $('#wishlistView'),
  preorderViewCount: $('#preorderViewCount'),
  wishlistViewCount: $('#wishlistViewCount'),
  recordsGrid: $('#recordsGrid'),
  wishlistGrid: $('#wishlistGrid'),
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
  imageInput: $('#imageInput'),
  chooseImageButton: $('#chooseImageButton'),
  removeImageButton: $('#removeImageButton'),
  recordImagePreview: $('#recordImagePreview'),
  recordImagePreviewImg: $('#recordImagePreviewImg'),
  wishlistStatTotal: $('#wishlistStatTotal'),
  wishlistStatMust: $('#wishlistStatMust'),
  wishlistStatPrices: $('#wishlistStatPrices'),
  wishlistSearchInput: $('#wishlistSearchInput'),
  wishlistSortSelect: $('#wishlistSortSelect'),
  wishlistListTitle: $('#wishlistListTitle'),
  wishlistListCount: $('#wishlistListCount'),
  wishlistDialog: $('#wishlistDialog'),
  wishlistForm: $('#wishlistForm'),
  wishlistDialogTitle: $('#wishlistDialogTitle'),
  wishlistId: $('#wishlistId'),
  deleteWishlistButton: $('#deleteWishlistButton'),
  wishlistImageInput: $('#wishlistImageInput'),
  wishlistChooseImageButton: $('#wishlistChooseImageButton'),
  wishlistRemoveImageButton: $('#wishlistRemoveImageButton'),
  wishlistImagePreview: $('#wishlistImagePreview'),
  wishlistImagePreviewImg: $('#wishlistImagePreviewImg'),
  wishlistFormError: $('#wishlistFormError'),
  priceDialog: $('#priceDialog'),
  priceDialogName: $('#priceDialogName'),
  priceLatest: $('#priceLatest'),
  priceLow: $('#priceLow'),
  priceRelease: $('#priceRelease'),
  priceForm: $('#priceForm'),
  priceWishlistId: $('#priceWishlistId'),
  priceAmount: $('#priceAmount'),
  priceDate: $('#priceDate'),
  priceNote: $('#priceNote'),
  priceHistoryCount: $('#priceHistoryCount'),
  priceHistoryList: $('#priceHistoryList'),
  backToTop: $('#backToTop'),
  settingsDialog: $('#settingsDialog'),
  settingsCount: $('#settingsCount'),
  importFile: $('#importFile'),
  installButton: $('#installButton'),
  toastRegion: $('#toastRegion'),
};

let records = loadRecords();
let wishlist = loadWishlist();
let currentView = 'preorder';
let currentFilter = 'all';
let currentSort = 'smart';
let currentQuery = '';
let wishlistFilter = 'all';
let wishlistSort = 'smart';
let wishlistQuery = '';
let editingId = null;
let editingWishlistId = null;
let priceWishlistId = null;
let nextEventId = null;
let deferredInstallPrompt = null;
let channel = null;
let imageCache = new Map();
let mediaDbPromise = null;
let pendingImageData = null;
let pendingImageChanged = false;
let pendingImageRemoved = false;
let pendingWishlistImageData = null;
let pendingWishlistImageChanged = false;
let pendingWishlistImageRemoved = false;

try {
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.addEventListener('message', async () => {
    records = loadRecords();
    wishlist = loadWishlist();
    await hydrateImageCache();
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
  const validMonth = (value) => {
    if (!value) return '';
    const text = String(value).slice(0, 7);
    return /^\d{4}-\d{2}$/.test(text) ? text : '';
  };
  return {
    id: String(raw.id || makeId()),
    name: String(raw.name || '').trim().slice(0, 80),
    version: String(raw.version || '').trim().slice(0, 50),
    platform: String(raw.platform || '').trim().slice(0, 50),
    orderNo: String(raw.orderNo || '').trim().slice(0, 60),
    imageId: String(raw.imageId || '').trim(),
    preorderDate: validDate(raw.preorderDate),
    releaseDate: validDate(raw.releaseDate),
    releaseMonth: validMonth(raw.releaseMonth || raw.releaseDate),
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

function normalizeWishlist(raw = {}) {
  const now = new Date().toISOString();
  const validMonth = (value) => {
    const text = String(value || '').slice(0, 7);
    return /^\d{4}-\d{2}$/.test(text) ? text : '';
  };
  const validDate = (value) => {
    const text = String(value || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
  };
  const allowedPriority = ['普通', '优先', '必买'];
  const allowedStatus = ['观望中', '等待好价', '已购', '已放弃'];
  const priceHistory = Array.isArray(raw.priceHistory)
    ? raw.priceHistory.map((entry, index) => ({
        id: String(entry.id || `price-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`),
        price: numberValue(entry.price),
        date: validDate(entry.date),
        note: String(entry.note || '').trim().slice(0, 100),
        createdAt: entry.createdAt || now,
      })).filter((entry) => entry.price > 0).slice(-200)
    : [];
  return {
    id: String(raw.id || makeId()),
    name: String(raw.name || '').trim().slice(0, 80),
    imageId: String(raw.imageId || '').trim(),
    priority: allowedPriority.includes(raw.priority) ? raw.priority : '普通',
    releasePrice: numberValue(raw.releasePrice),
    priceHistory,
    note: String(raw.note || '').trim().slice(0, 300),
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
    platform: String(raw.platform || '').trim().slice(0, 50),
    releaseMonth: validMonth(raw.releaseMonth),
    targetPrice: numberValue(raw.targetPrice),
    status: allowedStatus.includes(raw.status) ? raw.status : '',
  };
}

function loadWishlist() {
  try {
    const parsed = JSON.parse(localStorage.getItem(WISHLIST_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeWishlist).filter((item) => item.name);
  } catch (error) {
    console.warn('读取愿望单失败', error);
    return [];
  }
}

function saveWishlist() {
  try {
    localStorage.setItem(WISHLIST_KEY, JSON.stringify(wishlist));
    channel?.postMessage({ type: 'updated' });
    return true;
  } catch (error) {
    console.error('保存愿望单失败', error);
    showToast('愿望单保存失败，请检查浏览器存储空间');
    return false;
  }
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


function openMediaDb() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB 不可用'));
  if (!mediaDbPromise) {
    mediaDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(MEDIA_DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(MEDIA_STORE_NAME)) {
          request.result.createObjectStore(MEDIA_STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return mediaDbPromise;
}

async function putCachedImage(id, dataUrl) {
  const db = await openMediaDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(MEDIA_STORE_NAME, 'readwrite');
    tx.objectStore(MEDIA_STORE_NAME).put(dataUrl, id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  imageCache.set(id, dataUrl);
}

async function deleteCachedImage(id) {
  if (!id) return;
  const db = await openMediaDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(MEDIA_STORE_NAME, 'readwrite');
    tx.objectStore(MEDIA_STORE_NAME).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  imageCache.delete(id);
}

async function getAllCachedImages() {
  const db = await openMediaDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEDIA_STORE_NAME, 'readonly');
    const request = tx.objectStore(MEDIA_STORE_NAME).openCursor();
    const entries = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve(entries);
      entries.push([cursor.key, cursor.value]);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

async function clearCachedImages() {
  const db = await openMediaDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(MEDIA_STORE_NAME, 'readwrite');
    tx.objectStore(MEDIA_STORE_NAME).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  imageCache.clear();
}

async function hydrateImageCache() {
  try {
    imageCache = new Map(await getAllCachedImages());
    const usedIds = new Set([...records, ...wishlist].map((item) => item.imageId).filter(Boolean));
    for (const id of Array.from(imageCache.keys())) {
      if (!usedIds.has(id)) {
        imageCache.delete(id);
        await deleteCachedImage(id);
      }
    }
  } catch (error) {
    console.warn('图片缓存读取失败', error);
  }
}

async function compressImageFile(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('请选择图片文件');
  if (file.size > 25 * 1024 * 1024) throw new Error('图片不能超过 25MB');
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    if (image.decode) await image.decode();
    else await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
    });
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let dataUrl = canvas.toDataURL('image/jpeg', 0.78);
    if (dataUrl.length > 320000) dataUrl = canvas.toDataURL('image/jpeg', 0.62);
    if (dataUrl.length > 420000) throw new Error('图片压缩后仍然过大，请换一张图片');
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
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
  const releaseDays = daysUntilMonth(record.releaseMonth || record.releaseDate);
  const done = DONE_STATUSES.has(record.status);
  const urgent = false;
  const upcoming = !done && releaseDays !== null && releaseDays >= 0 && releaseDays <= 30;
  return { total, deposit, paidBalance, due, remaining, paidTotal, progress, releaseDays, done, urgent, upcoming };
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function todayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function daysUntilMonth(monthText) {
  if (!monthText) return null;
  const text = String(monthText).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(text)) return null;
  return daysUntil(`${text}-01`);
}

function formatMonth(monthText) {
  if (!monthText) return '月份待定';
  const [year, month] = monthText.split('-');
  return `${year}年${month}月`;
}

function formatMonthCompact(monthText) {
  if (!monthText) return '待定';
  return monthText.replace('-', '.');
}

function monthRelativeLabel(days) {
  if (days === null) return '月份待定';
  if (days < 0) return `已过 ${Math.abs(days)} 天`;
  if (days === 0) return '本月';
  return `约 ${days} 天后`;
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

function showToast(message, actionLabel = '', onAction = null, duration = 2200) {
  const node = document.createElement('div');
  node.className = 'toast';
  const text = document.createElement('span');
  text.textContent = message;
  node.appendChild(text);
  if (actionLabel && onAction) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'toast-action';
    action.textContent = actionLabel;
    action.addEventListener('click', () => {
      node.remove();
      onAction();
    });
    node.appendChild(action);
  }
  elements.toastRegion.replaceChildren(node);
  window.setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    node.style.transition = 'opacity .18s ease, transform .18s ease';
    window.setTimeout(() => node.remove(), 200);
  }, duration);
}

function statusClass(status) {
  return STATUS_META[status]?.className || 'pending';
}

function getFilteredRecords() {
  const query = currentQuery.trim().toLowerCase();
  let list = records.filter((record) => {
    if (query) {
      const haystack = [record.name, record.platform, record.note].join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    const calc = calculate(record);
    if (currentFilter === 'due') return !calc.done && calc.remaining > 0;
    if (currentFilter === 'upcoming') return calc.upcoming;
    if (currentFilter === 'done') return calc.done;
    return true;
  });

  const monthValue = (value) => value || '9999-12';
  const smartRank = (record) => {
    const calc = calculate(record);
    if (calc.done) return 3;
    if (calc.upcoming) return 0;
    return 1;
  };

  list = list.slice().sort((a, b) => {
    if (currentSort === 'release') return monthValue(a.releaseMonth).localeCompare(monthValue(b.releaseMonth));
    if (currentSort === 'created') return String(b.createdAt).localeCompare(String(a.createdAt));
    if (currentSort === 'amount') return calculate(b).remaining - calculate(a).remaining;
    const rankDiff = smartRank(a) - smartRank(b);
    if (rankDiff) return rankDiff;
    return monthValue(a.releaseMonth).localeCompare(monthValue(b.releaseMonth));
  });
  return list;
}

function getNextEvent() {
  const candidates = records
    .filter((record) => !DONE_STATUSES.has(record.status) && record.releaseMonth)
    .map((record) => ({ record, date: record.releaseMonth, days: calculate(record).releaseDays }));
  candidates.sort((a, b) => a.date.localeCompare(b.date));
  return candidates[0] || null;
}

function render() {
  renderSummary();
  renderRecords();
  renderWishlist();
  elements.preorderViewCount.textContent = String(records.length);
  elements.wishlistViewCount.textContent = String(wishlist.length);
  if (elements.settingsDialog.open) elements.settingsCount.textContent = String(records.length + wishlist.length);
}

function renderSummary() {
  const active = records.filter((record) => !DONE_STATUSES.has(record.status));
  const due = active.reduce((sum, record) => sum + calculate(record).remaining, 0);
  const upcoming = records.filter((record) => calculate(record).upcoming).length;
  const arrived = records.filter((record) => record.status === '已到货').length;

  elements.statActive.textContent = String(active.length);
  elements.statDue.textContent = formatMoney(due);
  elements.statUpcoming.textContent = String(upcoming);
  elements.statArrived.textContent = String(arrived);

  const hour = new Date().getHours();
  elements.greeting.textContent = hour < 11 ? '早上好，今天要留意什么？' : hour < 18 ? '今天要留意什么？' : '晚上好，看看接下来的预定。';

  if (!records.length) {
    elements.heroTitle.textContent = '把预定期待办，收进一个地方。';
    elements.heroSub.textContent = '记录全款、定金和补款；用发售月份查看接下来的预定。';
  } else {
    elements.heroTitle.textContent = `还有 ${active.length} 件预定在进行中。`;
    if (upcoming > 0) {
      elements.heroSub.textContent = `有 ${upcoming} 件将在 30 天内进入发售月份。`;
    } else {
      elements.heroSub.textContent = '目前没有临近的发售月份，可以安心等待。';
    }
  }

  const next = getNextEvent();
  nextEventId = next?.record.id || null;
  if (next) {
    elements.nextCountdown.textContent = monthRelativeLabel(next.days);
    elements.nextName.textContent = next.record.name;
    elements.nextDetail.textContent = `发售月份：${formatMonth(next.date)} · ${monthRelativeLabel(next.days)}`;
    elements.nextAction.textContent = '查看详情';
    elements.nextCard.dataset.action = 'edit';
    elements.nextCard.dataset.id = next.record.id;
  } else if (records.length) {
    elements.nextCountdown.textContent = '—';
    elements.nextName.textContent = '还没有填写发售月份';
    elements.nextDetail.textContent = '补上发售月份后，这里会自动显示最近的预定。';
    elements.nextAction.textContent = '查看全部记录';
    elements.nextCard.dataset.action = 'all';
    elements.nextCard.dataset.id = '';
  } else {
    elements.nextCountdown.textContent = '—';
    elements.nextName.textContent = '还没有需要关注的日期';
    elements.nextDetail.textContent = '添加第一笔预定后，这里会自动提示最近的发售月份。';
    elements.nextAction.textContent = '添加第一笔';
    elements.nextCard.dataset.action = 'add';
    elements.nextCard.dataset.id = '';
  }
}

function eventMonthHTML(monthText, days) {
  if (!monthText) return '<strong>月份待定</strong>';
  const className = days !== null && days < 0 ? ' class="is-overdue"' : '';
  return `<strong${className}>${formatMonth(monthText)}</strong>`;
}

function recordCardHTML(record) {
  const calc = calculate(record);
  const status = statusClass(record.status);
  const alert = calc.upcoming ? `发售 ${monthRelativeLabel(calc.releaseDays)}` : '';
  const canPay = calc.remaining > 0 && !calc.done;
  const note = record.note ? `<p class="card-note">${escapeHTML(record.note)}</p>` : '';
  const imageUrl = record.imageId ? imageCache.get(record.imageId) : '';
  const meta = record.platform || '还没有填写平台或店铺';
  const productBlock = `
    <div class="card-product">
      ${imageUrl ? `<img class="card-thumb" src="${escapeHTML(imageUrl)}" alt="${escapeHTML(record.name)} 商品图片" loading="lazy">` : ''}
      <div class="card-title-wrap">
        <h3 class="card-title">${escapeHTML(record.name)}</h3>
        <p class="card-subtitle">${escapeHTML(meta)}</p>
      </div>
    </div>`;
  return `
    <article class="record-card status-${status} ${calc.upcoming ? 'is-upcoming' : ''}">
      <div class="card-top">
        <span class="status-badge status-${status}">${escapeHTML(record.status)}</span>
        ${alert ? `<span class="card-alert upcoming">${escapeHTML(alert)}</span>` : ''}
      </div>
      ${productBlock}
      <div class="card-events">
        <div class="event-block"><span>发售月份</span>${eventMonthHTML(record.releaseMonth, calc.releaseDays)}</div>
        <div class="event-block"><span>平台 / 店铺</span><strong>${escapeHTML(record.platform || '未填写')}</strong></div>
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
        ${canPay ? `<button class="btn btn-primary" type="button" data-action="pay" data-id="${escapeHTML(record.id)}">一键补款</button>` : ''}
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

function wishlistPriorityClass(priority) {
  return { '普通': 'priority-normal', '优先': 'priority-high', '必买': 'priority-must' }[priority] || 'priority-normal';
}

function getPriceStats(item) {
  const history = (item.priceHistory || []).slice().sort((a, b) => {
    const dateDiff = String(b.date || '').localeCompare(String(a.date || ''));
    if (dateDiff) return dateDiff;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
  const latestEntry = history[0] || null;
  const lowEntry = history.reduce((low, entry) => (!low || entry.price < low.price ? entry : low), null);
  return { history, latestEntry, latestPrice: latestEntry?.price || 0, lowPrice: lowEntry?.price || 0, releasePrice: numberValue(item.releasePrice) };
}

function getFilteredWishlist() {
  const query = wishlistQuery.trim().toLowerCase();
  let list = wishlist.filter((item) => {
    if (query) {
      const haystack = [item.name, item.note].join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (wishlistFilter === 'must') return item.priority === '必买';
    if (wishlistFilter === 'high') return item.priority === '优先';
    return true;
  });
  const priorityRank = (priority) => ({ '必买': 0, '优先': 1, '普通': 2 }[priority] ?? 2);
  list = list.slice().sort((a, b) => {
    const aStats = getPriceStats(a);
    const bStats = getPriceStats(b);
    if (wishlistSort === 'latest') return (bStats.latestPrice || 0) - (aStats.latestPrice || 0);
    if (wishlistSort === 'low') return (bStats.lowPrice || 0) - (aStats.lowPrice || 0);
    if (wishlistSort === 'releasePrice') return (bStats.releasePrice || 0) - (aStats.releasePrice || 0);
    if (wishlistSort === 'created') return String(b.createdAt).localeCompare(String(a.createdAt));
    const priorityDiff = priorityRank(a.priority) - priorityRank(b.priority);
    if (priorityDiff) return priorityDiff;
    return String(b.updatedAt).localeCompare(String(a.updatedAt));
  });
  return list;
}

function wishlistCardHTML(item) {
  const stats = getPriceStats(item);
  const imageUrl = item.imageId ? imageCache.get(item.imageId) : '';
  const note = item.note ? `<p class="card-note">${escapeHTML(item.note)}</p>` : '';
  const priceCount = item.priceHistory?.length || 0;
  return `
    <article class="record-card wishlist-card">
      <div class="card-top">
        <span class="wishlist-priority ${wishlistPriorityClass(item.priority)}">${escapeHTML(item.priority)}</span>
        <span class="price-count-badge">${priceCount ? `${priceCount} 次价格` : '暂无价格'}</span>
      </div>
      <div class="card-product">
        ${imageUrl ? `<img class="card-thumb" src="${escapeHTML(imageUrl)}" alt="${escapeHTML(item.name)} 愿望图片" loading="lazy">` : ''}
        <div class="card-title-wrap">
          <h3 class="card-title">${escapeHTML(item.name)}</h3>
          <p class="card-subtitle">价格跟踪清单</p>
        </div>
      </div>
      <div class="price-stats-grid">
        <div class="price-stat"><span>最近价格</span><strong>${stats.latestPrice ? formatMoney(stats.latestPrice) : '—'}</strong></div>
        <div class="price-stat low"><span>历史最低</span><strong>${stats.lowPrice ? formatMoney(stats.lowPrice) : '—'}</strong></div>
        <div class="price-stat release"><span>发售价格</span><strong>${stats.releasePrice ? formatMoney(stats.releasePrice) : '—'}</strong></div>
      </div>
      ${note}
      <div class="card-actions">
        <button class="btn btn-primary" type="button" data-action="wishlist-price" data-id="${escapeHTML(item.id)}">记录价格</button>
        <button class="btn btn-ghost btn-edit" type="button" data-action="wishlist-edit" data-id="${escapeHTML(item.id)}">编辑</button>
      </div>
    </article>`;
}

function wishlistEmptyHTML() {
  if (!wishlist.length) {
    return `
      <div class="empty-state wishlist-empty">
        <div class="empty-icon"><svg viewBox="0 0 48 48"><path d="M24 40S8 31 8 19a9 9 0 0 1 16-5 9 9 0 0 1 16 5c0 12-16 21-16 21Z"/></svg></div>
        <h3>愿望单还是空的</h3>
        <p>把想买的模型记下来，之后随时添加看到的价格。</p>
        <div class="empty-actions"><button class="btn btn-primary" type="button" data-action="wishlist-add">添加第一个愿望</button></div>
      </div>`;
  }
  return `<div class="empty-state wishlist-empty"><div class="empty-icon"><svg viewBox="0 0 48 48"><circle cx="21" cy="21" r="11"/><path d="m29 29 8 8M16 21h10"/></svg></div><h3>没有找到符合条件的愿望</h3><p>换个筛选条件或清空搜索词。</p><div class="empty-actions"><button class="btn btn-primary" type="button" data-action="clear-wishlist-filters">查看全部愿望</button></div></div>`;
}

function renderWishlist() {
  const mustCount = wishlist.filter((item) => item.priority === '必买').length;
  const priceCount = wishlist.reduce((sum, item) => sum + (item.priceHistory?.length || 0), 0);
  elements.wishlistStatTotal.textContent = String(wishlist.length);
  elements.wishlistStatMust.textContent = String(mustCount);
  elements.wishlistStatPrices.textContent = String(priceCount);
  const list = getFilteredWishlist();
  const titleMap = { all: '全部愿望', must: '必买愿望', high: '优先愿望' };
  elements.wishlistListTitle.textContent = titleMap[wishlistFilter] || '全部愿望';
  elements.wishlistListCount.textContent = `${list.length} 个`;
  elements.wishlistGrid.innerHTML = list.length ? list.map(wishlistCardHTML).join('') : wishlistEmptyHTML();
}

elements.wishlistGrid.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'wishlist-add') return openWishlistDialog();
  if (action === 'clear-wishlist-filters') {
    wishlistFilter = 'all';
    wishlistQuery = '';
    elements.wishlistSearchInput.value = '';
    $$('#wishlistFilters .filter-tab').forEach((tab) => {
      const active = tab.dataset.wishlistFilter === 'all';
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    return renderWishlist();
  }
  const id = button.dataset.id;
  const item = wishlist.find((entry) => entry.id === id);
  if (!item) return;
  if (action === 'wishlist-edit') return openWishlistDialog(item);
  if (action === 'wishlist-price') return openPriceDialog(id);
});

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
  if (action === 'pay') return recordFullPayment(id);
  if (action === 'edit') {
    const record = records.find((item) => item.id === id);
    if (record) openRecordDialog(record);
  }
});

elements.nextAction.addEventListener('click', () => {
  const action = elements.nextCard.dataset.action;
  const id = elements.nextCard.dataset.id;
  if (action === 'add') return openRecordDialog();
  if (action === 'edit' && id) {
    const record = records.find((item) => item.id === id);
    if (record) return openRecordDialog(record);
  }
  elements.recordsGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

function showDialog(dialog) {
  if (!dialog.open) dialog.showModal();
  document.body.classList.add('modal-open');
}

function closeDialog(dialog) {
  if (dialog?.open) dialog.close();
}

function updateModalBodyState() {
  const anyOpen = [elements.recordDialog, elements.wishlistDialog, elements.priceDialog, elements.settingsDialog].some((dialog) => dialog.open);
  document.body.classList.toggle('modal-open', anyOpen);
}

function openRecordDialog(record = null) {
  editingId = record?.id || null;
  pendingImageData = null;
  pendingImageChanged = false;
  pendingImageRemoved = false;
  elements.imageInput.value = '';
  elements.recordForm.reset();
  elements.recordId.value = record?.id || '';
  elements.recordDialogTitle.textContent = record ? '编辑预定' : '新增预定';
  elements.deleteRecordButton.hidden = !record;
  $('#name').value = record?.name || '';
  $('#platform').value = record?.platform || '';
  $('#releaseMonth').value = record?.releaseMonth || '';
  $('#status').value = record?.status || '待补款';
  $('#total').value = record?.total ? String(record.total) : '';
  $('#deposit').value = record?.deposit ? String(record.deposit) : '';
  $('#paidBalance').value = record?.paidBalance ? String(record.paidBalance) : '';
  $('#note').value = record?.note || '';
  $('#formError').textContent = '';
  updateFormCalc();
  renderRecordImagePreview();
  showDialog(elements.recordDialog);
  window.setTimeout(() => $('#name').focus(), 80);
}

function renderRecordImagePreview() {
  let src = '';
  if (!pendingImageRemoved) {
    if (pendingImageData) src = pendingImageData;
    else if (editingId) {
      const record = records.find((item) => item.id === editingId);
      src = record?.imageId ? imageCache.get(record.imageId) || '' : '';
    }
  }
  const hasImage = Boolean(src);
  elements.recordImagePreview.classList.toggle('has-image', hasImage);
  elements.recordImagePreviewImg.hidden = !hasImage;
  if (hasImage) elements.recordImagePreviewImg.src = src;
  else elements.recordImagePreviewImg.removeAttribute('src');
  elements.removeImageButton.hidden = !hasImage;
}

elements.chooseImageButton.addEventListener('click', () => elements.imageInput.click());
elements.removeImageButton.addEventListener('click', () => {
  pendingImageData = null;
  pendingImageChanged = true;
  pendingImageRemoved = true;
  renderRecordImagePreview();
});
elements.imageInput.addEventListener('change', async () => {
  const file = elements.imageInput.files?.[0];
  if (!file) return;
  const originalText = elements.chooseImageButton.textContent;
  elements.chooseImageButton.disabled = true;
  elements.chooseImageButton.textContent = '处理中…';
  $('#formError').textContent = '';
  try {
    pendingImageData = await compressImageFile(file);
    pendingImageChanged = true;
    pendingImageRemoved = false;
    renderRecordImagePreview();
  } catch (error) {
    console.error(error);
    $('#formError').textContent = error.message || '图片处理失败，请换一张图片。';
  } finally {
    elements.imageInput.value = '';
    elements.chooseImageButton.disabled = false;
    elements.chooseImageButton.textContent = originalText;
  }
});

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

elements.recordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = validateRecordForm();
  if (error) {
    $('#formError').textContent = error;
    return;
  }
  const existing = editingId ? records.find((record) => record.id === editingId) : null;
  const now = new Date().toISOString();
  let imageId = existing?.imageId || '';
  try {
    if (pendingImageChanged) {
      if (pendingImageRemoved || !pendingImageData) {
        if (imageId) await deleteCachedImage(imageId);
        imageId = '';
      } else {
        if (!imageId) imageId = `img-${makeId()}`;
        await putCachedImage(imageId, pendingImageData);
      }
    }
  } catch (storageError) {
    console.error(storageError);
    $('#formError').textContent = '图片保存失败，请检查浏览器存储空间。';
    return;
  }
  const record = normalizeRecord({
    id: existing?.id || makeId(),
    name: $('#name').value,
    version: existing?.version || '',
    platform: $('#platform').value,
    orderNo: existing?.orderNo || '',
    imageId,
    preorderDate: existing?.preorderDate || '',
    releaseDate: existing?.releaseDate || '',
    releaseMonth: $('#releaseMonth').value,
    paymentDeadline: existing?.paymentDeadline || '',
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

elements.deleteRecordButton.addEventListener('click', async () => {
  if (!editingId) return;
  const record = records.find((item) => item.id === editingId);
  if (!record) return;
  if (!window.confirm(`确定删除“${record.name}”吗？此操作不可撤销。`)) return;
  if (record.imageId) {
    try { await deleteCachedImage(record.imageId); }
    catch (error) { console.warn('删除图片失败', error); }
  }
  records = records.filter((item) => item.id !== editingId);
  saveRecords();
  closeDialog(elements.recordDialog);
  render();
  showToast('记录已删除');
});


function renderWishlistImagePreview() {
  let src = '';
  if (!pendingWishlistImageRemoved) {
    if (pendingWishlistImageData) src = pendingWishlistImageData;
    else if (editingWishlistId) {
      const item = wishlist.find((entry) => entry.id === editingWishlistId);
      src = item?.imageId ? imageCache.get(item.imageId) || '' : '';
    }
  }
  const hasImage = Boolean(src);
  elements.wishlistImagePreview.classList.toggle('has-image', hasImage);
  elements.wishlistImagePreviewImg.hidden = !hasImage;
  if (hasImage) elements.wishlistImagePreviewImg.src = src;
  else elements.wishlistImagePreviewImg.removeAttribute('src');
  elements.wishlistRemoveImageButton.hidden = !hasImage;
}

function openWishlistDialog(item = null) {
  editingWishlistId = item?.id || null;
  pendingWishlistImageData = null;
  pendingWishlistImageChanged = false;
  pendingWishlistImageRemoved = false;
  elements.wishlistImageInput.value = '';
  elements.wishlistForm.reset();
  elements.wishlistId.value = item?.id || '';
  elements.wishlistDialogTitle.textContent = item ? '编辑愿望' : '添加愿望';
  elements.deleteWishlistButton.hidden = !item;
  $('#wishlistName').value = item?.name || '';
  $('#wishlistReleasePrice').value = item?.releasePrice ? String(item.releasePrice) : '';
  $('#wishlistPriority').value = item?.priority || '普通';
  $('#wishlistNote').value = item?.note || '';
  elements.wishlistFormError.textContent = '';
  renderWishlistImagePreview();
  showDialog(elements.wishlistDialog);
  window.setTimeout(() => $('#wishlistName').focus(), 80);
}

elements.wishlistChooseImageButton.addEventListener('click', () => elements.wishlistImageInput.click());
elements.wishlistRemoveImageButton.addEventListener('click', () => {
  pendingWishlistImageData = null;
  pendingWishlistImageChanged = true;
  pendingWishlistImageRemoved = true;
  renderWishlistImagePreview();
});
elements.wishlistImageInput.addEventListener('change', async () => {
  const file = elements.wishlistImageInput.files?.[0];
  if (!file) return;
  const originalText = elements.wishlistChooseImageButton.textContent;
  elements.wishlistChooseImageButton.disabled = true;
  elements.wishlistChooseImageButton.textContent = '处理中…';
  elements.wishlistFormError.textContent = '';
  try {
    pendingWishlistImageData = await compressImageFile(file);
    pendingWishlistImageChanged = true;
    pendingWishlistImageRemoved = false;
    renderWishlistImagePreview();
  } catch (error) {
    console.error(error);
    elements.wishlistFormError.textContent = error.message || '图片处理失败，请换一张图片。';
  } finally {
    elements.wishlistImageInput.value = '';
    elements.wishlistChooseImageButton.disabled = false;
    elements.wishlistChooseImageButton.textContent = originalText;
  }
});

elements.wishlistForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = $('#wishlistName').value.trim();
  if (!name) {
    elements.wishlistFormError.textContent = '请填写商品名称。';
    return;
  }
  const existing = editingWishlistId ? wishlist.find((item) => item.id === editingWishlistId) : null;
  const now = new Date().toISOString();
  let imageId = existing?.imageId || '';
  try {
    if (pendingWishlistImageChanged) {
      if (pendingWishlistImageRemoved || !pendingWishlistImageData) {
        if (imageId) await deleteCachedImage(imageId);
        imageId = '';
      } else {
        if (!imageId) imageId = `img-${makeId()}`;
        await putCachedImage(imageId, pendingWishlistImageData);
      }
    }
  } catch (storageError) {
    console.error(storageError);
    elements.wishlistFormError.textContent = '图片保存失败，请检查浏览器存储空间。';
    return;
  }
  const item = normalizeWishlist({
    id: existing?.id || makeId(),
    name,
    imageId,
    priority: $('#wishlistPriority').value,
    releasePrice: numberValue($('#wishlistReleasePrice').value),
    priceHistory: existing?.priceHistory || [],
    note: $('#wishlistNote').value,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    platform: existing?.platform || '',
    releaseMonth: existing?.releaseMonth || '',
    targetPrice: existing?.targetPrice || 0,
    status: existing?.status || '',
  });
  wishlist = existing ? wishlist.map((entry) => entry.id === existing.id ? item : entry) : [item, ...wishlist];
  if (!saveWishlist()) return;
  closeDialog(elements.wishlistDialog);
  render();
  showToast(existing ? '愿望已更新' : '愿望已添加');
});

elements.deleteWishlistButton.addEventListener('click', async () => {
  if (!editingWishlistId) return;
  const item = wishlist.find((entry) => entry.id === editingWishlistId);
  if (!item) return;
  if (!window.confirm(`确定删除“${item.name}”吗？此操作不可撤销。`)) return;
  if (item.imageId) {
    try { await deleteCachedImage(item.imageId); }
    catch (error) { console.warn('删除愿望图片失败', error); }
  }
  wishlist = wishlist.filter((entry) => entry.id !== editingWishlistId);
  saveWishlist();
  closeDialog(elements.wishlistDialog);
  render();
  showToast('愿望已删除');
});

function openPriceDialog(itemId) {
  const item = wishlist.find((entry) => entry.id === itemId);
  if (!item) return;
  priceWishlistId = itemId;
  elements.priceDialogName.textContent = item.name;
  elements.priceAmount.value = '';
  elements.priceDate.value = todayISO();
  elements.priceNote.value = '';
  renderPriceDialog();
  showDialog(elements.priceDialog);
  window.setTimeout(() => elements.priceAmount.focus(), 80);
}

function renderPriceDialog() {
  const item = wishlist.find((entry) => entry.id === priceWishlistId);
  if (!item) return;
  const stats = getPriceStats(item);
  elements.priceLatest.textContent = stats.latestPrice ? formatMoney(stats.latestPrice) : '—';
  elements.priceLow.textContent = stats.lowPrice ? formatMoney(stats.lowPrice) : '—';
  elements.priceRelease.textContent = stats.releasePrice ? formatMoney(stats.releasePrice) : '—';
  elements.priceHistoryCount.textContent = `${stats.history.length} 条记录`;
  elements.priceHistoryList.innerHTML = stats.history.length
    ? stats.history.map((entry) => `
        <div class="price-history-item">
          <div class="price-history-main">
            <strong>${formatMoney(entry.price)}</strong>
            <span>${escapeHTML(entry.date || '日期未填')}${entry.note ? ` · ${escapeHTML(entry.note)}` : ''}</span>
          </div>
          <button class="price-history-delete" type="button" data-price-delete="${escapeHTML(entry.id)}" aria-label="删除这条价格记录">×</button>
        </div>`).join('')
    : '<div class="price-history-empty">还没有价格记录，添加第一次看到的价格吧。</div>';
}

elements.priceForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const item = wishlist.find((entry) => entry.id === priceWishlistId);
  if (!item) return;
  const price = numberValue(elements.priceAmount.value);
  if (price <= 0) {
    showToast('请输入大于 0 的价格');
    return;
  }
  const entry = {
    id: `price-${makeId()}`,
    price,
    date: elements.priceDate.value || todayISO(),
    note: elements.priceNote.value.trim().slice(0, 100),
    createdAt: new Date().toISOString(),
  };
  const updated = { ...item, priceHistory: [...(item.priceHistory || []), entry], updatedAt: new Date().toISOString() };
  wishlist = wishlist.map((wishItem) => wishItem.id === item.id ? updated : wishItem);
  if (!saveWishlist()) return;
  elements.priceAmount.value = '';
  elements.priceNote.value = '';
  render();
  renderPriceDialog();
  showToast(`已记录价格 ${formatMoney(price)}`);
});

elements.priceHistoryList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-price-delete]');
  if (!button) return;
  const item = wishlist.find((entry) => entry.id === priceWishlistId);
  if (!item) return;
  if (!window.confirm('确定删除这条价格记录吗？')) return;
  const updated = { ...item, priceHistory: (item.priceHistory || []).filter((entry) => entry.id !== button.dataset.priceDelete), updatedAt: new Date().toISOString() };
  wishlist = wishlist.map((wishItem) => wishItem.id === item.id ? updated : wishItem);
  saveWishlist();
  render();
  renderPriceDialog();
  showToast('价格记录已删除');
});

function switchView(view) {
  currentView = view;
  elements.preorderView.hidden = view !== 'preorder';
  elements.wishlistView.hidden = view !== 'wishlist';
  elements.viewTabs.forEach((tab) => {
    const active = tab.dataset.view === view;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  elements.addButton.innerHTML = view === 'preorder' ? '<span aria-hidden="true">＋</span> 新增预定' : '<span aria-hidden="true">＋</span> 新增愿望';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openCreateDialog() {
  if (currentView === 'wishlist') openWishlistDialog();
  else openRecordDialog();
}

elements.viewTabs.forEach((tab) => tab.addEventListener('click', () => switchView(tab.dataset.view)));
$('#wishlistHeroAdd').addEventListener('click', () => openWishlistDialog());

$$('#wishlistFilters .filter-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    wishlistFilter = tab.dataset.wishlistFilter;
    $$('#wishlistFilters .filter-tab').forEach((item) => {
      const active = item === tab;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    });
    renderWishlist();
  });
});
elements.wishlistSearchInput.addEventListener('input', () => {
  wishlistQuery = elements.wishlistSearchInput.value;
  renderWishlist();
});
elements.wishlistSortSelect.addEventListener('change', () => {
  wishlistSort = elements.wishlistSortSelect.value;
  renderWishlist();
});

['total', 'deposit', 'paidBalance'].forEach((id) => {
  $(`#${id}`).addEventListener('input', updateFormCalc);
});

function recordFullPayment(id) {
  const record = records.find((item) => item.id === id);
  if (!record) return;
  const calc = calculate(record);
  if (calc.remaining <= 0) {
    showToast('这笔预定已经没有待付款');
    return;
  }
  const previous = { ...record };
  const amount = calc.remaining;
  const updated = {
    ...record,
    paidBalance: round2(calc.paidBalance + amount),
    status: ['待付定金', '待补款'].includes(record.status) ? '已补款待发货' : record.status,
    updatedAt: new Date().toISOString(),
  };
  records = records.map((item) => item.id === record.id ? updated : item);
  if (!saveRecords()) return;
  render();
  showToast(`已一键补款 ${formatMoney(amount)}`, '撤销', () => {
    records = records.map((item) => item.id === previous.id ? previous : item);
    saveRecords();
    render();
    showToast('已撤销补款');
  }, 4200);
}

function openSettings() {
  elements.settingsCount.textContent = String(records.length + wishlist.length);
  elements.installButton.hidden = !deferredInstallPrompt;
  showDialog(elements.settingsDialog);
}

$('#addButton').addEventListener('click', openCreateDialog);
$('#fab').addEventListener('click', openCreateDialog);
$('#settingsButton').addEventListener('click', openSettings);
$('#footerSettings').addEventListener('click', openSettings);

$$('[data-close-dialog]').forEach((button) => {
  button.addEventListener('click', () => closeDialog(document.getElementById(button.dataset.closeDialog)));
});

[elements.recordDialog, elements.wishlistDialog, elements.priceDialog, elements.settingsDialog].forEach((dialog) => {
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
    openCreateDialog();
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
  const usedImageIds = new Set([...records, ...wishlist].map((item) => item.imageId).filter(Boolean));
  const images = Array.from(imageCache.entries()).filter(([id]) => usedImageIds.has(id));
  const payload = {
    app: '模玩预定簿',
    version: 3,
    exportedAt: new Date().toISOString(),
    records,
    wishlist,
    images,
  };
  downloadBlob(backupFilename('json'), new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }));
  showToast('完整备份已导出');
});

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

$('#exportCsvButton').addEventListener('click', () => {
  const header = ['商品名称', '平台店铺', '发售月份', '状态', '全款', '定金', '补款应付', '已补款', '剩余待付', '备注'];
  const rows = records.map((record) => {
    const calc = calculate(record);
    return [
      record.name, record.platform, record.releaseMonth, record.status, calc.total, calc.deposit,
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
    const incomingRaw = Array.isArray(parsed) ? parsed : parsed.records || [];
    const incoming = Array.isArray(incomingRaw) ? incomingRaw.map(normalizeRecord).filter((record) => record.name) : [];
    const wishlistRaw = Array.isArray(parsed.wishlist) ? parsed.wishlist : [];
    const incomingWishlist = wishlistRaw.map(normalizeWishlist).filter((item) => item.name);
    if (!incoming.length && !incomingWishlist.length) throw new Error('没有可导入的记录');
    if (!window.confirm(`准备导入 ${incoming.length} 条预定和 ${incomingWishlist.length} 个愿望。相同 ID 的内容会被更新，是否继续？`)) return;
    const imagesRaw = Array.isArray(parsed.images) ? parsed.images : [];
    for (const entry of imagesRaw) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const [id, dataUrl] = entry;
      if (typeof id === 'string' && typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
        await putCachedImage(id, dataUrl);
      }
    }
    const recordMap = new Map(records.map((record) => [record.id, record]));
    incoming.forEach((record) => recordMap.set(record.id, record));
    records = Array.from(recordMap.values());
    const wishMap = new Map(wishlist.map((item) => [item.id, item]));
    incomingWishlist.forEach((item) => wishMap.set(item.id, item));
    wishlist = Array.from(wishMap.values());
    if (!saveRecords() || !saveWishlist()) return;
    await hydrateImageCache();
    render();
    closeDialog(elements.settingsDialog);
    showToast(`已导入 ${incoming.length} 条预定、${incomingWishlist.length} 个愿望`);
  } catch (error) {
    console.error(error);
    showToast('导入失败，请确认文件是完整备份 JSON');
  }
});

$('#clearDataButton').addEventListener('click', async () => {
  if (!records.length && !wishlist.length) {
    showToast('当前没有记录');
    return;
  }
  if (!window.confirm(`确定清空全部 ${records.length} 条预定和 ${wishlist.length} 个愿望吗？此操作不可撤销，建议先导出备份。`)) return;
  try { await clearCachedImages(); }
  catch (error) { console.warn('清空图片失败', error); }
  records = [];
  wishlist = [];
  saveRecords();
  saveWishlist();
  closeDialog(elements.settingsDialog);
  render();
  showToast('全部数据已清空');
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

window.addEventListener('storage', async (event) => {
  if (![STORAGE_KEY, WISHLIST_KEY].includes(event.key)) return;
  records = loadRecords();
  wishlist = loadWishlist();
  await hydrateImageCache();
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

function updateBackToTop() {
  elements.backToTop.hidden = window.scrollY < 480;
}

window.addEventListener('scroll', updateBackToTop, { passive: true });
elements.backToTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

async function initApp() {
  await hydrateImageCache();
  render();
  updateBackToTop();
}

initApp();

