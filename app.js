/**
 * VAULT — Apple-Designed Personal Finance Engine
 * IndexedDB Durable Storage, PWA Service Worker & Daily Reminders
 */

// ============================================================================
// CONSTANTS & APPLE CATEGORIES
// ============================================================================
const DB_NAME = 'VaultDB';
const DB_VERSION = 1;
const LBP_RATE = 89000; // Standard Lebanese market rate: 1 USD = 89,000 LBP (89k)

const CATEGORIES = [
  { id: 'Food & Dining', name: 'Food & Dining', icon: 'utensils', color: '#ff453a' },
  { id: 'Groceries', name: 'Groceries', icon: 'shopping-cart', color: '#ff9f0a' },
  { id: 'Transport & Fuel', name: 'Transport & Fuel', icon: 'fuel', color: '#64d2ff' },
  { id: 'Shopping', name: 'Shopping & Gear', icon: 'shopping-bag', color: '#bf5af2' },
  { id: 'Bills & Utilities', name: 'Bills & Utilities', icon: 'zap', color: '#0a84ff' },
  { id: 'Entertainment', name: 'Entertainment', icon: 'film', color: '#ff375f' },
  { id: 'Health & Gym', name: 'Health & Gym', icon: 'dumbbell', color: '#30d158' },
  { id: 'Work & Tools', name: 'Work & Tools', icon: 'laptop', color: '#ffd60a' },
  { id: 'Travel & Trips', name: 'Travel & Trips', icon: 'plane', color: '#5e5ce6' },
  { id: 'Other', name: 'Other / Misc', icon: 'layers', color: '#8e8e93' }
];

const CURRENCIES = {
  USD: { symbol: '$', code: 'USD' },
  LBP: { symbol: 'L.L ', code: 'LBP' },
  EUR: { symbol: '€', code: 'EUR' },
  GBP: { symbol: '£', code: 'GBP' },
  AED: { symbol: 'AED ', code: 'AED' }
};

// ============================================================================
// APP STATE (Clean Slate — All Zeros)
// ============================================================================
let state = {
  currency: 'USD',
  baseBalance: 0.00,
  dailyBudget: 50.00,
  activeTab: 'dashboard',
  chartRange: 'month',
  reminderEnabled: false,
  reminderTime: '13:00', // 1st Notification: Midday check-in (1:00 PM)
  reminderTime2: '20:30', // 2nd Notification: Evening review (8:30 PM)
  transactions: [],
  adjustments: []
};

function sortTransactions() {
  state.transactions.sort((a, b) => {
    const dateDiff = new Date((b.date || '1970-01-01') + 'T00:00:00') - new Date((a.date || '1970-01-01') + 'T00:00:00');
    if (dateDiff !== 0) return dateDiff;
    return (b.timestamp || 0) - (a.timestamp || 0);
  });
}

let db = null;
let dailyChart = null;
let categoryChart = null;
let dayOfWeekChart = null;
let paymentChart = null;

// ============================================================================
// INDEXEDDB ENGINE — DURABLE STORAGE FOR REAL ANALYTICS
// ============================================================================
function initIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const dbInstance = e.target.result;
      
      // Store 1: Transactions (Indexed for rich analytics queries)
      if (!dbInstance.objectStoreNames.contains('transactions')) {
        const txStore = dbInstance.createObjectStore('transactions', { keyPath: 'id' });
        txStore.createIndex('date', 'date', { unique: false });
        txStore.createIndex('category', 'category', { unique: false });
        txStore.createIndex('type', 'type', { unique: false });
        txStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // Store 2: Balances & Calibrations
      if (!dbInstance.objectStoreNames.contains('balances')) {
        dbInstance.createObjectStore('balances', { keyPath: 'id' });
      }

      // Store 3: Settings
      if (!dbInstance.objectStoreNames.contains('settings')) {
        dbInstance.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    request.onsuccess = async (e) => {
      db = e.target.result;
      // Request persistent storage from browser so OS never evicts it under pressure
      if (navigator.storage && navigator.storage.persist) {
        try {
          const isPersisted = await navigator.storage.persist();
          const statusEl = document.getElementById('storageStatusText');
          if (statusEl) {
            statusEl.textContent = isPersisted ? 'Status: Durable & Persistent' : 'Status: IndexedDB Active';
          }
        } catch (err) {}
      }
      resolve(db);
    };

    request.onerror = (e) => {
      console.error('IndexedDB open error:', e);
      reject(e);
    };
  });
}

