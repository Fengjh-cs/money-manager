'use strict';

/* ============ 全局状态 ============ */
const state = {
  user: null,
  loginUser: null,
  ledger: null,
  users: [],
  standards: [],
  currencies: [],
  accounts: [],
  nav: 'vouchers',
  voucherPeriod: currentPeriod(),
  voucherStatus: '',
  lastTrial: null,
  lastReports: null,
  lastLedger: null,
  lastGl: null,
  auxItems: [],
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

/* ---------- 导出 CSV / 打印 ---------- */
function csvCell(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function buildCSV(headers, rows) {
  return [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
}
async function exportCSV(defaultName, headers, rows) {
  const content = buildCSV(headers, rows);
  const res = await call('export:csv', { filename: defaultName, content });
  if (res.canceled) return;
  toast('已导出:' + res.path, 'ok');
}
function printHTML(html) {
  return call('print:html', { html }).then(() => toast('已发送到打印机', 'ok')).catch(e => toast(e.message, 'err'));
}
function printTableHtml(title, subtitle, headers, rows) {
  const head = headers.map(h => `<th>${esc(h)}</th>`).join('');
  const body = rows.map(r => `<tr>${r.map(c => `<td class="num">${esc(c)}</td>`).join('')}</tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>body{font-family:'Microsoft YaHei',sans-serif;padding:24px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #000;padding:5px 8px}th{background:#f2f2f2}h1{font-size:18px;text-align:center;margin:0 0 4px}.sub{text-align:center;color:#555;font-size:12px;margin-bottom:14px}</style></head>
  <body><h1>${esc(title)}</h1><div class="sub">${esc(subtitle || '')}</div><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}
function printVoucherHtml(v) {
  const rows = v.entries.map(e => `<tr>
    <td>${esc(e.summary)}</td><td>${esc(e.account_code)} ${esc(e.account_name)}</td>
    <td class="num">${e.debit ? fmt(centsToStr(e.debit, e.currency_code)) : ''}</td>
    <td class="num">${e.credit ? fmt(centsToStr(e.credit, e.currency_code)) : ''}</td></tr>`).join('');
  const totD = v.entries.reduce((a, e) => a + (e.debit || 0), 0);
  const totC = v.entries.reduce((a, e) => a + (e.credit || 0), 0);
  return `<!doctype html><html><head><meta charset="utf-8"><title>记账凭证</title>
  <style>body{font-family:'Microsoft YaHei',sans-serif;padding:30px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #000;padding:7px 9px}th{background:#f2f2f2}.num{text-align:right}h1{text-align:center;font-size:20px;margin:0 0 14px}.meta{margin-bottom:14px;font-size:13px}.meta span{margin-right:18px}</style></head>
  <body><h1>记账凭证</h1>
  <div class="meta"><span>凭证号:${esc(v.voucher_no)}</span><span>日期:${esc(v.voucher_date)}</span><span>类型:${esc(v.voucher_type)}</span><span>附件:${v.attachment_count} 张</span></div>
  <table><thead><tr><th>摘要</th><th>科目</th><th>借方金额</th><th>贷方金额</th></tr></thead><tbody>${rows}
  <tr><th>合计</th><th></th><th class="num">${fmt(centsToStr(totD, baseCurrency()))}</th><th class="num">${fmt(centsToStr(totC, baseCurrency()))}</th></tr></tbody></table>
  <div class="meta" style="margin-top:20px"><span>制单:${esc(v.maker)}</span><span>审核:${esc(v.reviewer || '')}</span></div></body></html>`;
}
function reportPrintHtml(period, bs, inc) {
  const rowsHtml = (arr) => arr.map(x => `<tr><td>${esc(x.code)}</td><td>${esc(x.name)}</td><td class="num">${fmt(x.balance)}</td></tr>`).join('');
  const incHtml = inc.rows.filter(r => r.net !== '0.00').map(x => `<tr><td>${esc(x.code)}</td><td>${esc(x.name)}</td><td class="num">${fmt(x.net)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>财务报表</title>
  <style>body{font-family:'Microsoft YaHei',sans-serif;padding:24px}table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px}th,td{border:1px solid #000;padding:5px 8px}th{background:#f2f2f2}.num{text-align:right}h1{font-size:18px;text-align:center}h2{font-size:14px;margin:16px 0 6px}.total{margin:4px 0 12px;font-weight:600}</style></head>
  <body><h1>财务报表(${esc(period)})</h1>
  <h2>资产负债表 — 资产</h2><table><thead><tr><th>科目</th><th>名称</th><th>余额</th></tr></thead><tbody>${rowsHtml(bs.assets)}</tbody></table><div class="total">资产合计:${fmt(bs.asset_total)}</div>
  <h2>资产负债表 — 负债</h2><table><thead><tr><th>科目</th><th>名称</th><th>余额</th></tr></thead><tbody>${rowsHtml(bs.liabilities)}</tbody></table><div class="total">负债合计:${fmt(bs.liability_total)}</div>
  <h2>资产负债表 — 所有者权益</h2><table><thead><tr><th>科目</th><th>名称</th><th>余额</th></tr></thead><tbody>${rowsHtml(bs.equities)}</tbody></table><div class="total">权益合计:${fmt(bs.equity_total)}(其中本年利润 ${fmt(bs.retained_profit)})</div>
  <h2>利润表</h2><table><thead><tr><th>科目</th><th>名称</th><th>金额</th></tr></thead><tbody>${incHtml}</tbody></table><div class="total">收入 ${fmt(inc.revenue)} - 费用 ${fmt(inc.expense)} = 净利润 ${fmt(inc.profit)}</div>
  </body></html>`;
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

const AUX_LABELS = { customer: '客户', supplier: '供应商', department: '部门', project: '项目' };

/* ============ 渲染入口 ============ */
const appEl = () => document.getElementById('app');

function render(html) {
  appEl().innerHTML = html;
}

/* ---------- 登录 ---------- */
function renderLogin() {
  const buttons = state.users.map(u => `
    <button class="role-btn ${state.loginUser === u.username ? 'selected' : ''}" data-action="login:select" data-arg="${esc(u.username)}">
      <span class="icon">${u.role === 'accountant' ? '📒' : '🔍'}</span>
      ${esc(u.username)}
      <div class="desc">${u.role === 'accountant' ? '录入、审核、记账、结账' : '只读查看、审计追踪'}</div>
    </button>`).join('');
  render(`
    <div class="login-wrap">
      <div class="login-card">
        <h1>记账程序</h1>
        <div class="sub">选择身份并输入密码登录</div>
        <div class="role-btns">${buttons}</div>
        <input type="password" id="login-password" placeholder="请输入密码" style="width:100%;margin:14px 0 10px">
        <button class="primary" data-action="login:submit" style="width:100%">登录</button>
        <p class="hint" style="margin-top:10px">首次登录默认密码:123456,登录后请在侧边栏「修改密码」</p>
      </div>
    </div>`);
}

/* ---------- 建账向导 ---------- */
function renderSetup() {
  const standards = state.standards.map((s, i) => `
    <label><input type="radio" name="standard" value="${esc(s)}" ${i === 0 ? 'checked' : ''}>${esc(s)}</label>`).join('');
  const isNew = !!state.ledger; // 已有账套 → 属于「新建额外账套」
  render(`
    <div class="setup-wrap">
      <div class="setup-card">
        <h1>${isNew ? '新建账套' : '建账向导'}</h1>
        <p class="hint">${isNew ? '填写以下信息建立新账套。' : '首次使用,请填写以下信息建立账套。启用期间一般为开始记账的月份。'}</p>
        <div class="form-row"><label>公司名称</label><input id="setup-name" placeholder="例如:XX科技有限公司"></div>
        <div class="form-row"><label>会计准则</label><div class="radio-group">${standards}</div></div>
        <div class="form-row"><label>启用期间(年月)</label><input id="setup-period" type="month" value="${currentPeriod()}"></div>
        <div class="form-row"><label>本位币</label>
          <select id="setup-currency">${state.currencies.map(c => `<option value="${esc(c.code)}" ${c.code === 'CNY' ? 'selected' : ''}>${esc(c.name)}(${c.code})</option>`).join('')}</select>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:8px">
          ${isNew ? '<button data-action="setup:cancel">返回</button>' : ''}
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
  { key: 'gl', label: '总账' },
  { key: 'reports', label: '财务报表' },
  { key: 'cashflow', label: '现金流量表' },
  { key: 'closing', label: '期末处理' },
  { key: 'opening', label: '期初余额' },
  { key: 'accounts', label: '科目管理' },
  { key: 'aux', label: '辅助核算' },
  { key: 'rates', label: '汇率设置' },
  { key: 'audit', label: '审计日志' },
  { key: 'snapshots', label: '备份与回滚' },
  { key: 'ledgers', label: '账套管理' },
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
          <button class="link" data-action="password:open" style="color:#8fb0e0;margin-top:6px">修改密码</button>
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
    case 'gl': return glHtml();
    case 'reports': return reportsHtml();
    case 'cashflow': return cashflowHtml();
    case 'closing': return closingHtml();
    case 'opening': return openingHtml();
    case 'accounts': return accountsHtml();
    case 'aux': return auxHtml();
    case 'rates': return ratesHtml();
    case 'audit': return auditHtml();
    case 'snapshots': return snapshotsHtml();
    case 'ledgers': return ledgersHtml();
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
  b += `<button class="link" data-action="voucher:print" data-id="${esc(v.id)}">打印</button>`;
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
function auxOptions(selected) {
  return `<option value="">(无)</option>` + (state.auxItems || []).map(a => `<option value="${esc(a.id)}" ${a.id === selected ? 'selected' : ''}>${AUX_LABELS[a.type] || a.type}:${esc(a.name)}</option>`).join('');
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
    entries = v.entries.map(e => ({ summary: e.summary, account_id: e.account_id, currency_code: e.currency_code, rate: rateStr(e.exchange_rate_scaled), debit: e.currency_code === baseCurrency() ? centsToStr(e.debit, e.currency_code) : centsToStr(e.debit_foreign, e.currency_code), credit: e.currency_code === baseCurrency() ? centsToStr(e.credit, e.currency_code) : centsToStr(e.credit_foreign, e.currency_code), aux_item_id: e.aux_item_id || '' }));
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
      <thead><tr><th style="width:24%">摘要</th><th>科目</th><th style="width:90px">币种</th><th style="width:90px">汇率</th><th style="width:90px">辅助核算</th><th style="width:110px">借方金额</th><th style="width:110px">贷方金额</th><th></th></tr></thead>
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
          ${v ? `<button data-action="voucher:print" data-id="${esc(v.id)}">打印</button>` : ''}
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
  return { summary: '', account_id: leafAccounts()[0] ? leafAccounts()[0].id : '', currency_code: baseCurrency(), rate: '', debit: '', credit: '', aux_item_id: '' };
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
      <td><select class="e-aux" ${canEdit ? '' : 'disabled'}>${auxOptions(e.aux_item_id)}</select></td>
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
      aux_item_id: tr.querySelector('.e-aux').value || null,
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
      <button class="primary" data-action="trial:load">查询</button>
      <button data-action="trial:export">导出 CSV</button>
      <button data-action="trial:print">打印</button></div>
      <div id="trial-table"></div>
    </div>`;
}

async function loadTrial() {
  const period = document.getElementById('tb-period').value || currentPeriod();
  const tb = await call('report:trialBalance', period);
  state.lastTrial = { period, tb };
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
        <button data-action="ledger:export">导出 CSV</button>
        <button data-action="ledger:print">打印</button>
      </div>
      <div id="sl-result"></div>
    </div>`;
}

async function loadLedger() {
  const account = document.getElementById('sl-account').value;
  const from = document.getElementById('sl-from').value;
  const to = document.getElementById('sl-to').value;
  const res = await call('report:subsidiaryLedger', { account_id: account, from, to });
  state.lastLedger = { account, from, to, res };
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

/* ---------- 总账 ---------- */
function glHtml() {
  const opts = leafAccounts().map(a => `<option value="${esc(a.id)}">${esc(a.code)} ${esc(a.name)}</option>`).join('');
  return `
    <div class="page-head"><h1>总账</h1></div>
    <div class="panel">
      <div class="toolbar">
        <label>科目</label><select id="gl-account">${opts}</select>
        <label>从</label><input id="gl-from" type="month" value="${state.voucherPeriod || currentPeriod()}" style="width:150px">
        <label>到</label><input id="gl-to" type="month" value="${state.voucherPeriod || currentPeriod()}" style="width:150px">
        <button class="primary" data-action="gl:load">查询</button>
        <button data-action="gl:export">导出 CSV</button>
        <button data-action="gl:print">打印</button>
      </div>
      <div id="gl-result"></div>
    </div>`;
}

async function loadGl() {
  const account = document.getElementById('gl-account').value;
  const from = document.getElementById('gl-from').value;
  const to = document.getElementById('gl-to').value;
  const res = await call('report:generalLedger', { account_id: account, from, to });
  state.lastGl = { account, from, to, res };
  const months = res.months.map(m => `<tr><td>${esc(m.period)}</td><td class="num">${fmt(m.debit)}</td><td class="num">${fmt(m.credit)}</td></tr>`).join('');
  document.getElementById('gl-result').innerHTML = `
    <div style="margin:8px 0">科目:${esc(res.account.code)} ${esc(res.account.name)}</div>
    ${months ? `<table class="grid"><thead><tr><th>期间</th><th>借方合计</th><th>贷方合计</th></tr></thead><tbody>${months}</tbody></table>` : '<div class="empty">该区间无发生额</div>'}`;
}

/* ---------- 期末处理 ---------- */
function closingHtml() {
  return `
    <div class="page-head"><h1>期末处理</h1></div>
    <div class="panel">
      <div class="toolbar">
        <label>期间</label><input id="cl-period" type="month" value="${state.voucherPeriod || currentPeriod()}" style="width:150px">
        ${isAccountant() ? `
        <button class="primary" data-action="closing:carryForward">结转损益</button>
        <button class="primary" data-action="closing:close">结账</button>
        <button data-action="closing:unclose">反结账</button>` : '<span class="hint">审计角色为只读</span>'}
      </div>
      <p class="hint">期末流程:①「结转损益」生成结转凭证(草稿),请到「凭证管理」审核并记账 → ②「结账」锁定该期间。结账后该期间不能再修改。</p>
      <div id="cl-list"></div>
    </div>`;
}

async function loadClosing() {
  const list = await call('period:list');
  const rows = list.map(p => `<tr><td>${esc(p.period)}</td><td>${p.status === 'closed' ? '<span class="badge posted">已结账</span>' : '<span class="badge draft">开启</span>'}</td></tr>`).join('');
  document.getElementById('cl-list').innerHTML = rows
    ? `<table class="grid"><thead><tr><th>期间</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<div class="empty">暂无期间记录</div>';
}

/* ---------- 财务报表 ---------- */
function reportsHtml() {
  return `
    <div class="page-head"><h1>财务报表</h1></div>
    <div class="panel">
      <div class="toolbar"><label>期间</label><input id="rp-period" type="month" value="${state.voucherPeriod || currentPeriod()}">
      <button class="primary" data-action="reports:load">查询</button>
      <button data-action="reports:print">打印</button></div>
      <div id="reports-body"></div>
    </div>`;
}

async function loadReports() {
  const period = document.getElementById('rp-period').value || currentPeriod();
  const bs = await call('report:balanceSheet', period);
  const inc = await call('report:incomeStatement', period);
  state.lastReports = { period, bs, inc };
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

/* ---------- 现金流量表 ---------- */
function cashflowHtml() {
  return `
    <div class="page-head"><h1>现金流量表</h1></div>
    <div class="panel">
      <div class="toolbar"><label>期间</label><input id="cf-period" type="month" value="${state.voucherPeriod || currentPeriod()}">
      <button class="primary" data-action="cashflow:load">查询</button></div>
      <div id="cf-result"></div>
      <p class="hint" style="margin-top:12px">简化直接法:按涉及现金/银行科目的收付分类为经营/投资/筹资活动。</p>
    </div>`;
}

async function loadCashflow() {
  const period = document.getElementById('cf-period').value || currentPeriod();
  const cf = await call('report:cashFlow', period);
  const groupRow = (label, g) => `
    <tr><td>${label}流入</td><td class="num">${fmt(g.inflow)}</td><td class="num"></td></tr>
    <tr><td>${label}流出</td><td class="num"></td><td class="num">${fmt(g.outflow)}</td></tr>
    <tr class="totals"><td>${label}净额</td><td colspan="2" class="num">${fmt(g.net)}</td></tr>`;
  document.getElementById('cf-result').innerHTML = `
    <table class="grid"><thead><tr><th>项目</th><th>流入</th><th>流出</th></tr></thead><tbody>
    ${groupRow('经营活动', cf.operating)}
    ${groupRow('投资活动', cf.investing)}
    ${groupRow('筹资活动', cf.financing)}
    <tr class="totals"><td>现金及现金等价物净增加额</td><td colspan="2" class="num">${fmt(cf.net_increase)}</td></tr>
    </tbody></table>`;
}

/* ---------- 科目管理 ---------- */
function accountsHtml() {
  return `
    <div class="page-head"><h1>科目管理</h1>
      <button class="primary" data-action="account:new" ${isAccountant() ? '' : 'hidden'}>+ 新增科目</button>
    </div>
    <div class="panel"><div id="account-list"></div></div>`;
}

async function loadAccounts() {
  state.accounts = await call('account:list');
  const rows = state.accounts.map(a => `<tr>
    <td>${esc(a.code)}</td><td>${esc(a.name)}</td><td>${esc(a.category_label || a.category)}</td>
    <td>${a.direction === 'debit' ? '借方' : '贷方'}</td>
    <td>${a.is_leaf ? '末级' : '非末级'}</td>
  </tr>`).join('');
  document.getElementById('account-list').innerHTML = `<table class="grid"><thead><tr><th>编码</th><th>名称</th><th>类别</th><th>方向</th><th>级次</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderAccountModal() {
  const parentOpts = `<option value="">(无,顶级科目)</option>` + state.accounts.filter(a => !a.is_leaf).map(a => `<option value="${esc(a.id)}">${esc(a.code)} ${esc(a.name)}</option>`).join('');
  render(`
    <div class="modal-mask"><div class="modal">
      <h2>新增科目</h2>
      <div class="form-row"><label>科目编码(4位以上数字)</label><input id="ac-code" placeholder="如 660201"></div>
      <div class="form-row"><label>科目名称</label><input id="ac-name"></div>
      <div class="form-row"><label>类别</label><select id="ac-cat">
        <option value="asset">资产</option><option value="liability">负债</option><option value="equity">所有者权益</option><option value="cost">成本</option><option value="pl">损益</option><option value="common">共同</option>
      </select></div>
      <div class="form-row"><label>余额方向</label><select id="ac-dir"><option value="debit">借方</option><option value="credit">贷方</option></select></div>
      <div class="form-row"><label>上级科目(可选)</label><select id="ac-parent">${parentOpts}</select></div>
      <div class="actions">
        <button class="primary" data-action="account:save">保存</button>
        <button data-action="modal:close">取消</button>
      </div>
    </div></div>`);
}

/* ---------- 辅助核算 ---------- */
function auxHtml() {
  return `
    <div class="page-head"><h1>辅助核算</h1>
      <button class="primary" data-action="aux:new" ${isAccountant() ? '' : 'hidden'}>+ 新增对象</button>
    </div>
    <div class="panel">
      <div class="section-title">辅助核算对象(往来单位/部门/项目)</div>
      <div id="aux-list"></div>
    </div>
    <div class="panel">
      <div class="section-title">按辅助对象查明细</div>
      <div class="toolbar">
        <label>对象</label><select id="ax-item"></select>
        <label>从</label><input id="ax-from" type="month" value="${state.voucherPeriod || currentPeriod()}" style="width:150px">
        <label>到</label><input id="ax-to" type="month" value="${state.voucherPeriod || currentPeriod()}" style="width:150px">
        <button class="primary" data-action="aux:query">查询</button>
      </div>
      <div id="aux-result"></div>
    </div>`;
}

async function loadAux() {
  state.auxItems = await call('aux:list', null);
  const rows = state.auxItems.map(a => `<tr>
    <td>${AUX_LABELS[a.type] || a.type}</td><td>${esc(a.code)}</td><td>${esc(a.name)}</td>
    <td>${isAccountant() ? `<button class="link danger" data-action="aux:delete" data-id="${esc(a.id)}">删除</button>` : ''}</td>
  </tr>`).join('');
  document.getElementById('aux-list').innerHTML = rows
    ? `<table class="grid"><thead><tr><th>类型</th><th>编码</th><th>名称</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<div class="empty">暂无辅助核算对象</div>';
  document.getElementById('ax-item').innerHTML = `<option value="">(请选择)</option>` + state.auxItems.map(a => `<option value="${esc(a.id)}">${AUX_LABELS[a.type] || a.type}:${esc(a.name)}</option>`).join('');
}

function renderPasswordModal() {
  render(`
    <div class="modal-mask"><div class="modal">
      <h2>修改密码(${esc(state.user ? state.user.username : '')})</h2>
      <div class="form-row"><label>原密码</label><input type="password" id="pw-old"></div>
      <div class="form-row"><label>新密码(至少 4 位)</label><input type="password" id="pw-new"></div>
      <div class="form-row"><label>确认新密码</label><input type="password" id="pw-new2"></div>
      <div class="actions">
        <button class="primary" data-action="password:submit">保存</button>
        <button data-action="modal:close">取消</button>
      </div>
    </div></div>`);
}

function renderAuxModal() {
  const typeOpts = Object.entries(AUX_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  render(`
    <div class="modal-mask"><div class="modal">
      <h2>新增辅助核算对象</h2>
      <div class="form-row"><label>类型</label><select id="aux-type">${typeOpts}</select></div>
      <div class="form-row"><label>编码</label><input id="aux-code" placeholder="如 KH001"></div>
      <div class="form-row"><label>名称</label><input id="aux-name" placeholder="如 甲公司"></div>
      <div class="actions">
        <button class="primary" data-action="aux:save">保存</button>
        <button data-action="modal:close">取消</button>
      </div>
    </div></div>`);
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

/* ---------- 账套管理 ---------- */
function ledgersHtml() {
  return `
    <div class="page-head"><h1>账套管理</h1>
      <button class="primary" data-action="ledger:new" ${isAccountant() ? '' : 'hidden'}>+ 新建账套</button>
    </div>
    <div class="panel"><div id="ledger-list"></div></div>`;
}

async function loadLedgers() {
  const list = await call('ledger:list');
  const cur = state.ledger ? state.ledger.id : null;
  const rows = list.map(l => `<tr>
    <td>${esc(l.name)}</td><td>${esc(l.company_name)}</td><td>${esc(l.accounting_standard)}</td><td>${esc(l.base_currency)}</td>
    <td>${l.id === cur ? '<span class="badge posted">当前</span>' : ''}</td>
    <td>${l.id !== cur ? `<button class="link" data-action="ledger:switch" data-id="${esc(l.id)}">切换</button>` : ''}</td>
  </tr>`).join('');
  document.getElementById('ledger-list').innerHTML = rows
    ? `<table class="grid"><thead><tr><th>账套名</th><th>公司</th><th>准则</th><th>本位币</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<div class="empty">暂无账套</div>';
}

/* ============ 动作处理 ============ */
async function handleAction(action, id, arg) {
  switch (action) {
    case 'login:select': {
      state.loginUser = arg;
      renderLogin();
      break;
    }
    case 'login:submit': {
      if (!state.loginUser) { toast('请先选择身份', 'err'); break; }
      const password = document.getElementById('login-password').value;
      if (!password) { toast('请输入密码', 'err'); break; }
      try {
        const r = await call('login', { username: state.loginUser, password });
        state.user = r.user;
        state.ledger = r.ledger;
        state.loginUser = null;
        if (r.hasLedger) { await refreshAccounts(); renderApp(); }
        else renderSetup();
      } catch (e) { toast(e.message, 'err'); }
      break;
    }
    case 'password:open': renderPasswordModal(); break;
    case 'password:submit': {
      const oldPassword = document.getElementById('pw-old').value;
      const newPassword = document.getElementById('pw-new').value;
      const newPassword2 = document.getElementById('pw-new2').value;
      if (newPassword !== newPassword2) { toast('两次输入的新密码不一致', 'err'); break; }
      try {
        await call('password:change', { username: state.user.username, oldPassword, newPassword });
        toast('密码已修改', 'ok');
        renderApp();
      } catch (e) { toast(e.message, 'err'); }
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
    case 'setup:cancel': renderApp(); break;
    case 'ledger:new': renderSetup(); break;
    case 'account:new': renderAccountModal(); break;
    case 'aux:new': renderAuxModal(); break;
    case 'aux:save': {
      const type = document.getElementById('aux-type').value;
      const code = document.getElementById('aux-code').value.trim();
      const name = document.getElementById('aux-name').value.trim();
      try {
        await call('aux:add', { type, code, name });
        toast('已新增', 'ok');
        state.nav = 'aux';
        renderApp();
      } catch (e) { toast(e.message, 'err'); }
      break;
    }
    case 'aux:delete': {
      if (!confirm('确定删除该辅助核算对象吗?')) break;
      try { await call('aux:delete', id); toast('已删除', 'ok'); loadAux(); } catch (e) { toast(e.message, 'err'); }
      break;
    }
    case 'aux:query': {
      const aux_item_id = document.getElementById('ax-item').value;
      if (!aux_item_id) { toast('请选择辅助核算对象', 'err'); break; }
      const from = document.getElementById('ax-from').value;
      const to = document.getElementById('ax-to').value;
      const res = await call('aux:ledger', { aux_item_id, from, to });
      const lines = res.lines.map(l => `<tr>
        <td>${esc(l.voucher_date)}</td><td>${esc(l.voucher_no)}</td><td>${esc(l.summary)}</td><td>${esc(l.account_code)} ${esc(l.account_name)}</td>
        <td class="num">${fmt(l.debit)}</td><td class="num">${fmt(l.credit)}</td>
      </tr>`).join('');
      document.getElementById('aux-result').innerHTML = lines
        ? `<table class="grid"><thead><tr><th>日期</th><th>凭证号</th><th>摘要</th><th>科目</th><th>借方</th><th>贷方</th></tr></thead><tbody>${lines}</tbody></table>`
        : '<div class="empty">该对象该区间无发生额</div>';
      break;
    }
    case 'account:save': {
      const code = document.getElementById('ac-code').value.trim();
      const name = document.getElementById('ac-name').value.trim();
      const category = document.getElementById('ac-cat').value;
      const direction = document.getElementById('ac-dir').value;
      const parent_id = document.getElementById('ac-parent').value || null;
      try {
        await call('account:add', { code, name, category, direction, parent_id });
        toast('科目已新增', 'ok');
        state.nav = 'accounts';
        renderApp();
      } catch (e) { toast(e.message, 'err'); }
      break;
    }
    case 'ledger:switch': {
      try {
        state.ledger = await call('ledger:switch', id);
        await refreshAccounts();
        toast(`已切换到账套「${state.ledger.name}」`, 'ok');
        loadLedgers();
      } catch (e) { toast(e.message, 'err'); }
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
    case 'voucher:print': {
      const v = await call('voucher:get', id);
      await printHTML(printVoucherHtml(v));
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
        <td><select class="e-aux">${auxOptions()}</select></td>
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
    case 'trial:export': {
      const d = state.lastTrial;
      if (!d) { toast('请先查询', 'err'); break; }
      const headers = ['科目编码', '科目名称', '期初借方', '期初贷方', '本期借方', '本期贷方', '期末借方', '期末贷方'];
      const rows = d.tb.rows.map(r => [r.code, r.name, r.opening_debit, r.opening_credit, r.period_debit, r.period_credit, r.ending_debit, r.ending_credit]);
      rows.push(['合计', '', d.tb.total.opening_debit, d.tb.total.opening_credit, d.tb.total.period_debit, d.tb.total.period_credit, d.tb.total.ending_debit, d.tb.total.ending_credit]);
      await exportCSV(`试算平衡表-${d.period}.csv`, headers, rows);
      break;
    }
    case 'trial:print': {
      const d = state.lastTrial;
      if (!d) { toast('请先查询', 'err'); break; }
      const headers = ['科目编码', '科目名称', '期初借方', '期初贷方', '本期借方', '本期贷方', '期末借方', '期末贷方'];
      const rows = d.tb.rows.map(r => [r.code, r.name, r.opening_debit, r.opening_credit, r.period_debit, r.period_credit, r.ending_debit, r.ending_credit]);
      rows.push(['合计', '', d.tb.total.opening_debit, d.tb.total.opening_credit, d.tb.total.period_debit, d.tb.total.period_credit, d.tb.total.ending_debit, d.tb.total.ending_credit]);
      await printHTML(printTableHtml('试算平衡表', d.period, headers, rows));
      break;
    }
    case 'ledger:load': loadLedger(); break;
    case 'ledger:export': {
      const d = state.lastLedger;
      if (!d) { toast('请先查询', 'err'); break; }
      const headers = ['日期', '凭证号', '摘要', '借方', '贷方', '余额'];
      const rows = d.res.lines.map(l => [l.voucher_date, l.voucher_no, l.summary, l.debit, l.credit, (l.balance_debit !== '0.00' ? '借 ' + l.balance_debit : (l.balance_credit !== '0.00' ? '贷 ' + l.balance_credit : '0.00'))]);
      await exportCSV(`明细账-${d.res.account.code}-${d.from}至${d.to}.csv`, headers, rows);
      break;
    }
    case 'ledger:print': {
      const d = state.lastLedger;
      if (!d) { toast('请先查询', 'err'); break; }
      const headers = ['日期', '凭证号', '摘要', '借方', '贷方', '余额'];
      const rows = d.res.lines.map(l => [l.voucher_date, l.voucher_no, l.summary, l.debit, l.credit, (l.balance_debit !== '0.00' ? '借 ' + l.balance_debit : (l.balance_credit !== '0.00' ? '贷 ' + l.balance_credit : '0.00'))]);
      await printHTML(printTableHtml(`明细账 - ${d.res.account.code} ${d.res.account.name}`, `${d.from} 至 ${d.to}`, headers, rows));
      break;
    }
    case 'gl:load': loadGl(); break;
    case 'gl:export': {
      const d = state.lastGl;
      if (!d) { toast('请先查询', 'err'); break; }
      const headers = ['期间', '借方合计', '贷方合计'];
      const rows = d.res.months.map(m => [m.period, m.debit, m.credit]);
      await exportCSV(`总账-${d.res.account.code}-${d.from}至${d.to}.csv`, headers, rows);
      break;
    }
    case 'gl:print': {
      const d = state.lastGl;
      if (!d) { toast('请先查询', 'err'); break; }
      const headers = ['期间', '借方合计', '贷方合计'];
      const rows = d.res.months.map(m => [m.period, m.debit, m.credit]);
      await printHTML(printTableHtml(`总账 - ${d.res.account.code} ${d.res.account.name}`, `${d.from} 至 ${d.to}`, headers, rows));
      break;
    }
    case 'reports:load': loadReports(); break;
    case 'cashflow:load': loadCashflow(); break;
    case 'reports:print': {
      const d = state.lastReports;
      if (!d) { toast('请先查询', 'err'); break; }
      await printHTML(reportPrintHtml(d.period, d.bs, d.inc));
      break;
    }
    case 'closing:carryForward': {
      const period = document.getElementById('cl-period').value;
      if (!confirm(`确定对期间 ${period} 执行「结转损益」吗?系统将生成一张结转凭证(草稿)。`)) break;
      try {
        const v = await call('period:carryForward', period);
        toast(`已生成结转凭证 ${v.voucher_no},请到「凭证管理」审核并记账`, 'ok');
        loadClosing();
      } catch (e) { toast(e.message, 'err'); }
      break;
    }
    case 'closing:close': {
      const period = document.getElementById('cl-period').value;
      if (!confirm(`确定结账期间 ${period} 吗?结账后该期间不能再修改凭证。`)) break;
      try { await call('period:close', period); toast('已结账', 'ok'); loadClosing(); } catch (e) { toast(e.message, 'err'); }
      break;
    }
    case 'closing:unclose': {
      const period = document.getElementById('cl-period').value;
      if (!confirm(`确定反结账期间 ${period} 吗?`)) break;
      try { await call('period:unclose', period); toast('已反结账', 'ok'); loadClosing(); } catch (e) { toast(e.message, 'err'); }
      break;
    }
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
  try { state.auxItems = await call('aux:list', null); } catch (e) { state.auxItems = []; }
}

async function afterView(key) {
  try {
    switch (key) {
      case 'vouchers': await loadVoucherList(); break;
      case 'trial': await loadTrial(); break;
      case 'ledger': await loadLedger(); break;
      case 'gl': await loadGl(); break;
      case 'reports': await loadReports(); break;
      case 'cashflow': await loadCashflow(); break;
      case 'closing': await loadClosing(); break;
      case 'opening': await loadOpening(); break;
      case 'accounts': await loadAccounts(); break;
      case 'aux': await loadAux(); break;
      case 'rates': await loadRates(); break;
      case 'audit': await loadAudit(); break;
      case 'snapshots': await loadSnapshots(); break;
      case 'ledgers': await loadLedgers(); break;
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
