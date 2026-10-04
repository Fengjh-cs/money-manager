'use strict';

/* ============ 全局状态 ============ */
const state = {
  user: null,
  ledger: null,
  users: [],
  standards: [],
  currencies: [],
  accounts: [],
  nav: 'vouchers',
  voucherPeriod: currentPeriod(),
  voucherStatus: '',
};

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/* ============ 工具 ============ */
async function call(method, payload) {
  const res = await window.api.call(method, payload);
  if (!res.ok) throw new Error(res.error || '操作失败');
  return res.data;
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmt(s) {
  if (s == null || s === '') return '';
  const neg = String(s).startsWith('-');
  let [i, f] = String(s).replace('-', '').split('.');
  i = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + i + (f ? '.' + f : '');
}

function precisionOf(code) {
  const c = state.currencies.find(x => x.code === code);
  return c ? c.precision : 2;
}
function centsToStr(cents, code) {
  const p = precisionOf(code);
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const scale = Math.pow(10, p);
  const i = Math.floor(abs / scale);
  const f = String(abs % scale).padStart(p, '0');
  return (neg ? '-' : '') + i + '.' + f;
}
function rateStr(rs) {
  if (rs == null) return '';
  const neg = rs < 0;
  const s = String(Math.abs(rs)).padStart(9, '0');
  const intPart = s.slice(0, -8) || '0';
  const frac = s.slice(-8).replace(/0+$/, '');
  return (neg ? '-' : '') + intPart + (frac ? '.' + frac : '');
}

let toastTimer = null;
function toast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast ' + (type || '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
}

const isAccountant = () => state.user && state.user.role === 'accountant';
const baseCurrency = () => (state.ledger ? state.ledger.base_currency : 'CNY');

function leafAccounts() {
  return state.accounts.filter(a => a.is_leaf && a.enabled);
}

/* ============ 渲染入口 ============ */
const appEl = () => document.getElementById('app');

function render(html) {
  appEl().innerHTML = html;
}

/* ---------- 登录 ---------- */
function renderLogin() {
  const buttons = state.users.map(u => `
    <button class="role-btn" data-action="login" data-arg="${esc(u.username)}">
      <span class="icon">${u.role === 'accountant' ? '📒' : '🔍'}</span>
      ${esc(u.username)}
      <div class="desc">${u.role === 'accountant' ? '录入、审核、记账、结账' : '只读查看、审计追踪'}</div>
    </button>`).join('');
  render(`
    <div class="login-wrap">
      <div class="login-card">
        <h1>记账程序</h1>
        <div class="sub">请选择你的身份登录</div>
        <div class="role-btns">${buttons}</div>
      </div>
    </div>`);
}

/* ---------- 建账向导 ---------- */
function renderSetup() {
  const standards = state.standards.map((s, i) => `
    <label><input type="radio" name="standard" value="${esc(s)}" ${i === 0 ? 'checked' : ''}>${esc(s)}</label>`).join('');
  render(`
    <div class="setup-wrap">
      <div class="setup-card">
        <h1>建账向导</h1>
        <p class="hint">首次使用,请填写以下信息建立账套。启用期间一般为开始记账的月份。</p>
        <div class="form-row"><label>公司名称</label><input id="setup-name" placeholder="例如:XX科技有限公司"></div>
        <div class="form-row"><label>会计准则</label><div class="radio-group">${standards}</div></div>
        <div class="form-row"><label>启用期间(年月)</label><input id="setup-period" type="month" value="${currentPeriod()}"></div>
        <div class="form-row"><label>本位币</label>
          <select id="setup-currency">${state.currencies.map(c => `<option value="${esc(c.code)}" ${c.code === 'CNY' ? 'selected' : ''}>${esc(c.name)}(${c.code})</option>`).join('')}</select>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:8px">
          <button class="primary" data-action="setup:submit">建立账套</button>
        </div>
      </div>
    </div>`);
}

/* ---------- 主界面骨架 ---------- */
const NAV = [
  { key: 'vouchers', label: '凭证管理' },
  { key: 'trial', label: '试算平衡' },
  { key: 'ledger', label: '明细账' },
  { key: 'reports', label: '财务报表' },
  { key: 'opening', label: '期初余额' },
  { key: 'rates', label: '汇率设置' },
  { key: 'audit', label: '审计日志' },
  { key: 'snapshots', label: '备份与回滚' },
];