async function loadDataFromIndexedDB() {
  if (!db) return;

  // Load Settings
  const settings = await idbGet('settings', 'preferences');
  if (settings) {
    state.currency = settings.currency || 'USD';
    state.baseBalance = Number(settings.baseBalance) || 0;
    state.dailyBudget = Number(settings.dailyBudget) || 50;
    state.reminderEnabled = !!settings.reminderEnabled;
    state.reminderTime = settings.reminderTime || '13:00';
    state.reminderTime2 = settings.reminderTime2 || '20:30';
    // Backwards compatibility migration
    if (!settings.reminderTime2 && state.reminderTime === '20:30') {
      state.reminderTime = '13:00';
      state.reminderTime2 = '20:30';
    }
  }

  // Load Transactions
  state.transactions = await idbGetAll('transactions') || [];
  // Sort chronologically by date descending, then timestamp
  sortTransactions();

  // Load Balances / Adjustments
  state.adjustments = await idbGetAll('balances') || [];
  state.adjustments.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

function idbPut(storeName, data) {
  return new Promise((resolve, reject) => {
    if (!db) return resolve();
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(data);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(storeName, key) {
  return new Promise((resolve, reject) => {
    if (!db) return resolve();
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbGet(storeName, key) {
  return new Promise((resolve, reject) => {
    if (!db) return resolve(null);
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    if (!db) return resolve([]);
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function saveSettings() {
  await idbPut('settings', {
    key: 'preferences',
    currency: state.currency,
    baseBalance: state.baseBalance,
    dailyBudget: state.dailyBudget,
    reminderEnabled: state.reminderEnabled,
    reminderTime: state.reminderTime,
    reminderTime2: state.reminderTime2
  });
}

// ============================================================================
// FINANCIAL ENGINE
// ============================================================================
function formatMoney(amount, currency = state.currency) {
  const curr = CURRENCIES[currency] || CURRENCIES.USD;
  const num = Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `${amount < 0 ? '-' : ''}${curr.symbol}${num}`;
}

function getTodayISO() {
  return new Date().toISOString().split('T')[0];
}

function getCurrentMonthISO() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function calculateRealTimeBalance() {
  let net = Number(state.baseBalance) || 0;
  state.transactions.forEach(tx => {
    const amt = Number(tx.amount) || 0;
    if (tx.type === 'expense') net -= amt;
    else if (tx.type === 'income') net += amt;
  });
  return net;
}

function getSpentToday() {
  const today = getTodayISO();
  return state.transactions
    .filter(tx => tx.type === 'expense' && tx.date === today)
    .reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
}

function getSpentThisMonth() {
  const month = getCurrentMonthISO();
  return state.transactions
    .filter(tx => tx.type === 'expense' && tx.date.startsWith(month))
    .reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
}

function getIncomeThisMonth() {
  const month = getCurrentMonthISO();
  return state.transactions
    .filter(tx => tx.type === 'income' && tx.date.startsWith(month))
    .reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
}

// ============================================================================
// PWA & SERVICE WORKER & REMINDERS
// ============================================================================
function registerPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        console.log('Vault Service Worker registered');
      })
      .catch(err => {
        console.warn('Service Worker registration skipped:', err);
      });
  }
}

function checkNotificationStatus() {
  const bellIcon = document.getElementById('bellIcon');
  const banner = document.getElementById('reminderBanner');
  const toggle = document.getElementById('toggleReminder');
  const timeInput = document.getElementById('reminderTimeInput');
  const time2Input = document.getElementById('reminderTime2Input');

  if (timeInput) timeInput.value = state.reminderTime || '13:00';
  if (time2Input) time2Input.value = state.reminderTime2 || '20:30';
  if (toggle) toggle.checked = state.reminderEnabled;

  if ('Notification' in window) {
    if (Notification.permission === 'granted' && state.reminderEnabled) {
      if (bellIcon) bellIcon.parentElement.classList.add('active-bell');
      if (banner) banner.style.display = 'none';
    } else if (Notification.permission === 'default' && !state.reminderEnabled) {
      if (banner) banner.style.display = 'block';
      if (bellIcon) bellIcon.parentElement.classList.remove('active-bell');
    } else {
      if (banner) banner.style.display = 'none';
    }
  }

  scheduleLocalDailyReminder();
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    alert('This browser does not support notifications.');
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    state.reminderEnabled = true;
    await saveSettings();
    checkNotificationStatus();
    sendNotification(
      'Vault Daily Reminders Active',
      `You will receive 2 daily nudges (at ${state.reminderTime} and ${state.reminderTime2}) to record your spending.`,
      'vault-setup-success'
    );
  }
}

function sendNotification(title = 'Vault Spending Check', body = 'Remember to log what you spent today!', tag = 'vault-daily-reminder') {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const options = {
    body: body,
    icon: './icon-192.svg',
    badge: './icon-192.svg',
    tag: tag,
    renotify: true
  };

  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready.then(reg => {
      reg.showNotification(title, options);
    });
  } else {
    try {
      new Notification(title, options);
    } catch (e) {
      console.warn('Direct notification fallback error:', e);
    }
  }
  haptic();
}

function sendTestNotification(slot = 1) {
  const spentToday = getSpentToday();
  if (slot === 1) {
    const msg = spentToday > 0 
      ? `Midday Check: You've logged ${formatMoney(spentToday)} today. Any other morning or lunch purchases to record?`
      : `Midday Check: Remember to log your morning & lunch purchases in Vault!`;
    sendNotification('Vault Midday Reminder (Alert 1 of 2)', msg, 'vault-test-1');
  } else {
    const msg = spentToday > 0 
      ? `Evening Review: Total logged today: ${formatMoney(spentToday)}. Tap to add any dinner or late purchases.`
      : `Evening Review: Did you have any purchases today? Take 10 seconds to log them before bed.`;
    sendNotification('Vault Evening Review (Alert 2 of 2)', msg, 'vault-test-2');
  }
}

function scheduleLocalDailyReminder() {
  if (!state.reminderEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;

  if (window._reminderInterval) clearInterval(window._reminderInterval);

  // Check every 30 seconds for scheduled times
  window._reminderInterval = setInterval(() => {
    checkAndTriggerScheduledReminders();
  }, 30000);

  checkAndTriggerScheduledReminders();
}

function checkAndTriggerScheduledReminders() {
  if (!state.reminderEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;

  const now = new Date();
  const currentHM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const today = getTodayISO();

  const time1 = state.reminderTime || '13:00';
  const time2 = state.reminderTime2 || '20:30';

  const isMatchingTime = (targetHM) => {
    if (!targetHM) return false;
    if (currentHM === targetHM) return true;
    const [currH, currM] = currentHM.split(':').map(Number);
    const [targetH, targetM] = targetHM.split(':').map(Number);
    const diff = (currH * 60 + currM) - (targetH * 60 + targetM);
    return diff >= 0 && diff <= 1; // within current or immediately next minute
  };

  const spentToday = getSpentToday();

  // 1st Notification: Midday / Afternoon check
  if (isMatchingTime(time1) && localStorage.getItem('last_reminder_1_date') !== today) {
    const message = spentToday > 0 
      ? `Midday Check: You've logged ${formatMoney(spentToday)} today. Any other morning or lunch purchases to record?`
      : `Midday Check: Remember to log your morning & lunch purchases in Vault!`;

    sendNotification('Vault Midday Reminder', message, 'vault-daily-reminder-1');
    localStorage.setItem('last_reminder_1_date', today);
  }

  // 2nd Notification: Evening review
  if (isMatchingTime(time2) && localStorage.getItem('last_reminder_2_date') !== today) {
    const message = spentToday > 0 
      ? `Evening Review: Total logged today: ${formatMoney(spentToday)}. Tap to add any dinner or late purchases.`
      : `Evening Review: Did you spend anything today? Take 10 seconds to log your expenses.`;

    sendNotification('Vault Evening Review', message, 'vault-daily-reminder-2');
    localStorage.setItem('last_reminder_2_date', today);
  }
}

function haptic() {
  if (navigator.vibrate) {
    navigator.vibrate([12]);
  }
}

// ============================================================================
// RENDERERS
// ============================================================================
function renderAll() {
  renderWalletMetrics();
  renderDailyChart();
  renderCategoryDonut();
  renderTodayList();
  renderDailyGroupedList();
  renderFundsView();
  renderAnalyticsView();
  updateCategoryChips();

  if (window.lucide) {
    lucide.createIcons();
  }
}

function renderWalletMetrics() {
  const totalFunds = calculateRealTimeBalance();
  const spentToday = getSpentToday();
  const spentMonth = getSpentThisMonth();
  const incomeMonth = getIncomeThisMonth();

  // Hero Card
  const heroFunds = document.getElementById('heroTotalFunds');
  if (heroFunds) heroFunds.textContent = formatMoney(totalFunds);

  const heroFundsLBP = document.getElementById('heroTotalFundsLBP');
  if (heroFundsLBP) {
    const lbpK = Math.round((totalFunds * LBP_RATE) / 1000);
    heroFundsLBP.textContent = `≈ ${lbpK.toLocaleString()}k L.L (89,000/$)`;
  }

  const heroToday = document.getElementById('heroSpentToday');
  if (heroToday) heroToday.textContent = formatMoney(spentToday);

  const heroMonth = document.getElementById('heroSpentMonth');
  if (heroMonth) heroMonth.textContent = formatMoney(spentMonth);

  const heroIncome = document.getElementById('heroIncomeMonth');
  if (heroIncome) heroIncome.textContent = formatMoney(incomeMonth);

  // Daily target progress
  const target = state.dailyBudget || 50;
  const budgetText = document.getElementById('dailyBudgetText');
  if (budgetText) budgetText.textContent = `Target: ${formatMoney(target)}/day`;

  const pct = Math.min(Math.round((spentToday / target) * 100), 100);
  const pctEl = document.getElementById('dailyBudgetPercentage');
  if (pctEl) pctEl.textContent = `${pct}%`;

  const fillEl = document.getElementById('dailyBudgetFill');
  if (fillEl) {
    fillEl.style.width = `${pct}%`;
    fillEl.style.background = spentToday > target ? 'var(--ios-red)' : 'var(--ios-blue)';
  }

  const remainEl = document.getElementById('dailyRemainingText');
  if (remainEl) {
    if (spentToday === 0) {
      remainEl.textContent = `${formatMoney(target)} remaining today`;
    } else if (spentToday <= target) {
      remainEl.textContent = `${formatMoney(target - spentToday)} remaining today`;
    } else {
      remainEl.textContent = `${formatMoney(spentToday - target)} over target`;
    }
  }

  // Update Currency Symbols
  const curr = CURRENCIES[state.currency]?.symbol || '$';
  document.querySelectorAll('#fundsCurrencyPrefix, #currInputPrefix, #currInflowPrefix, #currTargetPrefix, #sheetCurrSymbol').forEach(el => {
    el.textContent = curr;
  });

  const currSelect = document.getElementById('currencySelect');
  if (currSelect) currSelect.value = state.currency;
}

// Chart 1: Daily Spending Trend
function renderDailyChart() {
  const canvas = document.getElementById('dailySpendingChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let labels = [];
  let dataPoints = [];
  const now = new Date();

  if (state.chartRange === 'week') {
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().split('T')[0];
      const sum = state.transactions
        .filter(tx => tx.type === 'expense' && tx.date === iso)
        .reduce((s, tx) => s + (Number(tx.amount) || 0), 0);
      labels.push(d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }));
      dataPoints.push(sum);
    }
  } else {
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(now.getFullYear(), now.getMonth(), day);
      const iso = d.toISOString().split('T')[0];
      const sum = state.transactions
        .filter(tx => tx.type === 'expense' && tx.date === iso)
        .reduce((s, tx) => s + (Number(tx.amount) || 0), 0);
      labels.push(day);
      dataPoints.push(sum);
    }
  }

  if (dailyChart) dailyChart.destroy();

  dailyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        data: dataPoints,
        backgroundColor: '#0a84ff',
        borderRadius: 4,
        barThickness: state.chartRange === 'week' ? 12 : 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1c1c1e',
          titleColor: '#8e8e93',
          bodyColor: '#ffffff',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 0.5,
          callbacks: {
            label: (c) => `Spent: ${formatMoney(c.raw)}`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#636366', font: { size: 10 } } },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: {
            color: '#636366',
            font: { size: 10 },
            callback: (v) => CURRENCIES[state.currency]?.symbol + v
          }
        }
      }
    }
  });
}

// Chart 2: Category Donut & List
function renderCategoryDonut() {
  const canvas = document.getElementById('categoryDonutChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const catMap = {};
  CATEGORIES.forEach(c => catMap[c.name] = { total: 0, color: c.color, icon: c.icon });

  state.transactions
    .filter(tx => tx.type === 'expense')
    .forEach(tx => {
      const cat = tx.category || 'Other';
      if (!catMap[cat]) catMap[cat] = { total: 0, color: '#8e8e93', icon: '📦' };
      catMap[cat].total += Number(tx.amount) || 0;
    });

  const active = Object.entries(catMap).filter(([_, v]) => v.total > 0).sort((a, b) => b[1].total - a[1].total);
  const total = active.reduce((s, item) => s + item[1].total, 0);

  if (categoryChart) categoryChart.destroy();

  categoryChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: active.length ? active.map(i => i[0]) : ['No Data'],
      datasets: [{
        data: active.length ? active.map(i => i[1].total) : [1],
        backgroundColor: active.length ? active.map(i => i[1].color) : ['#2c2c2e'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '75%',
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: active.length > 0,
          backgroundColor: '#1c1c1e',
          callbacks: {
            label: (c) => `${c.label}: ${formatMoney(c.raw)}`
          }
        }
      }
    }
  });

  const listEl = document.getElementById('categoryBarsList');
  if (!listEl) return;

  if (active.length === 0) {
    listEl.innerHTML = `<div style="text-align: center; color: #8e8e93; font-size: 0.8rem; padding: 0.75rem;">No spending recorded yet.</div>`;
    return;
  }

  listEl.innerHTML = active.slice(0, 4).map(([name, item]) => {
    const pct = total > 0 ? Math.round((item.total / total) * 100) : 0;
    return `
      <div class="cat-row">
        <div class="cat-row-left">
          <span class="cat-color-dot" style="background: ${item.color};"></span>
          <span>${name}</span>
        </div>
        <div style="display: flex; gap: 0.5rem; font-weight: 600;">
          <span>${formatMoney(item.total)}</span>
          <span style="color: #8e8e93;">${pct}%</span>
        </div>
      </div>
    `;
  }).join('');
}