function renderApp() {
  const nav = NAV.map(n => `
    <button class="nav-item ${state.nav === n.key ? 'active' : ''}" data-action="nav" data-arg="${n.key}">${n.label}</button>`).join('');
  render(`
    <div class="layout">
      <div class="sidebar">
        <div class="brand">记账程序</div>
        <div class="nav">${nav}</div>
        <div class="user-box">
          <div>${esc(state.user.username)}</div>
          <div class="role">${state.user.role === 'accountant' ? '会计(可编辑)' : '审计(只读)'} · ${esc(state.ledger ? state.ledger.name : '')}</div>
          <button class="link" data-action="logout" style="color:#8fb0e0;margin-top:6px">退出登录</button>
        </div>
      </div>
      <div class="main" id="main-content">${viewHtml(state.nav)}</div>
    </div>`);
  afterView(state.nav);
}

function viewHtml(key) {
  switch (key) {
    case 'vouchers': return voucherListHtml();
    case 'trial': return trialHtml();
    case 'ledger': return ledgerHtml();
    case 'reports': return reportsHtml();
    case 'opening': return openingHtml();
    case 'rates': return ratesHtml();
    case 'audit': return auditHtml();
    case 'snapshots': return snapshotsHtml();
    default: return '<p>未知页面</p>';
  }
}

/* ---------- 凭证列表 ---------- */
function voucherListHtml() {
  return `
    <div class="page-head"><h1>凭证管理</h1>
      <button class="primary" data-action="voucher:new" ${isAccountant() ? '' : 'hidden'}>+ 新建凭证</button>
    </div>
    <div class="panel">
      <div class="toolbar">
        <label>期间</label><input id="v-period" type="month" value="${state.voucherPeriod}" style="width:150px">
        <label>状态</label>
        <select id="v-status" style="width:130px">
          <option value="">全部</option>
          <option value="draft">草稿</option>
          <option value="approved">已审核</option>
          <option value="posted">已记账</option>
          <option value="voided">已作废</option>
        </select>
        <button class="primary" data-action="voucher:filter">查询</button>
      </div>
      <div id="voucher-list">${''}</div>
    </div>`;
}