// Today's Activity Stream on Dashboard
function renderTodayList() {
  const container = document.getElementById('todayActivityList');
  if (!container) return;

  const today = getTodayISO();
  const todayTxs = state.transactions.filter(tx => tx.date === today);

  if (todayTxs.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: #8e8e93; font-size: 0.82rem; padding: 1.5rem 1rem;">
        No purchases logged today yet.
      </div>
    `;
    return;
  }

  container.innerHTML = todayTxs.slice(0, 5).map(tx => renderTxRowHTML(tx)).join('');
}

// Daily Grouped View
function renderDailyGroupedList() {
  const container = document.getElementById('dailyGroupedContainer');
  const emptyState = document.getElementById('dailyEmptyState');
  if (!container) return;

  const query = (document.getElementById('dailySearchInput')?.value || '').toLowerCase().trim();
  const typeFilter = document.querySelector('.seg-btn.active[data-type-filter]')?.dataset.typeFilter || 'all';

  const filtered = state.transactions.filter(tx => {
    if (typeFilter !== 'all' && tx.type !== typeFilter) return false;
    if (query) {
      const matchNote = (tx.note || '').toLowerCase().includes(query);
      const matchCat = (tx.category || '').toLowerCase().includes(query);
      const matchAmt = String(tx.amount).includes(query);
      if (!matchNote && !matchCat && !matchAmt) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  // Group by Date
  const groups = {};
  filtered.forEach(tx => {
    const d = tx.date || 'Unknown';
    if (!groups[d]) groups[d] = [];
    groups[d].push(tx);
  });

  const sortedDates = Object.keys(groups).sort((a, b) => new Date(b) - new Date(a));
  const today = getTodayISO();
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  container.innerHTML = sortedDates.map(dateStr => {
    const dayTxs = groups[dateStr];
    const dayTotal = dayTxs
      .filter(tx => tx.type === 'expense')
      .reduce((s, tx) => s + (Number(tx.amount) || 0), 0);

    let friendly = dateStr;
    if (dateStr === today) friendly = 'Today';
    else if (dateStr === yesterday) friendly = 'Yesterday';
    else {
      friendly = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric'
      });
    }

    return `
      <div class="ios-grouped-section">
        <div class="grouped-header-row">
          <span class="grouped-title">${friendly}</span>
          <span class="ios-caption" style="color: #ffffff; font-weight: 700;">${formatMoney(dayTotal)}</span>
        </div>
        <div class="ios-grouped-list">
          ${dayTxs.map(tx => renderTxRowHTML(tx)).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function renderTxRowHTML(tx) {
  const isExp = tx.type === 'expense';
  const catObj = CATEGORIES.find(c => c.name === tx.category || c.id === tx.category) || { icon: 'layers', color: '#8e8e93' };

  let mainDisplay = '';
  let subDisplay = '';
  if (tx.inputCurrency === 'LBP_K') {
    mainDisplay = `${tx.inputAmount}k L.L`;
    subDisplay = `≈ $${(Number(tx.amount) || 0).toFixed(2)}`;
  } else {
    mainDisplay = formatMoney(tx.amount);
    const lbpK = Math.round(((Number(tx.amount) || 0) * LBP_RATE) / 1000);
    subDisplay = `≈ ${lbpK.toLocaleString()}k L.L`;
  }

  return `
    <div class="ios-list-row" data-id="${tx.id}">
      <div class="row-left" data-action="edit" data-id="${tx.id}" title="Tap to edit date, category, or amount">
        <div class="row-icon-circle" style="color: ${catObj.color};">
          <i data-lucide="${catObj.icon}"></i>
        </div>
        <div class="row-text">
          <span class="row-title">${escapeHTML(tx.note || tx.category)}</span>
          <span class="row-meta"><strong class="row-cat-badge">${escapeHTML(tx.category)}</strong> • ${escapeHTML(tx.paymentMethod || 'Cash')} • <span style="color: var(--ios-text-tertiary);">${subDisplay}</span></span>
        </div>
      </div>
      <div class="row-right">
        <span class="row-amount ${isExp ? 'expense' : 'income'}">
          ${isExp ? '-' : '+'}${mainDisplay}
        </span>
        <button class="row-edit-btn" data-action="edit" data-id="${tx.id}" title="Edit Log">
          <i data-lucide="pencil"></i>
        </button>
        <button class="row-delete-btn" data-action="delete" data-id="${tx.id}" title="Delete">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    </div>
  `;
}

// Funds View
function renderFundsView() {
  const total = calculateRealTimeBalance();
  const totalEl = document.getElementById('fundsExactTotal');
  if (totalEl) totalEl.textContent = total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const totalLBP = document.getElementById('fundsExactTotalLBP');
  if (totalLBP) {
    const lbpK = Math.round((total * LBP_RATE) / 1000);
    totalLBP.textContent = `≈ ${lbpK.toLocaleString()}k L.L (89,000/$)`;
  }

  const statusEl = document.getElementById('fundsLastUpdated');
  if (statusEl) {
    statusEl.textContent = `Base Funds: ${formatMoney(state.baseBalance)}`;
  }

  const list = document.getElementById('fundsAdjustmentList');
  if (!list) return;

  if (state.adjustments.length === 0) {
    list.innerHTML = `<div style="text-align: center; color: #8e8e93; font-size: 0.82rem; padding: 1.25rem;">No manual adjustments or inflows yet.</div>`;
    return;
  }

  list.innerHTML = state.adjustments.slice(0, 10).map(item => `
    <div class="ios-list-row">
      <div class="row-left">
        <div class="row-icon-circle" style="color: var(--ios-green);">
          <i data-lucide="arrow-down-left"></i>
        </div>
        <div class="row-text">
          <span class="row-title">${escapeHTML(item.source || 'Funds Update')}</span>
          <span class="row-meta">${item.date} • ${item.account || 'Vault'}</span>
        </div>
      </div>
      <div class="row-right">
        <span class="row-amount income">+${formatMoney(item.amount)}</span>
      </div>
    </div>
  `).join('');
}

// Analytics View
function renderAnalyticsView() {
  renderDayOfWeekChart();
  renderPaymentMethodChart();

  const list = document.getElementById('analyticsCategoryList');
  if (!list) return;

  const catMap = {};
  CATEGORIES.forEach(c => catMap[c.name] = { total: 0, count: 0, icon: c.icon });

  state.transactions
    .filter(tx => tx.type === 'expense')
    .forEach(tx => {
      const c = tx.category || 'Other';
      if (!catMap[c]) catMap[c] = { total: 0, count: 0, icon: '📦' };
      catMap[c].total += Number(tx.amount) || 0;
      catMap[c].count += 1;
    });

  const sorted = Object.entries(catMap).filter(item => item[1].total > 0).sort((a, b) => b[1].total - a[1].total);

  if (sorted.length === 0) {
    list.innerHTML = `<div style="text-align: center; color: #8e8e93; font-size: 0.82rem; padding: 1.25rem;">No historical data available yet.</div>`;
    return;
  }

  list.innerHTML = sorted.map(([name, item]) => `
    <div class="ios-list-row">
      <div class="row-left">
        <div class="row-icon-circle">${item.icon}</div>
        <div class="row-text">
          <span class="row-title">${name}</span>
          <span class="row-meta">${item.count} transaction${item.count === 1 ? '' : 's'}</span>
        </div>
      </div>
      <div class="row-right">
        <span class="row-amount">${formatMoney(item.total)}</span>
      </div>
    </div>
  `).join('');
}

function renderDayOfWeekChart() {
  const canvas = document.getElementById('dayOfWeekChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const totals = [0, 0, 0, 0, 0, 0, 0];

  state.transactions.forEach(tx => {
    if (tx.type === 'expense' && tx.date) {
      const dayIdx = new Date(tx.date + 'T00:00:00').getDay();
      totals[dayIdx] += Number(tx.amount) || 0;
    }
  });

  if (dayOfWeekChart) dayOfWeekChart.destroy();

  dayOfWeekChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: days,
      datasets: [{
        data: totals,
        backgroundColor: '#5e5ce6',
        borderRadius: 4,
        barThickness: 16
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1c1c1e',
          callbacks: { label: (c) => `Total: ${formatMoney(c.raw)}` }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#636366' } },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: {
            color: '#636366',
            callback: (v) => CURRENCIES[state.currency]?.symbol + v
          }
        }
      }
    }
  });
}

function renderPaymentMethodChart() {
  const canvas = document.getElementById('paymentMethodChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const methods = { 'Cash': 0, 'Card': 0, 'Bank Transfer': 0, 'Digital Wallet': 0 };
  state.transactions.forEach(tx => {
    if (tx.type === 'expense') {
      const pm = tx.paymentMethod || 'Cash';
      methods[pm] = (methods[pm] || 0) + (Number(tx.amount) || 0);
    }
  });

  const labels = Object.keys(methods).filter(k => methods[k] > 0);
  const data = labels.map(k => methods[k]);

  if (paymentChart) paymentChart.destroy();

  paymentChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels.length ? labels : ['No Data'],
      datasets: [{
        data: data.length ? data : [1],
        backgroundColor: ['#30d158', '#0a84ff', '#ffd60a', '#bf5af2'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: {
        legend: {
          position: 'right',
          labels: { color: '#8e8e93', font: { size: 11 } }
        }
      }
    }
  });
}

function updateCategoryChips() {
  const container = document.getElementById('sheetCategoryPicker');
  if (!container) return;

  const currentSelected = document.getElementById('sheetSelectedCategory')?.value || CATEGORIES[0].name;

  container.innerHTML = CATEGORIES.map((cat) => `
    <button type="button" class="category-chip ${cat.name === currentSelected ? 'selected' : ''}" data-cat="${cat.name}">
      <i data-lucide="${cat.icon}"></i>
      <span>${cat.name}</span>
    </button>
  `).join('');

  if (window.lucide) {
    lucide.createIcons();
  }

  if (!container._hasClickAttached) {
    container.addEventListener('click', (e) => {
      const chip = e.target.closest('.category-chip');
      if (!chip) return;
      container.querySelectorAll('.category-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      const input = document.getElementById('sheetSelectedCategory');
      if (input) input.value = chip.dataset.cat;
      haptic();
    });
    container._hasClickAttached = true;
  }
}

// ============================================================================
// EVENT LISTENERS & GESTURES
// ============================================================================
function setupEventListeners() {
  // Tab Bar Switching
  document.querySelectorAll('.tab-item:not(.center-add-tab)').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      switchTab(target);
      haptic();
    });
  });

  // Chart range segmented buttons
  document.querySelectorAll('.seg-btn[data-chart]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.seg-btn[data-chart]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.chartRange = btn.dataset.chart;
      renderDailyChart();
      haptic();
    });
  });

  // Currency select
  document.getElementById('currencySelect')?.addEventListener('change', async (e) => {
    state.currency = e.target.value;
    await saveSettings();
    renderAll();
    haptic();
  });

  // Open Log Modal (Bottom Sheet)
  document.getElementById('btnDesktopAdd')?.addEventListener('click', openSheet);
  document.getElementById('btnMobileAdd')?.addEventListener('click', openSheet);
  document.getElementById('btnCloseSheet')?.addEventListener('click', closeSheet);
  document.getElementById('btnDeleteFromSheet')?.addEventListener('click', async () => {
    const id = document.getElementById('sheetEditingTxId')?.value;
    if (!id) return;
    if (confirm('Delete this transaction?')) {
      await deleteTransaction(id);
      closeSheet();
    }
  });

  // Close when clicking modal backdrop
  document.querySelectorAll('.ios-modal-backdrop').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('open');
      }
    });
  });

  // Keyboard Shortcuts: N for new transaction, Esc to close
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
      if (e.key === 'Escape') closeAllModals();
      return;
    }
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      openSheet();
    } else if (e.key === 'Escape') {
      closeAllModals();
    }
  });

  // Sheet Segmented Toggle (Expense vs Income)
  document.getElementById('btnSheetExpense')?.addEventListener('click', () => setSheetTxType('expense'));
  document.getElementById('btnSheetIncome')?.addEventListener('click', () => setSheetTxType('income'));

  // Quick Tags
  document.getElementById('sheetQuickTags')?.addEventListener('click', (e) => {
    const tagBtn = e.target.closest('.apple-tag');
    if (!tagBtn) return;
    const tag = tagBtn.dataset.tag;
    const noteInput = document.getElementById('sheetNote');
    if (noteInput) noteInput.value = tag;

    if (tag.includes('Coffee') || tag.includes('Lunch') || tag.includes('Dinner')) {
      selectCategoryChip('Food & Dining');
    } else if (tag.includes('Groceries')) {
      selectCategoryChip('Groceries');
    } else if (tag.includes('Fuel') || tag.includes('Uber')) {
      selectCategoryChip('Transport & Fuel');
    } else if (tag.includes('Subscription')) {
      selectCategoryChip('Bills & Utilities');
    }
    haptic();
  });

  // Currency Toggle in Transaction Sheet
  const btnCurrUSD = document.getElementById('btnSheetCurrUSD');
  const btnCurrLBP = document.getElementById('btnSheetCurrLBP');
  const sheetAmtInput = document.getElementById('sheetAmount');
  const sheetCurrSym = document.getElementById('sheetCurrSymbol');
  const sheetCurrSuffix = document.getElementById('sheetCurrSuffix');
  const sheetCurrInput = document.getElementById('sheetCurrencyInput');

  btnCurrUSD?.addEventListener('click', () => {
    btnCurrUSD.classList.add('active');
    btnCurrLBP.classList.remove('active');
    sheetCurrInput.value = 'USD';
    sheetCurrSym.textContent = '$';
    sheetCurrSuffix.style.display = 'none';
    updateSheetConversionHint();
    haptic();
  });

  btnCurrLBP?.addEventListener('click', () => {
    btnCurrLBP.classList.add('active');
    btnCurrUSD.classList.remove('active');
    sheetCurrInput.value = 'LBP_K';
    sheetCurrSym.textContent = 'L.L ';
    sheetCurrSuffix.style.display = 'inline-block';
    updateSheetConversionHint();
    haptic();
  });

  sheetAmtInput?.addEventListener('input', updateSheetConversionHint);

  // Submit Transaction
  document.getElementById('sheetTxForm')?.addEventListener('submit', handleTxSubmit);

  // Set Exact Money Form (In Funds view)
  document.getElementById('btnSubmitExactMoney')?.addEventListener('click', handleExactMoneySubmit);
  document.getElementById('btnQuickSetBalance')?.addEventListener('click', () => {
    switchTab('funds');
    document.getElementById('inputExactMoney')?.focus();
    haptic();
  });

  // Inflow / Income Form Submit
  document.getElementById('inflowForm')?.addEventListener('submit', handleInflowSubmit);

  // Search in Daily Log
  const searchInput = document.getElementById('dailySearchInput');
  const clearBtn = document.getElementById('btnClearDailySearch');
  searchInput?.addEventListener('input', () => {
    if (clearBtn) clearBtn.style.display = searchInput.value ? 'block' : 'none';
    renderDailyGroupedList();
  });
  clearBtn?.addEventListener('click', () => {
    searchInput.value = '';
    clearBtn.style.display = 'none';
    renderDailyGroupedList();
  });

  // Daily Log Type Filter
  document.querySelectorAll('.seg-btn[data-type-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.seg-btn[data-type-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderDailyGroupedList();
      haptic();
    });
  });

  // See All button on dashboard
  document.getElementById('btnViewAllDaily')?.addEventListener('click', () => switchTab('daily'));

  // Adjust Daily Budget
  document.getElementById('btnAdjustDailyTarget')?.addEventListener('click', () => {
    document.getElementById('settingsModal')?.classList.add('open');
    document.getElementById('settingDailyTarget')?.focus();
  });

  // Reminder Modals & Permissions
  document.getElementById('btnOpenReminderSettings')?.addEventListener('click', () => {
    document.getElementById('reminderModal')?.classList.add('open');
    haptic();
  });
  document.getElementById('btnCloseReminderModal')?.addEventListener('click', () => {
    document.getElementById('reminderModal')?.classList.remove('open');
  });
  document.getElementById('btnEnableNotifications')?.addEventListener('click', requestNotificationPermission);
  document.getElementById('btnDismissBanner')?.addEventListener('click', () => {
    document.getElementById('reminderBanner').style.display = 'none';
  });

  document.getElementById('btnSendTestNotification')?.addEventListener('click', () => {
    sendTestNotification(1);
  });

  document.getElementById('btnSendTestNotification2')?.addEventListener('click', () => {
    sendTestNotification(2);
  });

  document.getElementById('btnSaveReminderSettings')?.addEventListener('click', async () => {
    const isChecked = document.getElementById('toggleReminder')?.checked;
    const timeVal1 = document.getElementById('reminderTimeInput')?.value || '13:00';
    const timeVal2 = document.getElementById('reminderTime2Input')?.value || '20:30';

    if (isChecked && 'Notification' in window && Notification.permission !== 'granted') {
      await requestNotificationPermission();
    }
    
    state.reminderEnabled = isChecked;
    state.reminderTime = timeVal1;
    state.reminderTime2 = timeVal2;
    await saveSettings();
    checkNotificationStatus();

    document.getElementById('reminderModal')?.classList.remove('open');
    haptic();
  });

  // Settings Modal
  document.getElementById('btnOpenSettingsModal')?.addEventListener('click', () => {
    document.getElementById('settingsModal')?.classList.add('open');
    haptic();
  });
  document.getElementById('btnCloseSettingsModal')?.addEventListener('click', () => {
    document.getElementById('settingsModal')?.classList.remove('open');
  });

  document.getElementById('settingDailyTarget')?.addEventListener('change', async (e) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val > 0) {
      state.dailyBudget = val;
      await saveSettings();
      renderWalletMetrics();
    }
  });

  // Transaction action delegation (Edit & Delete)
  document.addEventListener('click', async (e) => {
    const delBtn = e.target.closest('[data-action="delete"]');
    if (delBtn) {
      e.stopPropagation();
      const id = delBtn.dataset.id;
      if (id) {
        await deleteTransaction(id);
      }
      return;
    }

    const editBtn = e.target.closest('[data-action="edit"]');
    if (editBtn) {
      const id = editBtn.dataset.id;
      if (id) {
        openEditTx(id);
      }
      return;
    }

    const listRow = e.target.closest('.ios-list-row');
    if (listRow && !e.target.closest('button')) {
      const id = listRow.dataset.id;
      if (id && id.startsWith('tx_')) {
        openEditTx(id);
      }
    }
  });

  // Export JSON & CSV
  document.getElementById('btnExportJSON')?.addEventListener('click', exportFullAnalyticsJSON);
  document.getElementById('btnExportCSV')?.addEventListener('click', exportTransactionsCSV);
  document.getElementById('importFileInput')?.addEventListener('change', importDataJSON);
  document.getElementById('btnResetAll')?.addEventListener('click', wipeAllData);
}