async function loadVoucherList() {
  const period = document.getElementById('v-period') ? document.getElementById('v-period').value : state.voucherPeriod;
  const status = document.getElementById('v-status') ? document.getElementById('v-status').value : state.voucherStatus;
  state.voucherPeriod = period || '';
  state.voucherStatus = status || '';
  const list = await call('voucher:list', { period: state.voucherPeriod || null, status: state.voucherStatus || null });
  const rows = list.map(v => `
    <tr>
      <td>${esc(v.voucher_no)}</td>
      <td>${esc(v.voucher_date)}</td>
      <td>${esc(v.period)}</td>
      <td>${esc(v.voucher_type)}</td>
      <td class="num">${fmt(v.total_debit)}</td>
      <td>${esc(v.maker)}</td>
      <td>${esc(v.reviewer || '')}</td>
      <td><span class="badge ${esc(v.status)}">${esc(v.status_label)}</span></td>
      <td>${voucherActionBtns(v)}</td>
    </tr>`).join('');
  document.getElementById('voucher-list').innerHTML = list.length
    ? `<table class="grid"><thead><tr><th>凭证号</th><th>日期</th><th>期间</th><th>类型</th><th>借方合计</th><th>制单</th><th>审核</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<div class="empty">暂无凭证</div>';
}

function voucherActionBtns(v) {
  let b = `<button class="link" data-action="voucher:view" data-id="${esc(v.id)}">查看</button>`;
  if (!isAccountant()) return b;
  const a = (action, label) => `<button class="link" data-action="${action}" data-id="${esc(v.id)}">${label}</button>`;
  switch (v.status) {
    case 'draft': b += a('voucher:edit', '编辑') + a('voucher:review', '审核') + a('voucher:void', '作废'); break;
    case 'approved': b += a('voucher:unreview', '反审核') + a('voucher:post', '记账') + a('voucher:void', '作废'); break;
    case 'posted': b += a('voucher:unpost', '反记账') + a('voucher:reverse', '冲销'); break;
  }
  return b;
}

/* ---------- 凭证编辑器 ---------- */
let editingId = null;

function accountOptions(selected) {
  return leafAccounts().map(a => `<option value="${esc(a.id)}" ${a.id === selected ? 'selected' : ''}>${esc(a.code)} ${esc(a.name)}</option>`).join('');
}
function currencyOptions(selected) {
  return state.currencies.map(c => `<option value="${esc(c.code)}" ${c.code === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}

function renderVoucherEditor(voucher) {
  editingId = voucher ? voucher.id : null;
  const isEdit = !!voucher;
  const v = voucher;
  const readOnly = isEdit && v.status !== 'draft';
  const canEdit = isAccountant() && !readOnly;

  const defaultDate = v ? v.voucher_date : todayStr();
  const defaultType = v ? v.voucher_type : '记';
  const defaultAttach = v ? v.attachment_count : 0;

  let entries = [];
  if (v && v.entries) {
    entries = v.entries.map(e => ({ summary: e.summary, account_id: e.account_id, currency_code: e.currency_code, rate: rateStr(e.exchange_rate_scaled), debit: e.currency_code === baseCurrency() ? centsToStr(e.debit, e.currency_code) : centsToStr(e.debit_foreign, e.currency_code), credit: e.currency_code === baseCurrency() ? centsToStr(e.credit, e.currency_code) : centsToStr(e.credit_foreign, e.currency_code) }));
  } else {
    entries = [emptyEntry(), emptyEntry()];
  }

  const title = readOnly ? `凭证 ${v.voucher_no}(${v.status_label})` : (isEdit ? `编辑凭证 ${v.voucher_no}` : '新建凭证');
  const head = `
    <div class="toolbar">
      <label>日期</label><input id="ev-date" type="date" value="${defaultDate}" ${canEdit ? '' : 'disabled'}>
      <label>类型</label><select id="ev-type" ${canEdit ? '' : 'disabled'}>
        ${['记', '收', '付', '转'].map(t => `<option ${t === defaultType ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <label>附件</label><input id="ev-attach" type="number" min="0" value="${defaultAttach}" style="width:70px" ${canEdit ? '' : 'disabled'}>
    </div>
    <table class="entry-grid">
      <thead><tr><th style="width:30%">摘要</th><th>科目</th><th style="width:100px">币种</th><th style="width:100px">汇率</th><th style="width:120px">借方金额</th><th style="width:120px">贷方金额</th><th></th></tr></thead>
      <tbody id="entry-rows"></tbody>
    </table>
    ${canEdit ? '<button class="link" data-action="voucher:addline">+ 增加一行</button>' : ''}
    <div class="entry-summary-bar">
      <span>借方合计:<span class="ok" id="sum-debit">0.00</span></span>
      <span>贷方合计:<span class="ok" id="sum-credit">0.00</span></span>
      <span id="sum-tip" class="balanced-tip muted"></span>
    </div>`;

  render(`
    <div class="modal-mask">
      <div class="modal wide">
        <h2>${title}</h2>
        ${head}
        <div class="actions">
          ${canEdit ? `<button class="primary" data-action="voucher:save">保存</button>` : ''}
          <button data-action="modal:close">${readOnly ? '关闭' : '取消'}</button>
        </div>
      </div>
    </div>`);

  // 渲染分录行
  renderEntryRows(entries, canEdit);
  recalcTotals();
}

function emptyEntry() {
  return { summary: '', account_id: leafAccounts()[0] ? leafAccounts()[0].id : '', currency_code: baseCurrency(), rate: '', debit: '', credit: '' };
}

function renderEntryRows(entries, canEdit) {
  const tbody = document.getElementById('entry-rows');
  if (!tbody) return;
  tbody.innerHTML = entries.map((e, i) => `
    <tr data-line="${i}">
      <td><input class="e-summary" value="${esc(e.summary)}" ${canEdit ? '' : 'disabled'}></td>
      <td><select class="e-account" ${canEdit ? '' : 'disabled'}>${accountOptions(e.account_id)}</select></td>
      <td><select class="e-currency" ${canEdit ? '' : 'disabled'}>${currencyOptions(e.currency_code)}</select></td>
      <td><input class="e-rate" value="${esc(e.rate)}" placeholder="外币汇率" ${canEdit ? '' : 'disabled'}></td>
      <td><input class="e-debit amount" value="${esc(e.debit)}" ${canEdit ? '' : 'disabled'}></td>
      <td><input class="e-credit amount" value="${esc(e.credit)}" ${canEdit ? '' : 'disabled'}></td>
      <td>${canEdit ? `<button class="small danger" data-action="voucher:delline" data-line="${i}">删</button>` : ''}</td>
    </tr>`).join('');
}

function readEntryRows() {
  const rows = [];
  document.querySelectorAll('#entry-rows tr').forEach(tr => {
    rows.push({
      summary: tr.querySelector('.e-summary').value,
      account_id: tr.querySelector('.e-account').value,
      currency_code: tr.querySelector('.e-currency').value,
      exchange_rate: tr.querySelector('.e-rate').value,
      debit: tr.querySelector('.e-debit').value,
      credit: tr.querySelector('.e-credit').value,
    });
  });
  return rows;
}

function recalcTotals() {
  const sumDebit = document.getElementById('sum-debit');
  const sumCredit = document.getElementById('sum-credit');
  const tip = document.getElementById('sum-tip');
  if (!sumDebit) return;
  let td = 0, tc = 0;
  readEntryRows().forEach(r => {
    const cur = r.currency_code;
    const rate = parseFloat(r.exchange_rate) || 0;
    if (cur === baseCurrency()) {
      td += parseFloat(r.debit) || 0;
      tc += parseFloat(r.credit) || 0;
    } else if (rate > 0) {
      td += (parseFloat(r.debit) || 0) * rate;
      tc += (parseFloat(r.credit) || 0) * rate;
    }
  });
  sumDebit.textContent = fmt(td.toFixed(2));
  sumCredit.textContent = fmt(tc.toFixed(2));
  const diff = Math.abs(td - tc);
  if (td === 0 && tc === 0) { tip.textContent = '请填写分录'; tip.className = 'balanced-tip muted'; }
  else if (diff < 0.005) { tip.textContent = '✓ 借贷平衡'; tip.className = 'balanced-tip ok'; }
  else { tip.textContent = `✗ 借贷不平衡(差 ${fmt(diff.toFixed(2))})`; tip.className = 'balanced-tip err'; }
}

function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/* ---------- 试算平衡 ---------- */
function trialHtml() {
  return `
    <div class="page-head"><h1>试算平衡表</h1></div>
    <div class="panel">
      <div class="toolbar"><label>期间</label><input id="tb-period" type="month" value="${state.voucherPeriod || currentPeriod()}">
      <button class="primary" data-action="trial:load">查询</button></div>
      <div id="trial-table"></div>
    </div>`;
}

async function loadTrial() {
  const period = document.getElementById('tb-period').value || currentPeriod();
  const tb = await call('report:trialBalance', period);
  const rows = tb.rows.filter(r => r.ending_debit !== '0.00' || r.ending_credit !== '0.00' || r.period_debit !== '0.00' || r.period_credit !== '0.00')
    .map(r => `<tr>
      <td>${esc(r.code)}</td><td>${esc(r.name)}</td>
      <td class="num">${fmt(r.opening_debit)}</td><td class="num">${fmt(r.opening_credit)}</td>
      <td class="num">${fmt(r.period_debit)}</td><td class="num">${fmt(r.period_credit)}</td>
      <td class="num">${fmt(r.ending_debit)}</td><td class="num">${fmt(r.ending_credit)}</td>
    </tr>`).join('');
  const total = tb.total;
  document.getElementById('trial-table').innerHTML = `
    <table class="grid"><thead><tr><th>科目编码</th><th>科目名称</th><th>期初借方</th><th>期初贷方</th><th>本期借方</th><th>本期贷方</th><th>期末借方</th><th>期末贷方</th></tr></thead>
    <tbody>${rows}
    <tr class="totals"><td colspan="2">合计</td>
      <td class="num">${fmt(total.opening_debit)}</td><td class="num">${fmt(total.opening_credit)}</td>
      <td class="num">${fmt(total.period_debit)}</td><td class="num">${fmt(total.period_credit)}</td>
      <td class="num">${fmt(total.ending_debit)}</td><td class="num">${fmt(total.ending_credit)}</td>
    </tr></tbody></table>
    <div style="margin-top:10px" class="${tb.balanced ? 'ok' : 'err'}">${tb.balanced ? '✓ 试算平衡(期末借方 = 期末贷方)' : '✗ 试算不平衡'}</div>`;
}

/* ---------- 明细账 ---------- */
function ledgerHtml() {
  const opts = leafAccounts().map(a => `<option value="${esc(a.id)}">${esc(a.code)} ${esc(a.name)}</option>`).join('');
  return `
    <div class="page-head"><h1>明细账</h1></div>
    <div class="panel">
      <div class="toolbar">
        <label>科目</label><select id="sl-account">${opts}</select>
        <label>从</label><input id="sl-from" type="month" value="${state.voucherPeriod || currentPeriod()}" style="width:150px">
        <label>到</label><input id="sl-to" type="month" value="${state.voucherPeriod || currentPeriod()}" style="width:150px">
        <button class="primary" data-action="ledger:load">查询</button>
      </div>
      <div id="sl-result"></div>
    </div>`;
}

async function loadLedger() {
  const account = document.getElementById('sl-account').value;
  const from = document.getElementById('sl-from').value;
  const to = document.getElementById('sl-to').value;
  const res = await call('report:subsidiaryLedger', { account_id: account, from, to });
  const lines = res.lines.map(l => {
    const bal = l.balance_debit !== '0.00' ? '借 ' + fmt(l.balance_debit)
      : (l.balance_credit !== '0.00' ? '贷 ' + fmt(l.balance_credit) : '平');
    return `<tr>
      <td>${esc(l.voucher_date)}</td><td>${esc(l.voucher_no)}</td><td>${esc(l.summary)}</td>
      <td class="num">${fmt(l.debit)}</td><td class="num">${fmt(l.credit)}</td><td class="num">${bal}</td>
    </tr>`;
  }).join('');
  document.getElementById('sl-result').innerHTML = `
    <div style="margin:8px 0">科目:${esc(res.account.code)} ${esc(res.account.name)} · 期初余额:<strong>${fmt(res.opening_balance)}</strong></div>
    ${lines ? `<table class="grid"><thead><tr><th>日期</th><th>凭证号</th><th>摘要</th><th>借方</th><th>贷方</th><th>余额</th></tr></thead><tbody>${lines}</tbody></table>` : '<div class="empty">该区间无发生额</div>'}`;
}

/* ---------- 财务报表 ---------- */
function reportsHtml() {
  return `
    <div class="page-head"><h1>财务报表</h1></div>
    <div class="panel">
      <div class="toolbar"><label>期间</label><input id="rp-period" type="month" value="${state.voucherPeriod || currentPeriod()}">
      <button class="primary" data-action="reports:load">查询</button></div>
      <div id="reports-body"></div>
    </div>`;
}

async function loadReports() {
  const period = document.getElementById('rp-period').value || currentPeriod();
  const bs = await call('report:balanceSheet', period);
  const inc = await call('report:incomeStatement', period);
  const bsRows = (arr) => arr.map(x => `<tr><td>${esc(x.code)}</td><td>${esc(x.name)}</td><td class="num">${fmt(x.balance)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">无</td></tr>';
  document.getElementById('reports-body').innerHTML = `
    <div class="asset-grid">
      <div>
        <div class="section-title">资产负债表(${period})</div>
        <table class="grid"><thead><tr><th>科目</th><th>名称</th><th>余额</th></tr></thead><tbody>
          <tr><td colspan="3" class="section-title" style="padding:6px">资产</td></tr>${bsRows(bs.assets)}
          <tr class="totals"><td colspan="2">资产合计</td><td class="num">${fmt(bs.asset_total)}</td></tr>
          <tr><td colspan="3" class="section-title" style="padding:6px">负债</td></tr>${bsRows(bs.liabilities)}
          <tr class="totals"><td colspan="2">负债合计</td><td class="num">${fmt(bs.liability_total)}</td></tr>
          <tr><td colspan="3" class="section-title" style="padding:6px">所有者权益</td></tr>${bsRows(bs.equities)}
          <tr><td colspan="2">其中:本年利润</td><td class="num">${fmt(bs.retained_profit)}</td></tr>
          <tr class="totals"><td colspan="2">权益合计</td><td class="num">${fmt(bs.equity_total)}</td></tr>
        </tbody></table>
        <div style="margin-top:8px" class="${bs.balanced ? 'ok' : 'err'}">${bs.balanced ? '✓ 资产 = 负债 + 所有者权益' : '✗ 资产负债表不平衡'}</div>
      </div>
      <div>
        <div class="section-title">利润表(${period})</div>
        <table class="grid"><thead><tr><th>科目</th><th>名称</th><th>金额</th></tr></thead><tbody>
          ${inc.rows.filter(r => r.net !== '0.00').map(r => `<tr><td>${esc(r.code)}</td><td>${esc(r.name)}</td><td class="num">${fmt(r.net)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">本期无损益</td></tr>'}
          <tr class="totals"><td colspan="2">收入合计</td><td class="num">${fmt(inc.revenue)}</td></tr>
          <tr class="totals"><td colspan="2">费用合计</td><td class="num">${fmt(inc.expense)}</td></tr>
          <tr class="totals"><td colspan="2">净利润</td><td class="num">${fmt(inc.profit)}</td></tr>
        </tbody></table>
      </div>
    </div>`;
}

/* ---------- 期初余额 ---------- */
function openingHtml() {
  const opts = leafAccounts().map(a => `<option value="${esc(a.id)}">${esc(a.code)} ${esc(a.name)}</option>`).join('');
  return `
    <div class="page-head"><h1>期初余额</h1></div>
    <div class="panel">
      ${isAccountant() ? `
      <div class="toolbar">
        <label>科目</label><select id="ob-account">${opts}</select>
        <label>方向</label><select id="ob-dir"><option value="debit">借方</option><option value="credit">贷方</option></select>
        <label>金额</label><input id="ob-amount" placeholder="0.00" style="width:140px">
        <label>期间</label><input id="ob-period" type="month" value="${currentPeriod()}" style="width:150px">
        <button class="primary" data-action="opening:save">保存</button>
      </div>
      <p class="hint">期初余额仅录入末级科目。方向为「贷方」时,系统按负的借方余额存储。</p>` : '<p class="hint">审计角色为只读,不能录入期初余额。</p>'}
      <div id="ob-list"></div>
    </div>`;
}

async function loadOpening() {
  const period = (document.getElementById('ob-period') && document.getElementById('ob-period').value) || currentPeriod();
  const list = await call('opening:list', period);
  const acctMap = {};
  state.accounts.forEach(a => acctMap[a.id] = a);
  const rows = list.map(o => {
    const a = acctMap[o.account_id] || {};
    const amt = o.amount;
    const dir = amt >= 0 ? '借' : '贷';
    const abs = Math.abs(amt);
    return `<tr><td>${esc(a.code || o.account_id)}</td><td>${esc(a.name || '')}</td><td>${dir}</td><td class="num">${fmt(centsToStr(abs, o.currency_code || baseCurrency()))}</td></tr>`;
  }).join('');
  document.getElementById('ob-list').innerHTML = rows
    ? `<table class="grid"><thead><tr><th>科目</th><th>名称</th><th>方向</th><th>金额</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<div class="empty">该期间暂无期初余额</div>';
}

/* ---------- 汇率设置 ---------- */
function ratesHtml() {
  const opts = state.currencies.filter(c => c.code !== baseCurrency()).map(c => `<option value="${esc(c.code)}">${esc(c.name)}(${c.code})</option>`).join('');
  return `
    <div class="page-head"><h1>汇率设置</h1></div>
    <div class="panel">
      ${isAccountant() ? `
      <div class="toolbar">
        <label>外币</label><select id="rate-ccy">${opts}</select>
        <label>期间</label><input id="rate-period" type="month" value="${currentPeriod()}" style="width:150px">
        <label>汇率(1 外币 = ? 本位币)</label><input id="rate-value" placeholder="7.10" style="width:140px">
        <button class="primary" data-action="rate:save">保存</button>
      </div>` : '<p class="hint">审计角色为只读。</p>'}
      <div id="rate-list"></div>
    </div>`;
}

async function loadRates() {
  const period = (document.getElementById('rate-period') && document.getElementById('rate-period').value) || currentPeriod();
  const list = await call('rate:list', period);
  const rows = list.map(r => `<tr><td>${esc(r.currency_code)}</td><td>${esc(r.period)}</td><td class="num">${fmt(r.rate)}</td></tr>`).join('');
  document.getElementById('rate-list').innerHTML = rows
    ? `<table class="grid"><thead><tr><th>外币</th><th>期间</th><th>汇率</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<div class="empty">该期间暂无汇率设置</div>';
}

/* ---------- 审计日志 ---------- */
function auditHtml() {
  return `
    <div class="page-head"><h1>审计日志</h1></div>
    <div class="panel"><div id="audit-list"></div></div>`;
}

async function loadAudit() {
  const logs = await call('audit:list', 500);
  const rows = logs.map(l => `<tr>
    <td>${esc(l.created_at)}</td><td>${esc(l.username || '')}</td><td>${esc(l.role ? (l.role === 'accountant' ? '会计' : '审计') : '')}</td>
    <td>${esc(l.action)}</td><td>${esc(l.entity_type || '')}</td><td>${esc(l.entity_id || '')}</td><td>${esc(l.note || '')}</td>
  </tr>`).join('');
  document.getElementById('audit-list').innerHTML = rows
    ? `<table class="grid"><thead><tr><th>时间</th><th>操作人</th><th>角色</th><th>操作</th><th>对象</th><th>对象ID</th><th>备注</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<div class="empty">暂无日志</div>';
}

/* ---------- 备份与回滚 ---------- */
function snapshotsHtml() {
  return `
    <div class="page-head"><h1>数据备份与回滚</h1></div>
    <div class="panel">
      <div class="toolbar">
        <input id="snap-desc" placeholder="备份说明(可选)" style="width:260px">
        <button class="primary" data-action="snapshot:create" ${isAccountant() ? '' : 'hidden'}>立即备份</button>
      </div>
      <p class="hint">记账、结账等关键操作前建议手动备份。回滚会恢复到某个备份时点的数据,恢复前系统会自动再备份一次当前状态。</p>
      <div id="snap-list"></div>
    </div>`;
}

async function loadSnapshots() {
  const list = await call('snapshot:list');
  const rows = list.map(s => `<tr>
    <td>${esc(s.created_at)}</td>
    <td>${esc(s.trigger === 'manual' ? '手动备份' : s.trigger === 'auto-before-restore' ? '回滚前自动备份' : s.trigger)}</td>
    <td>${esc(s.description || '')}</td>
    <td>${isAccountant() ? `<button class="small danger" data-action="snapshot:restore" data-id="${esc(s.id)}">恢复到此版本</button>` : ''}</td>
  </tr>`).join('');
  document.getElementById('snap-list').innerHTML = rows
    ? `<table class="grid"><thead><tr><th>时间</th><th>类型</th><th>说明</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<div class="empty">暂无备份,建议先「立即备份」</div>';
}

/* ============ 动作处理 ============ */
async function handleAction(action, id, arg) {
  switch (action) {
    case 'login': {
      const r = await call('login', { username: arg });
      state.user = r.user;
      state.ledger = r.ledger;
      if (r.hasLedger) { await refreshAccounts(); renderApp(); }
      else renderSetup();
      break;
    }
    case 'logout': {
      state.user = null; state.ledger = null; state.accounts = [];
      renderLogin();
      break;
    }
    case 'setup:submit': {
      const name = document.getElementById('setup-name').value;
      const standard = document.querySelector('input[name="standard"]:checked').value;
      const period = document.getElementById('setup-period').value;
      const currency = document.getElementById('setup-currency').value;
      if (!name.trim()) { toast('请填写公司名称', 'err'); break; }
      state.ledger = await call('ledger:create', { name: name.trim(), accounting_standard: standard, opening_period: period, base_currency: currency });
      await refreshAccounts();
      toast('账套创建成功', 'ok');
      renderApp();
      break;
    }
    case 'nav': {
      state.nav = arg;
      renderApp();
      break;
    }
    case 'voucher:filter': loadVoucherList(); break;
    case 'voucher:new': renderVoucherEditor(null); break;
    case 'voucher:view': {
      const v = await call('voucher:get', id);
      renderVoucherEditor(v);
      break;
    }
    case 'voucher:edit': {
      const v = await call('voucher:get', id);
      renderVoucherEditor(v);
      break;
    }
    case 'voucher:review': await mut(() => call('voucher:review', id)); break;
    case 'voucher:unreview': await mut(() => call('voucher:unreview', id)); break;
    case 'voucher:post': await mut(() => call('voucher:post', id)); break;
    case 'voucher:unpost': await mut(() => call('voucher:unpost', id)); break;
    case 'voucher:void': await mut(() => call('voucher:void', id)); break;
    case 'voucher:reverse': await mut(() => call('voucher:reverse', id)); break;
    case 'voucher:save': {
      const payload = {
        voucher_date: document.getElementById('ev-date').value,
        voucher_type: document.getElementById('ev-type').value,
        attachment_count: parseInt(document.getElementById('ev-attach').value) || 0,
        entries: readEntryRows(),
      };
      try {
        if (editingId) await call('voucher:update', { ...payload, id: editingId });
        else await call('voucher:create', payload);
        toast('凭证已保存', 'ok');
        renderApp();
      } catch (e) { toast(e.message, 'err'); }
      break;
    }
    case 'voucher:addline': {
      const tbody = document.getElementById('entry-rows');
      const idx = tbody.querySelectorAll('tr').length;
      const tr = document.createElement('tr');
      tr.dataset.line = idx;
      tr.innerHTML = `
        <td><input class="e-summary"></td>
        <td><select class="e-account">${accountOptions()}</select></td>
        <td><select class="e-currency">${currencyOptions(baseCurrency())}</select></td>
        <td><input class="e-rate" placeholder="外币汇率"></td>
        <td><input class="e-debit amount"></td>
        <td><input class="e-credit amount"></td>
        <td><button class="small danger" data-action="voucher:delline" data-line="${idx}">删</button></td>`;
      tbody.appendChild(tr);
      recalcTotals();
      break;
    }
    case 'voucher:delline': {
      const tbody = document.getElementById('entry-rows');
      const trs = tbody.querySelectorAll('tr');
      if (trs.length <= 2) { toast('至少保留两行分录', 'err'); break; }
      trs[parseInt(arg, 10)].remove();
      recalcTotals();
      break;
    }
    case 'modal:close': {
      editingId = null;
      renderApp();
      break;
    }
    case 'trial:load': loadTrial(); break;
    case 'ledger:load': loadLedger(); break;
    case 'reports:load': loadReports(); break;
    case 'opening:save': {
      const account = document.getElementById('ob-account').value;
      const dir = document.getElementById('ob-dir').value;
      const raw = document.getElementById('ob-amount').value;
      const period = document.getElementById('ob-period').value;
      let amount = raw.trim();
      if (dir === 'credit') amount = (amount.startsWith('-') ? amount.slice(1) : '-' + amount);
      try {
        await call('opening:set', { account_id: account, period, amount });
        toast('期初余额已保存', 'ok');
        loadOpening();
      } catch (e) { toast(e.message, 'err'); }
      break;
    }
    case 'rate:save': {
      const ccy = document.getElementById('rate-ccy').value;
      const period = document.getElementById('rate-period').value;
      const rate = document.getElementById('rate-value').value;
      try {
        await call('rate:set', { currency_code: ccy, period, rate });
        toast('汇率已保存', 'ok');
        loadRates();
      } catch (e) { toast(e.message, 'err'); }
      break;
    }
    case 'snapshot:create': {
      const desc = document.getElementById('snap-desc').value;
      await mut(() => call('snapshot:create', { trigger: 'manual', description: desc }));
      loadSnapshots();
      break;
    }
    case 'snapshot:restore': {
      if (!confirm('确定要恢复到此版本吗?恢复后当前数据将被该备份时点的数据替换(系统会自动先备份当前状态)。')) break;
      await mut(() => call('snapshot:restore', id));
      toast('已回滚到所选版本', 'ok');
      await refreshAccounts();
      loadSnapshots();
      break;
    }
  }
}

async function mut(fn) {
  try {
    await fn();
    toast('操作成功', 'ok');
    if (state.nav === 'vouchers') await loadVoucherList();
    if (state.nav === 'audit') await loadAudit();
    if (state.nav === 'snapshots') await loadSnapshots();
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function refreshAccounts() {
  state.accounts = await call('account:list');
}

async function afterView(key) {
  try {
    switch (key) {
      case 'vouchers': await loadVoucherList(); break;
      case 'trial': await loadTrial(); break;
      case 'ledger': await loadLedger(); break;
      case 'reports': await loadReports(); break;
      case 'opening': await loadOpening(); break;
      case 'rates': await loadRates(); break;
      case 'audit': await loadAudit(); break;
      case 'snapshots': await loadSnapshots(); break;
    }
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ============ 事件委托 ============ */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  e.preventDefault();
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  const arg = btn.dataset.arg;
  handleAction(action, id, arg).catch(err => toast(err.message, 'err'));
});

document.addEventListener('input', (e) => {
  if (e.target.classList.contains('amount') || e.target.classList.contains('e-rate')) recalcTotals();
});

document.addEventListener('change', (e) => {
  if (e.target.classList.contains('e-currency')) {
    const tr = e.target.closest('tr');
    const rateInput = tr.querySelector('.e-rate');
    if (e.target.value === baseCurrency()) { rateInput.disabled = true; rateInput.value = ''; }
    else rateInput.disabled = false;
    recalcTotals();
  }
});

/* ============ 启动 ============ */
(async function init() {
  try {
    const d = await call('app:init');
    state.users = d.users;
    state.standards = d.standards;
    state.currencies = d.currencies;
    state.ledger = d.ledger;
    if (d.hasLedger) await refreshAccounts();
    renderLogin();
  } catch (e) {
    render(`<div class="login-wrap"><div class="login-card"><h1>启动失败</h1><p class="err">${esc(e.message)}</p></div></div>`);
  }
})();