// ============================================================================
// TRANSACTION OPERATIONS (WRITING TO INDEXEDDB)
// ============================================================================
async function handleTxSubmit(e) {
  e.preventDefault();

  const enteredVal = parseFloat(document.getElementById('sheetAmount')?.value);
  if (isNaN(enteredVal) || enteredVal <= 0) return;

  const currMode = document.getElementById('sheetCurrencyInput')?.value || 'USD';
  let amountUSD = enteredVal;
  if (currMode === 'LBP_K') {
    amountUSD = (enteredVal * 1000) / LBP_RATE;
  }

  const type = document.getElementById('sheetTxType')?.value || 'expense';
  const category = type === 'income' ? 'Income' : (document.getElementById('sheetSelectedCategory')?.value || 'Other');
  const note = document.getElementById('sheetNote')?.value || category;
  const date = document.getElementById('sheetDate')?.value || getTodayISO();
  const paymentMethod = document.getElementById('sheetPaymentMethod')?.value || 'Cash';
  const editingId = document.getElementById('sheetEditingTxId')?.value;

  if (editingId) {
    const existingIdx = state.transactions.findIndex(t => t.id === editingId);
    if (existingIdx !== -1) {
      const existing = state.transactions[existingIdx];
      const updatedRecord = {
        ...existing,
        type,
        amount: amountUSD,
        inputCurrency: currMode,
        inputAmount: enteredVal,
        category,
        note,
        date,
        paymentMethod,
        updatedAt: new Date().toISOString()
      };

      // 1. Write update to IndexedDB
      await idbPut('transactions', updatedRecord);

      // 2. Update memory state
      state.transactions[existingIdx] = updatedRecord;
      sortTransactions();

      closeSheet();
      renderAll();
      haptic();
      return;
    }
  }

  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const record = {
    id: 'tx_' + Date.now(),
    type,
    amount: amountUSD,
    inputCurrency: currMode,
    inputAmount: enteredVal,
    category,
    note,
    date,
    time,
    timestamp: Date.now(),
    paymentMethod,
    createdAt: now.toISOString()
  };

  // 1. Write to IndexedDB
  await idbPut('transactions', record);

  // 2. Update memory state
  state.transactions.unshift(record);
  sortTransactions();

  closeSheet();
  renderAll();
  haptic();
}

async function deleteTransaction(id) {
  await idbDelete('transactions', id);
  state.transactions = state.transactions.filter(t => t.id !== id);
  renderAll();
  haptic();
}

async function handleExactMoneySubmit() {
  const entered = parseFloat(document.getElementById('inputExactMoney')?.value);
  const curr = document.getElementById('fundsCalibrateCurr')?.value || 'USD';
  const note = document.getElementById('inputCalibrateNote')?.value || 'Wallet count & bank check';
  if (isNaN(entered)) return;

  const targetUSD = curr === 'LBP_K' ? (entered * 1000) / LBP_RATE : entered;
  const current = calculateRealTimeBalance();
  const diff = targetUSD - current;

  state.baseBalance = (Number(state.baseBalance) || 0) + diff;
  await saveSettings();

  const adjustmentRecord = {
    id: 'bal_' + Date.now(),
    date: getTodayISO(),
    amount: targetUSD,
    inputCurrency: curr,
    inputAmount: entered,
    source: note + (curr === 'LBP_K' ? ` (${entered}k L.L)` : ` ($${entered})`),
    account: curr === 'LBP_K' ? 'L.L Cash' : 'Vault Balance',
    timestamp: Date.now(),
    isCalibration: true
  };

  await idbPut('balances', adjustmentRecord);
  state.adjustments.unshift(adjustmentRecord);

  document.getElementById('inputExactMoney').value = '';
  document.getElementById('inputCalibrateNote').value = '';

  renderAll();
  haptic();
}

async function handleInflowSubmit(e) {
  e.preventDefault();
  const entered = parseFloat(document.getElementById('inflowAmount')?.value);
  const curr = document.getElementById('inflowCurrSelect')?.value || 'USD';
  const source = document.getElementById('inflowSource')?.value;
  const account = document.getElementById('inflowAccount')?.value || 'Cash';
  if (isNaN(entered) || entered <= 0) return;

  const amountUSD = curr === 'LBP_K' ? (entered * 1000) / LBP_RATE : entered;
  const now = new Date();
  const date = getTodayISO();

  // Create Inflow Transaction
  const txRecord = {
    id: 'tx_' + Date.now(),
    type: 'income',
    amount: amountUSD,
    inputCurrency: curr,
    inputAmount: entered,
    category: 'Income',
    note: source,
    date,
    time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    timestamp: Date.now(),
    paymentMethod: account === 'Cash' ? 'Cash' : 'Bank Transfer',
    createdAt: now.toISOString()
  };

  const adjRecord = {
    id: 'bal_' + Date.now(),
    date,
    amount: amountUSD,
    inputCurrency: curr,
    inputAmount: entered,
    source: source + (curr === 'LBP_K' ? ` (${entered}k L.L)` : ` ($${entered})`),
    account,
    timestamp: Date.now()
  };

  await idbPut('transactions', txRecord);
  await idbPut('balances', adjRecord);

  state.transactions.unshift(txRecord);
  state.adjustments.unshift(adjRecord);

  document.getElementById('inflowAmount').value = '';
  document.getElementById('inflowSource').value = '';

  renderAll();
  haptic();
}

// ============================================================================
// SHEET & MODAL CONTROLS
// ============================================================================
function switchTab(tabId) {
  state.activeTab = tabId;

  document.querySelectorAll('.tab-item:not(.center-add-tab)').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabId);
  });

  document.querySelectorAll('.ios-view').forEach(v => {
    v.classList.toggle('active', v.id === `view-${tabId}`);
  });

  if (tabId === 'dashboard') {
    setTimeout(renderDailyChart, 50);
  } else if (tabId === 'analytics') {
    setTimeout(renderAnalyticsView, 50);
  }
}

function setSheetTxType(type) {
  const expenseBtn = document.getElementById('btnSheetExpense');
  const incomeBtn = document.getElementById('btnSheetIncome');
  const catSection = document.getElementById('sheetCategorySection');
  const typeInput = document.getElementById('sheetTxType');

  if (type === 'income') {
    expenseBtn?.classList.remove('active');
    incomeBtn?.classList.add('active');
    if (catSection) catSection.style.display = 'none';
    if (typeInput) typeInput.value = 'income';
  } else {
    incomeBtn?.classList.remove('active');
    expenseBtn?.classList.add('active');
    if (catSection) catSection.style.display = 'flex';
    if (typeInput) typeInput.value = 'expense';
  }
  haptic();
}

function updateSheetConversionHint() {
  const sheetAmtInput = document.getElementById('sheetAmount');
  const sheetCurrInput = document.getElementById('sheetCurrencyInput');
  const sheetConversionHint = document.getElementById('sheetConversionHint');
  if (!sheetAmtInput || !sheetCurrInput || !sheetConversionHint) return;

  const val = parseFloat(sheetAmtInput.value);
  const isLbp = sheetCurrInput.value === 'LBP_K';

  if (isNaN(val) || val <= 0) {
    sheetConversionHint.textContent = isLbp ? '100 = 100,000 L.L (89k = $1.00)' : 'Enter amount in USD';
    return;
  }

  if (isLbp) {
    const usdVal = ((val * 1000) / LBP_RATE).toFixed(2);
    const fullLBP = (val * 1000).toLocaleString();
    sheetConversionHint.textContent = `${val}k L.L (${fullLBP} L.L) ≈ $${usdVal} USD`;
  } else {
    const lbpK = ((val * LBP_RATE) / 1000).toFixed(1);
    sheetConversionHint.textContent = `$${val} ≈ ${lbpK}k L.L (at 89k/$)`;
  }
}

function openSheet() {
  const form = document.getElementById('sheetTxForm');
  if (form) form.reset();

  const idInput = document.getElementById('sheetEditingTxId');
  const modalTitle = document.getElementById('sheetModalTitle');
  const modeBadge = document.getElementById('sheetModeBadge');
  const saveBtn = document.getElementById('btnSaveTransaction');
  const deleteBtn = document.getElementById('btnDeleteFromSheet');

  if (idInput) idInput.value = '';
  if (modalTitle) modalTitle.textContent = 'Log Spend';
  if (modeBadge) modeBadge.style.display = 'none';
  if (saveBtn) saveBtn.textContent = 'Save';
  if (deleteBtn) deleteBtn.style.display = 'none';

  setSheetTxType('expense');

  // Reset currency toggle to USD
  const btnCurrUSD = document.getElementById('btnSheetCurrUSD');
  const btnCurrLBP = document.getElementById('btnSheetCurrLBP');
  const sheetCurrSym = document.getElementById('sheetCurrSymbol');
  const sheetCurrSuffix = document.getElementById('sheetCurrSuffix');
  const sheetCurrInput = document.getElementById('sheetCurrencyInput');

  btnCurrUSD?.classList.add('active');
  btnCurrLBP?.classList.remove('active');
  if (sheetCurrInput) sheetCurrInput.value = 'USD';
  if (sheetCurrSym) sheetCurrSym.textContent = '$';
  if (sheetCurrSuffix) sheetCurrSuffix.style.display = 'none';

  selectCategoryChip('Food & Dining');
  const dateInput = document.getElementById('sheetDate');
  if (dateInput) dateInput.value = getTodayISO();

  updateSheetConversionHint();

  document.getElementById('txSheetModal')?.classList.add('open');
  document.getElementById('sheetAmount')?.focus();
  haptic();
}

function openEditTx(id) {
  const tx = state.transactions.find(t => t.id === id);
  if (!tx) return;

  const idInput = document.getElementById('sheetEditingTxId');
  const modalTitle = document.getElementById('sheetModalTitle');
  const modeBadge = document.getElementById('sheetModeBadge');
  const saveBtn = document.getElementById('btnSaveTransaction');
  const deleteBtn = document.getElementById('btnDeleteFromSheet');
  const amtInput = document.getElementById('sheetAmount');
  const noteInput = document.getElementById('sheetNote');
  const dateInput = document.getElementById('sheetDate');
  const paymentSelect = document.getElementById('sheetPaymentMethod');

  if (idInput) idInput.value = tx.id;
  if (modalTitle) modalTitle.textContent = 'Edit Log';
  if (modeBadge) modeBadge.style.display = 'inline-block';
  if (saveBtn) saveBtn.textContent = 'Update Log';
  if (deleteBtn) deleteBtn.style.display = 'block';

  setSheetTxType(tx.type || 'expense');

  const btnCurrUSD = document.getElementById('btnSheetCurrUSD');
  const btnCurrLBP = document.getElementById('btnSheetCurrLBP');
  const sheetCurrSym = document.getElementById('sheetCurrSymbol');
  const sheetCurrSuffix = document.getElementById('sheetCurrSuffix');
  const sheetCurrInput = document.getElementById('sheetCurrencyInput');

  if (tx.inputCurrency === 'LBP_K') {
    btnCurrLBP?.classList.add('active');
    btnCurrUSD?.classList.remove('active');
    if (sheetCurrInput) sheetCurrInput.value = 'LBP_K';
    if (sheetCurrSym) sheetCurrSym.textContent = 'L.L ';
    if (sheetCurrSuffix) sheetCurrSuffix.style.display = 'inline-block';
    if (amtInput) amtInput.value = tx.inputAmount != null ? tx.inputAmount : Math.round(((Number(tx.amount) || 0) * LBP_RATE) / 1000);
  } else {
    btnCurrUSD?.classList.add('active');
    btnCurrLBP?.classList.remove('active');
    if (sheetCurrInput) sheetCurrInput.value = 'USD';
    if (sheetCurrSym) sheetCurrSym.textContent = '$';
    if (sheetCurrSuffix) sheetCurrSuffix.style.display = 'none';
    if (amtInput) amtInput.value = tx.inputAmount != null ? tx.inputAmount : (Number(tx.amount) || 0);
  }

  updateSheetConversionHint();
  selectCategoryChip(tx.category || 'Food & Dining');

  if (noteInput) noteInput.value = tx.note || '';
  if (dateInput) dateInput.value = tx.date || getTodayISO();
  if (paymentSelect) paymentSelect.value = tx.paymentMethod || 'Cash';

  document.getElementById('txSheetModal')?.classList.add('open');
  amtInput?.focus();
  haptic();
}

function selectCategoryChip(catName) {
  const container = document.getElementById('sheetCategoryPicker');
  const input = document.getElementById('sheetSelectedCategory');
  if (!container) return;

  let found = false;
  container.querySelectorAll('.category-chip').forEach(c => {
    const chipCat = c.dataset.cat;
    if (chipCat === catName || (catName === 'Other' && chipCat === 'Other / Misc') || (catName === 'Other / Misc' && chipCat === 'Other')) {
      c.classList.add('selected');
      found = true;
    } else {
      c.classList.remove('selected');
    }
  });

  if (!found) {
    const firstChip = container.querySelector('.category-chip');
    if (firstChip) {
      firstChip.classList.add('selected');
      if (input) input.value = firstChip.dataset.cat;
    }
  } else {
    if (input) input.value = catName;
  }
}

function closeSheet() {
  document.getElementById('txSheetModal')?.classList.remove('open');
  const idInput = document.getElementById('sheetEditingTxId');
  if (idInput) idInput.value = '';
  const form = document.getElementById('sheetTxForm');
  if (form) form.reset();
  const deleteBtn = document.getElementById('btnDeleteFromSheet');
  if (deleteBtn) deleteBtn.style.display = 'none';
  updateSheetConversionHint();
}

function closeAllModals() {
  document.querySelectorAll('.ios-modal-backdrop').forEach(m => m.classList.remove('open'));
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================================
// DATA EXPORT (JSON & CSV FOR ANALYTICS)
// ============================================================================
function exportFullAnalyticsJSON() {
  const exportPayload = {
    app: 'Vault Finance Engine',
    version: '2.0.0',
    exportDate: new Date().toISOString(),
    settings: {
      currency: state.currency,
      baseBalance: state.baseBalance,
      dailyBudget: state.dailyBudget,
      reminderEnabled: state.reminderEnabled,
      reminderTime: state.reminderTime,
      reminderTime2: state.reminderTime2
    },
    balances: state.adjustments,
    transactions: state.transactions
  };

  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportPayload, null, 2));
  downloadFile(dataStr, `vault_analytics_${getTodayISO()}.json`);
}

function exportTransactionsCSV() {
  if (state.transactions.length === 0) {
    alert('No transactions to export.');
    return;
  }

  const headers = ['ID', 'Type', 'Amount', 'Currency', 'Category', 'Note', 'Date', 'Time', 'PaymentMethod', 'Timestamp'];
  const rows = state.transactions.map(tx => [
    tx.id,
    tx.type,
    tx.amount,
    state.currency,
    `"${(tx.category || '').replace(/"/g, '""')}"`,
    `"${(tx.note || '').replace(/"/g, '""')}"`,
    tx.date,
    tx.time || '',
    tx.paymentMethod || '',
    tx.timestamp || ''
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  downloadFile(csvContent, `vault_transactions_${getTodayISO()}.csv`);
}

function downloadFile(content, fileName) {
  const a = document.createElement('a');
  a.setAttribute('href', content);
  a.setAttribute('download', fileName);
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function importDataJSON(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const data = JSON.parse(event.target.result);
      if (data.transactions) {
        // Clear and rewrite IndexedDB
        for (const tx of data.transactions) {
          await idbPut('transactions', tx);
        }
        if (data.balances) {
          for (const b of data.balances) {
            await idbPut('balances', b);
          }
        }
        if (data.settings) {
          state.currency = data.settings.currency || state.currency;
          state.baseBalance = data.settings.baseBalance || 0;
          state.dailyBudget = data.settings.dailyBudget || 50;
          if (data.settings.reminderEnabled !== undefined) state.reminderEnabled = !!data.settings.reminderEnabled;
          if (data.settings.reminderTime) state.reminderTime = data.settings.reminderTime;
          if (data.settings.reminderTime2) state.reminderTime2 = data.settings.reminderTime2;
          await saveSettings();
        }
        await loadDataFromIndexedDB();
        renderAll();
        document.getElementById('settingsModal')?.classList.remove('open');
        alert('Vault data successfully restored!');
      }
    } catch (err) {
      alert('Error parsing JSON backup file.');
    }
  };
  reader.readAsText(file);
}

async function wipeAllData() {
  if (confirm('Permanently wipe all records and reset all numbers to zeros? This cannot be undone.')) {
    const tx = db.transaction(['transactions', 'balances', 'settings'], 'readwrite');
    tx.objectStore('transactions').clear();
    tx.objectStore('balances').clear();
    state.transactions = [];
    state.adjustments = [];
    state.baseBalance = 0;
    await saveSettings();
    renderAll();
    document.getElementById('settingsModal')?.classList.remove('open');
    haptic();
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================
async function init() {
  localStorage.removeItem('vault_finance_data_v1');
  await initIndexedDB();
  await loadDataFromIndexedDB();
  registerPWA();
  setupEventListeners();
  checkNotificationStatus();
  renderAll();
}

window.addEventListener('DOMContentLoaded', init);
