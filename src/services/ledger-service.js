'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { charts, currencies, STANDARDS, CATEGORY_LABELS } = require('../db/seed');
const { schema } = require('../db/schema');
const M = require('../money');

const ROLE_LABELS = { accountant: '会计', auditor: '审计' };
const STATUS_LABELS = { draft: '草稿', approved: '已审核', posted: '已记账', voided: '已作废' };
const VOUCHER_TYPES = ['记', '收', '付', '转'];

function uuid() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }
function today() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
function periodOf(date) { return String(date).slice(0, 7); }
function lastDayOfPeriod(period) {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m, 0).getDate();
  return `${period}-${String(d).padStart(2, '0')}`;
}
function toSafeNumber(b) {
  const LIMIT = BigInt(Number.MAX_SAFE_INTEGER);
  if (b > LIMIT || b < -LIMIT) throw new Error('金额超出系统可处理范围');
  return Number(b);
}
function dec(b) { return M.formatAmount(b).replace(/,/g, ''); } // 纯数字字符串(无千分位)

/**
 * 核心服务:会计规则 + 审计日志 + 快照/回滚 + 报表。
 * 所有写操作都要求当前用户为「会计」角色(审计只读)。
 */
class LedgerService {
  constructor(db, dataDir) {
    this.db = db;
    this.dataDir = dataDir;
    this.snapDir = path.join(dataDir, 'snapshots');
    this.user = null;
    this.ledger = null;
    this._seedCurrencies();
    this._loadActiveLedger();
  }

  // ================= 基础 =================
  _seedCurrencies() {
    const n = this.db.get('SELECT COUNT(*) AS c FROM currencies').c;
    if (n === 0) {
      for (const c of currencies) {
        this.db.run('INSERT INTO currencies (code, name, symbol, precision, enabled) VALUES (?,?,?,?,1)',
          [c.code, c.name, c.symbol, c.precision]);
      }
    }
  }

  _loadActiveLedger() {
    const row = this.db.get("SELECT value FROM settings WHERE key='active_ledger_id'");
    if (row && row.value) {
      this.ledger = this.db.get('SELECT * FROM ledgers WHERE id=?', [row.value]);
    }
  }

  _requireAccountant() {
    if (!this.user || this.user.role !== 'accountant') {
      throw new Error('当前角色「审计」为只读权限,不能执行此操作');
    }
  }

  _requirePeriodOpen(period) {
    const p = this.db.get('SELECT * FROM periods WHERE ledger_id=? AND period=?', [this.ledger.id, period]);
    if (p && p.status === 'closed') throw new Error(`会计期间 ${period} 已结账,不能修改`);
  }

  _audit(action, entityType, entityId, oldVal, newVal, note) {
    this.db.run(
      `INSERT INTO audit_logs (ledger_id, user_id, username, role, action, entity_type, entity_id, old_value, new_value, note, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        this.ledger ? this.ledger.id : null,
        this.user ? this.user.id : null,
        this.user ? this.user.username : null,
        this.user ? this.user.role : null,
        action, entityType, entityId,
        oldVal != null ? JSON.stringify(oldVal) : null,
        newVal != null ? JSON.stringify(newVal) : null,
        note != null ? note : null,
        now(),
      ]
    );
  }

  // ================= 用户 / 账套 =================
  listUsers() {
    return this.db.all('SELECT id, username, role FROM users ORDER BY role, username');
  }

  setUser(user) { this.user = user; }

  hasLedger() { return !!this.ledger; }
  getLedger() { return this.ledger; }

  listStandards() { return Object.values(STANDARDS); }

  createLedger(opts) {
    const standard = opts.accounting_standard;
    if (!charts[standard]) throw new Error('未知会计准则(可选:' + Object.values(STANDARDS).join(' / ') + ')');
    const id = 'L' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
    const openingPeriod = opts.opening_period || periodOf(today());
    const t = now();

    this.db.exec('BEGIN');
    try {
      this.db.run(
        `INSERT INTO ledgers (id, name, company_name, tax_no, accounting_standard, base_currency, fiscal_start_month, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [id, opts.name || '默认账套', opts.company_name || '', opts.tax_no || '', standard, opts.base_currency || 'CNY', opts.fiscal_start_month || 1, t]
      );
      for (const a of charts[standard]) {
        this.db.run(
          `INSERT INTO accounts (id, ledger_id, code, name, category, direction, parent_id, is_leaf, is_cash, is_foreign, enabled, sort_order)
           VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`,
          [a.id, id, a.code, a.name, a.category, a.direction, a.parent_id, a.is_leaf, a.is_cash, a.is_foreign, a.sort_order]
        );
      }
      this.db.run(
        `INSERT OR IGNORE INTO users (id, username, password_hash, role, created_at) VALUES (?,?,?,?,?)`,
        [uuid(), '会计', '', 'accountant', t]
      );
      this.db.run(
        `INSERT OR IGNORE INTO users (id, username, password_hash, role, created_at) VALUES (?,?,?,?,?)`,
        [uuid(), '审计', '', 'auditor', t]
      );
      this.db.run('INSERT OR IGNORE INTO periods (ledger_id, period, status) VALUES (?,?,?)', [id, openingPeriod, 'open']);
      this.db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', ['active_ledger_id', id]);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    this._loadActiveLedger();
    this._audit('创建账套', 'ledger', id, null, { name: opts.name, standard }, `准则:${standard}`);
    this.db.save();
    return this.ledger;
  }

  // ================= 科目 / 期初余额 =================
  listAccounts() {
    return this.db.all('SELECT * FROM accounts WHERE ledger_id=? ORDER BY code', [this.ledger.id])
      .map(a => ({ ...a, category_label: CATEGORY_LABELS[a.category] || a.category }));
  }

  addAccount({ code, name, category, direction, parent_id = null }) {
    this._requireAccountant();
    if (!/^\d{4,}$/.test(code)) throw new Error('科目编码至少 4 位数字');
    if (!name || !name.trim()) throw new Error('科目名称不能为空');
    if (!['asset', 'liability', 'equity', 'cost', 'pl', 'common'].includes(category)) throw new Error('类别无效');
    if (!['debit', 'credit'].includes(direction)) throw new Error('方向无效');
    const exists = this.db.get('SELECT id FROM accounts WHERE ledger_id=? AND code=?', [this.ledger.id, code]);
    if (exists) throw new Error(`科目编码 ${code} 已存在`);
    this.db.run(
      `INSERT INTO accounts (id, ledger_id, code, name, category, direction, parent_id, is_leaf, is_cash, is_foreign, enabled, sort_order)
       VALUES (?,?,?,?,?,?,?,1,0,0,1,0)`,
      [code, this.ledger.id, code, name.trim(), category, direction, parent_id]
    );
    this._audit('新增科目', 'account', code, null, { code, name, category, direction });
    this.db.save();
    return { id: code, code, name: name.trim(), category, direction, parent_id };
  }

  setOpeningBalance(accountId, period, amount, currencyCode = null) {
    this._requireAccountant();
    this._requirePeriodOpen(period);
    const acct = this.db.get('SELECT * FROM accounts WHERE ledger_id=? AND id=?', [this.ledger.id, accountId]);
    if (!acct) throw new Error('科目不存在');
    if (!acct.is_leaf) throw new Error(`科目「${acct.name}」不是末级科目,不能录期初余额`);
    const amt = M.parseAmount(amount);
    this.db.run(
      `INSERT OR REPLACE INTO opening_balances (ledger_id, account_id, period, amount, currency_code) VALUES (?,?,?,?,?)`,
      [this.ledger.id, accountId, period, toSafeNumber(amt), currencyCode]
    );
    this._audit('设置期初余额', 'account', accountId, null, { period, amount: dec(amt) });
    this.db.save();
    return { account_id: accountId, period, amount: dec(amt) };
  }

  listOpeningBalances(period) {
    return this.db.all('SELECT * FROM opening_balances WHERE ledger_id=? AND period=?', [this.ledger.id, period]);
  }

  // ================= 汇率 =================
  setExchangeRate(currencyCode, period, rate) {
    this._requireAccountant();
    const rateScaled = M.parseRate(rate);
    if (rateScaled <= 0n) throw new Error('汇率必须大于 0');
    this.db.run(
      `INSERT OR REPLACE INTO exchange_rates (ledger_id, currency_code, base_currency, period, rate_scaled, created_at)
       VALUES (?,?,?,?,?,?)`,
      [this.ledger.id, currencyCode, this.ledger.base_currency, period, toSafeNumber(rateScaled), now()]
    );
    this._audit('设置汇率', 'exchange_rate', `${currencyCode}-${period}`, null, { rate: M.formatRate(rateScaled) });
    this.db.save();
    return { currency_code: currencyCode, period, rate: M.formatRate(rateScaled) };
  }

  listExchangeRates(period) {
    return this.db.all(
      'SELECT * FROM exchange_rates WHERE ledger_id=? AND (? IS NULL OR period=?) ORDER BY currency_code',
      [this.ledger.id, period, period]
    ).map(r => ({ ...r, rate: M.formatRate(r.rate_scaled) }));
  }

  listCurrencies() {
    return this.db.all('SELECT * FROM currencies WHERE enabled=1 ORDER BY code');
  }

  // ================= 凭证 =================
  _normalizeEntries(entries, baseCurrency) {
    if (!Array.isArray(entries) || entries.length < 2) throw new Error('凭证至少需要两条分录');
    const norm = entries.map((e, i) => {
      const line = i + 1;
      const acct = this.db.get('SELECT * FROM accounts WHERE ledger_id=? AND id=?', [this.ledger.id, e.account_id]);
      if (!acct) throw new Error(`第${line}行:科目不存在`);
      if (!acct.is_leaf) throw new Error(`第${line}行:科目「${acct.name}」不是末级科目,不能直接记账`);
      if (!acct.enabled) throw new Error(`第${line}行:科目「${acct.name}」已停用`);
      const summary = (e.summary || '').trim();
      if (!summary) throw new Error(`第${line}行:摘要不能为空`);
      const currencyCode = e.currency_code || baseCurrency;

      if (currencyCode === baseCurrency) {
        const debit = M.parseAmount(e.debit);
        const credit = M.parseAmount(e.credit);
        if (debit < 0n || credit < 0n) throw new Error(`第${line}行:金额不能为负`);
        if (debit > 0n && credit > 0n) throw new Error(`第${line}行:借、贷不能同时填写`);
        if (debit === 0n && credit === 0n) throw new Error(`第${line}行:金额不能为空`);
        return {
          summary, account_id: e.account_id, currency_code: currencyCode,
          exchange_rate_scaled: null, debit_foreign: null, credit_foreign: null,
          debit: toSafeNumber(debit), credit: toSafeNumber(credit),
          _debit: debit, _credit: credit,
        };
      }
      const cur = this.db.get('SELECT * FROM currencies WHERE code=?', [currencyCode]);
      if (!cur) throw new Error(`第${line}行:未知币种 ${currencyCode}`);
      if (!e.exchange_rate) throw new Error(`第${line}行:外币分录必须填写汇率`);
      const rateScaled = M.parseRate(e.exchange_rate);
      if (rateScaled <= 0n) throw new Error(`第${line}行:汇率必须大于 0`);
      const debitF = M.parseAmount(e.debit, cur.precision);
      const creditF = M.parseAmount(e.credit, cur.precision);
      if (debitF < 0n || creditF < 0n) throw new Error(`第${line}行:金额不能为负`);
      if (debitF > 0n && creditF > 0n) throw new Error(`第${line}行:借、贷不能同时填写`);
      if (debitF === 0n && creditF === 0n) throw new Error(`第${line}行:金额不能为空`);
      const debitB = M.convertForeignToBase(debitF, rateScaled);
      const creditB = M.convertForeignToBase(creditF, rateScaled);
      return {
        summary, account_id: e.account_id, currency_code: currencyCode,
        exchange_rate_scaled: toSafeNumber(rateScaled),
        debit_foreign: toSafeNumber(debitF), credit_foreign: toSafeNumber(creditF),
        debit: toSafeNumber(debitB), credit: toSafeNumber(creditB),
        _debit: debitB, _credit: creditB,
      };
    });

    let totalDebit = 0n, totalCredit = 0n;
    for (const e of norm) { totalDebit += e._debit; totalCredit += e._credit; }
    if (totalDebit === 0n && totalCredit === 0n) throw new Error('凭证金额不能全部为零');
    if (totalDebit === 0n || totalCredit === 0n) throw new Error('凭证必须同时包含借方和贷方分录');
    if (totalDebit !== totalCredit) {
      throw new Error(`借贷不平衡:借方合计 ${dec(totalDebit)} ≠ 贷方合计 ${dec(totalCredit)}`);
    }
    return norm.map(({ _debit, _credit, ...rest }) => rest);
  }

  _nextVoucherNo(period, type) {
    const row = this.db.get(
      'SELECT voucher_no FROM vouchers WHERE ledger_id=? AND period=? AND voucher_type=? ORDER BY voucher_no DESC LIMIT 1',
      [this.ledger.id, period, type]
    );
    let seq = 1;
    if (row) {
      const m = String(row.voucher_no).match(/(\d+)$/);
      if (m) seq = parseInt(m[1], 10) + 1;
    }
    return `${type}-${period}-${String(seq).padStart(4, '0')}`;
  }

  createVoucher({ voucher_date, voucher_type = '记', attachment_count = 0, entries, source = null }) {
    this._requireAccountant();
    if (!VOUCHER_TYPES.includes(voucher_type)) throw new Error('凭证类型无效');
    const period = periodOf(voucher_date);
    this._requirePeriodOpen(period);
    const norm = this._normalizeEntries(entries, this.ledger.base_currency);
    const id = uuid();
    const voucherNo = this._nextVoucherNo(period, voucher_type);
    const t = now();

    this.db.exec('BEGIN');
    try {
      this.db.run(
        `INSERT INTO vouchers (id, ledger_id, voucher_no, voucher_date, period, voucher_type, attachment_count, maker, reviewer, status, source, created_at, reviewed_at, posted_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, this.ledger.id, voucherNo, voucher_date, period, voucher_type, attachment_count, this.user.username, null, 'draft', source, t, null, null]
      );
      norm.forEach((e, i) => {
        this.db.run(
          `INSERT INTO voucher_entries (voucher_id, line_no, summary, account_id, currency_code, exchange_rate_scaled, debit_foreign, credit_foreign, debit, credit)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [id, i + 1, e.summary, e.account_id, e.currency_code, e.exchange_rate_scaled, e.debit_foreign, e.credit_foreign, e.debit, e.credit]
        );
      });
      this._audit('创建凭证', 'voucher', id, null, { voucher_no: voucherNo, period, voucher_type, attachment_count, entries: norm }, null);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    this.db.save();
    return this.getVoucher(id);
  }

  getVoucher(id) {
    const v = this.db.get('SELECT * FROM vouchers WHERE id=? AND ledger_id=?', [id, this.ledger.id]);
    if (!v) return null;
    const entries = this.db.all(
      `SELECT e.*, a.code AS account_code, a.name AS account_name
       FROM voucher_entries e JOIN accounts a ON a.ledger_id=? AND a.id=e.account_id
       WHERE e.voucher_id=? ORDER BY e.line_no`,
      [this.ledger.id, id]
    );
    return { ...v, status_label: STATUS_LABELS[v.status], entries };
  }

  listVouchers({ period = null, status = null } = {}) {
    let sql = `SELECT v.*, COUNT(e.id) AS entry_count, SUM(e.debit) AS total_debit
               FROM vouchers v LEFT JOIN voucher_entries e ON e.voucher_id=v.id
               WHERE v.ledger_id=?`;
    const params = [this.ledger.id];
    if (period) { sql += ' AND v.period=?'; params.push(period); }
    if (status) { sql += ' AND v.status=?'; params.push(status); }
    sql += ' GROUP BY v.id ORDER BY v.voucher_date DESC, v.voucher_no DESC';
    return this.db.all(sql, params).map(v => ({
      id: v.id, voucher_no: v.voucher_no, voucher_date: v.voucher_date, period: v.period,
      voucher_type: v.voucher_type, attachment_count: v.attachment_count,
      maker: v.maker, reviewer: v.reviewer, status: v.status, status_label: STATUS_LABELS[v.status],
      entry_count: v.entry_count, total_debit: v.total_debit == null ? '0.00' : dec(v.total_debit),
    }));
  }

  _transition(id, action, guard, apply) {
    const v = this.db.get('SELECT * FROM vouchers WHERE id=? AND ledger_id=?', [id, this.ledger.id]);
    if (!v) throw new Error('凭证不存在');
    const before = v.status;
    guard(v);
    apply(v);
    this._audit(action, 'voucher', id, { status: before }, { status: v.status }, `凭证 ${v.voucher_no}`);
    this.db.save();
    return this.getVoucher(id);
  }

  reviewVoucher(id) {
    this._requireAccountant();
    return this._transition(id, '审核', v => {
      if (v.status !== 'draft') throw new Error('只有草稿状态的凭证才能审核');
      this._requirePeriodOpen(v.period);
      this.db.run('UPDATE vouchers SET status=?, reviewer=?, reviewed_at=? WHERE id=?', ['approved', this.user.username, now(), id]);
    }, () => {});
  }

  unreviewVoucher(id) {
    this._requireAccountant();
    return this._transition(id, '反审核', v => {
      if (v.status !== 'approved') throw new Error('只有已审核状态的凭证才能反审核');
      this._requirePeriodOpen(v.period);
      this.db.run('UPDATE vouchers SET status=?, reviewer=NULL, reviewed_at=NULL WHERE id=?', ['draft', id]);
    }, () => {});
  }

  postVoucher(id) {
    this._requireAccountant();
    return this._transition(id, '记账', v => {
      if (v.status !== 'approved') throw new Error('只有已审核状态的凭证才能记账');
      this._requirePeriodOpen(v.period);
      this.db.run('UPDATE vouchers SET status=?, posted_at=? WHERE id=?', ['posted', now(), id]);
    }, () => {});
  }

  unpostVoucher(id) {
    this._requireAccountant();
    return this._transition(id, '反记账', v => {
      if (v.status !== 'posted') throw new Error('只有已记账状态的凭证才能反记账');
      this._requirePeriodOpen(v.period);
      this.db.run('UPDATE vouchers SET status=?, posted_at=NULL WHERE id=?', ['approved', id]);
    }, () => {});
  }

  voidVoucher(id) {
    this._requireAccountant();
    return this._transition(id, '作废', v => {
      if (v.status === 'posted') throw new Error('已记账凭证不能作废,请使用「冲销」');
      if (v.status === 'voided') throw new Error('凭证已是作废状态');
      this._requirePeriodOpen(v.period);
      this.db.run('UPDATE vouchers SET status=? WHERE id=?', ['voided', id]);
    }, () => {});
  }

  updateVoucher(id, { voucher_date, voucher_type, attachment_count = 0, entries }) {
    this._requireAccountant();
    const v = this.db.get('SELECT * FROM vouchers WHERE id=? AND ledger_id=?', [id, this.ledger.id]);
    if (!v) throw new Error('凭证不存在');
    if (v.status !== 'draft') throw new Error('只有草稿状态的凭证才能修改');
    const period = periodOf(voucher_date);
    this._requirePeriodOpen(period);
    const norm = this._normalizeEntries(entries, this.ledger.base_currency);

    this.db.exec('BEGIN');
    try {
      this.db.run('DELETE FROM voucher_entries WHERE voucher_id=?', [id]);
      this.db.run('UPDATE vouchers SET voucher_date=?, period=?, voucher_type=?, attachment_count=? WHERE id=?',
        [voucher_date, period, voucher_type, attachment_count, id]);
      norm.forEach((e, i) => {
        this.db.run(
          `INSERT INTO voucher_entries (voucher_id, line_no, summary, account_id, currency_code, exchange_rate_scaled, debit_foreign, credit_foreign, debit, credit)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [id, i + 1, e.summary, e.account_id, e.currency_code, e.exchange_rate_scaled, e.debit_foreign, e.credit_foreign, e.debit, e.credit]
        );
      });
      this._audit('修改凭证', 'voucher', id, { voucher_no: v.voucher_no }, { voucher_date, period, voucher_type, entries: norm });
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    this.db.save();
    return this.getVoucher(id);
  }

  reverseVoucher(id) {
    this._requireAccountant();
    const v = this.getVoucher(id);
    if (!v) throw new Error('凭证不存在');
    if (v.status !== 'posted') throw new Error('只能冲销已记账凭证');
    const base = this.ledger.base_currency;
    const entries = v.entries.map(e => {
      if (e.currency_code === base) {
        return {
          summary: `冲销[${v.voucher_no}] ${e.summary}`,
          account_id: e.account_id, currency_code: base,
          debit: M.formatAmount(e.credit).replace(/,/g, ''),
          credit: M.formatAmount(e.debit).replace(/,/g, ''),
        };
      }
      const cur = this.db.get('SELECT * FROM currencies WHERE code=?', [e.currency_code]);
      return {
        summary: `冲销[${v.voucher_no}] ${e.summary}`,
        account_id: e.account_id, currency_code: e.currency_code,
        exchange_rate: M.formatRate(e.exchange_rate_scaled),
        debit: M.formatAmount(e.credit_foreign, cur.precision).replace(/,/g, ''),
        credit: M.formatAmount(e.debit_foreign, cur.precision).replace(/,/g, ''),
      };
    });
    const reversed = this.createVoucher({
      voucher_date: v.voucher_date, voucher_type: v.voucher_type,
      attachment_count: 0, entries, source: v.id,
    });
    this._audit('冲销', 'voucher', reversed.id, null, { source_voucher: v.id, source_no: v.voucher_no });
    this.db.save();
    return reversed;
  }

  // ================= 报表 =================
  _postedEntries() {
    return this.db.all(
      `SELECT e.account_id, e.currency_code, e.debit, e.credit, v.period, v.voucher_date, v.voucher_no, e.line_no, e.summary
       FROM voucher_entries e JOIN vouchers v ON e.voucher_id=v.id
       WHERE v.ledger_id=? AND v.status='posted'
       ORDER BY v.voucher_date, v.voucher_no, e.line_no`,
      [this.ledger.id]
    );
  }

  trialBalance(period) {
    const accounts = this.db.all('SELECT * FROM accounts WHERE ledger_id=? AND enabled=1 ORDER BY code', [this.ledger.id]);
    const opening = new Map();
    for (const o of this.db.all('SELECT * FROM opening_balances WHERE ledger_id=?', [this.ledger.id])) {
      opening.set(o.account_id, M.toBigInt(o.amount));
    }
    const prior = new Map(), curDebit = new Map(), curCredit = new Map();
    for (const r of this._postedEntries()) {
      const d = M.toBigInt(r.debit), c = M.toBigInt(r.credit);
      if (r.period < period) prior.set(r.account_id, (prior.get(r.account_id) || 0n) + d - c);
      else if (r.period === period) {
        curDebit.set(r.account_id, (curDebit.get(r.account_id) || 0n) + d);
        curCredit.set(r.account_id, (curCredit.get(r.account_id) || 0n) + c);
      }
    }
    const rows = accounts.map(a => {
      const openingB = (opening.get(a.id) || 0n) + (prior.get(a.id) || 0n);
      const db_ = curDebit.get(a.id) || 0n;
      const cb = curCredit.get(a.id) || 0n;
      const ending = openingB + db_ - cb;
      return {
        code: a.code, name: a.name, category: a.category, direction: a.direction,
        opening_debit: openingB > 0n ? dec(openingB) : '0.00',
        opening_credit: openingB < 0n ? dec(-openingB) : '0.00',
        period_debit: dec(db_), period_credit: dec(cb),
        ending_debit: ending > 0n ? dec(ending) : '0.00',
        ending_credit: ending < 0n ? dec(-ending) : '0.00',
      };
    });
    // 合计
    const sum = (key) => rows.reduce((acc, r) => acc + M.toBigInt(M.parseAmount(r[key])), 0n);
    const total = {
      opening_debit: dec(sum('opening_debit')), opening_credit: dec(sum('opening_credit')),
      period_debit: dec(sum('period_debit')), period_credit: dec(sum('period_credit')),
      ending_debit: dec(sum('ending_debit')), ending_credit: dec(sum('ending_credit')),
    };
    const balanced = total.ending_debit === total.ending_credit;
    return { period, rows, total, balanced };
  }

  _signedBalances(period) {
    // 返回 {account_id: {opening, period_debit, period_credit, ending}} 均为 BigInt 有符号余额
    const opening = new Map();
    for (const o of this.db.all('SELECT * FROM opening_balances WHERE ledger_id=?', [this.ledger.id])) {
      opening.set(o.account_id, M.toBigInt(o.amount));
    }
    const prior = new Map(), curDebit = new Map(), curCredit = new Map();
    for (const r of this._postedEntries()) {
      const d = M.toBigInt(r.debit), c = M.toBigInt(r.credit);
      if (r.period < period) prior.set(r.account_id, (prior.get(r.account_id) || 0n) + d - c);
      else if (r.period === period) {
        curDebit.set(r.account_id, (curDebit.get(r.account_id) || 0n) + d);
        curCredit.set(r.account_id, (curCredit.get(r.account_id) || 0n) + c);
      }
    }
    const out = {};
    for (const a of this.db.all('SELECT * FROM accounts WHERE ledger_id=?', [this.ledger.id])) {
      const openingB = (opening.get(a.id) || 0n) + (prior.get(a.id) || 0n);
      const db_ = curDebit.get(a.id) || 0n, cb = curCredit.get(a.id) || 0n;
      out[a.id] = { opening: openingB, period_debit: db_, period_credit: cb, ending: openingB + db_ - cb };
    }
    return out;
  }

  subsidiaryLedger(accountId, fromPeriod, toPeriod) {
    const acct = this.db.get('SELECT * FROM accounts WHERE ledger_id=? AND id=?', [this.ledger.id, accountId]);
    if (!acct) throw new Error('科目不存在');
    const rows = this.db.all(
      `SELECT v.period, v.voucher_date, v.voucher_no, e.line_no, e.summary, e.debit, e.credit
       FROM voucher_entries e JOIN vouchers v ON e.voucher_id=v.id
       WHERE v.ledger_id=? AND e.account_id=? AND v.status='posted' AND v.period>=? AND v.period<=?
       ORDER BY v.voucher_date, v.voucher_no, e.line_no`,
      [this.ledger.id, accountId, fromPeriod, toPeriod]
    );
    // 期初:期初余额 + 期初前期间发生额
    const opening = new Map();
    for (const o of this.db.all('SELECT * FROM opening_balances WHERE ledger_id=?', [this.ledger.id])) opening.set(o.account_id, M.toBigInt(o.amount));
    let bal = opening.get(accountId) || 0n;
    for (const r of this._postedEntries()) {
      if (r.account_id === accountId && r.period < fromPeriod) bal += M.toBigInt(r.debit) - M.toBigInt(r.credit);
    }
    const lines = rows.map(r => {
      const d = M.toBigInt(r.debit), c = M.toBigInt(r.credit);
      bal += d - c;
      return {
        voucher_date: r.voucher_date, voucher_no: r.voucher_no, summary: r.summary,
        debit: dec(d), credit: dec(c),
        balance: dec(bal),
        balance_debit: bal > 0n ? dec(bal) : '0.00',
        balance_credit: bal < 0n ? dec(-bal) : '0.00',
      };
    });
    return {
      account: { id: acct.id, code: acct.code, name: acct.name, direction: acct.direction },
      opening_balance: dec(bal - lines.reduce((a, l) => a + M.toBigInt(M.parseAmount(l.debit)) - M.toBigInt(M.parseAmount(l.credit)), 0n)),
      lines,
    };
  }

  generalLedger(accountId, fromPeriod, toPeriod) {
    const acct = this.db.get('SELECT * FROM accounts WHERE ledger_id=? AND id=?', [this.ledger.id, accountId]);
    if (!acct) throw new Error('科目不存在');
    const rows = this.db.all(
      `SELECT v.period, SUM(e.debit) AS debit, SUM(e.credit) AS credit
       FROM voucher_entries e JOIN vouchers v ON e.voucher_id=v.id
       WHERE v.ledger_id=? AND e.account_id=? AND v.status='posted' AND v.period>=? AND v.period<=?
       GROUP BY v.period ORDER BY v.period`,
      [this.ledger.id, accountId, fromPeriod, toPeriod]
    );
    return {
      account: { id: acct.id, code: acct.code, name: acct.name },
      months: rows.map(r => ({
        period: r.period,
        debit: dec(r.debit || 0), credit: dec(r.credit || 0),
      })),
    };
  }

  incomeStatement(period) {
    const b = this._signedBalances(period);
    const rows = [];
    let revenue = 0n, expense = 0n;
    for (const a of this.db.all('SELECT * FROM accounts WHERE ledger_id=? AND category="pl" ORDER BY code', [this.ledger.id])) {
      const s = b[a.id] || { period_debit: 0n, period_credit: 0n };
      const net = s.period_credit - s.period_debit; // 收入为正(贷-借)
      if (a.direction === 'credit') revenue += net;
      else expense += -net; // 费用 = 借-贷
      rows.push({ code: a.code, name: a.name, direction: a.direction, net: dec(net) });
    }
    const profit = revenue - expense;
    return { period, rows, revenue: dec(revenue), expense: dec(expense), profit: dec(profit) };
  }

  balanceSheet(period) {
    const b = this._signedBalances(period);
    const byCat = { asset: [], liability: [], equity: [], cost: [], common: [] };
    for (const a of this.db.all('SELECT * FROM accounts WHERE ledger_id=? ORDER BY code', [this.ledger.id])) {
      const s = b[a.id] || { ending: 0n };
      if (a.category === 'pl') continue; // 损益已并入未分配利润
      byCat[a.category] = byCat[a.category] || [];
      byCat[a.category].push({ code: a.code, name: a.name, balance: dec(s.ending) });
    }
    const sumCat = (arr) => arr.reduce((acc, x) => acc + M.toBigInt(M.parseAmount(x.balance)), 0n);
    // 资产 = 资产类 + 成本类(在产品/存货)+ 共同类
    const assetTotal = sumCat(byCat.asset) + sumCat(byCat.cost) + sumCat(byCat.common);
    const liabilityTotal = -sumCat(byCat.liability);
    const equityBase = -sumCat(byCat.equity);
    // 本年利润(损益净额)= 收入 - 费用
    const pl = this.incomeStatement(period);
    const profit = M.toBigInt(M.parseAmount(pl.profit));
    const equityTotal = equityBase + profit;
    return {
      period,
      assets: [...byCat.asset, ...byCat.cost, ...byCat.common].filter(x => M.toBigInt(M.parseAmount(x.balance)) !== 0n),
      liabilities: byCat.liability.filter(x => M.toBigInt(M.parseAmount(x.balance)) !== 0n),
      equities: byCat.equity.filter(x => M.toBigInt(M.parseAmount(x.balance)) !== 0n),
      asset_total: dec(assetTotal),
      liability_total: dec(liabilityTotal),
      equity_total: dec(equityTotal),
      retained_profit: dec(profit),
      balanced: assetTotal === liabilityTotal + equityTotal,
    };
  }

  // ================= 审计日志 =================
  listAuditLogs(limit = 500) {
    return this.db.all('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?', [limit]);
  }

  // ================= 快照 / 回滚 =================
  createSnapshot(trigger, description) {
    this._requireAccountant();
    fs.mkdirSync(this.snapDir, { recursive: true });
    const id = 'S' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
    const fname = `${trigger}-${now().replace(/[:.]/g, '-')}-${id}.db`;
    const fp = path.join(this.snapDir, fname);
    this.db.saveAs(fp);
    const t = now();
    const snap = { id, ledger_id: this.ledger.id, created_at: t, trigger, description: description || '', file_path: fp, note: '' };
    this.db.run(
      'INSERT INTO snapshots (id, ledger_id, created_at, trigger, description, file_path, note) VALUES (?,?,?,?,?,?,?)',
      [snap.id, snap.ledger_id, snap.created_at, snap.trigger, snap.description, snap.file_path, snap.note]
    );
    this._audit('创建快照', 'snapshot', id, null, { trigger, description, file_path: fp });
    this.db.save();
    return snap;
  }

  listSnapshots() {
    return this.db.all('SELECT * FROM snapshots WHERE ledger_id=? ORDER BY created_at DESC', [this.ledger.id]);
  }

  restoreSnapshot(id) {
    this._requireAccountant();
    const snap = this.db.get('SELECT * FROM snapshots WHERE id=?', [id]);
    if (!snap) throw new Error('快照不存在');
    if (!fs.existsSync(snap.file_path)) throw new Error('快照文件缺失');
    // 1) 先备份当前状态(数据安全)
    const pre = this.createSnapshot('auto-before-restore', `回滚前自动备份(回滚目标: ${snap.description || snap.id})`);
    // 2) 独立于数据库的恢复日志(回滚后仍保留)
    fs.appendFileSync(path.join(this.dataDir, 'restore.log'),
      `${now()}  ${this.user.username}  回滚  ${snap.id}(${snap.description})  恢复前备份=${pre.id}\n`, 'utf8');
    // 3) 载入目标快照
    const buf = fs.readFileSync(snap.file_path);
    this.db.loadFromBuffer(buf);
    for (const stmt of schema) this.db.exec(stmt);
    // 4) 把「恢复前备份」的元数据写回恢复后的库,使其仍可见
    this.db.run(
      'INSERT OR REPLACE INTO snapshots (id, ledger_id, created_at, trigger, description, file_path, note) VALUES (?,?,?,?,?,?,?)',
      [pre.id, pre.ledger_id, pre.created_at, pre.trigger, pre.description, pre.file_path, pre.note]
    );
    this._loadActiveLedger();
    this._audit('回滚', 'snapshot', id, null, { restored_to: snap.id, before_backup: pre.id });
    this.db.save();
    return { restored: true, to: snap.id, before_backup: pre.id };
  }

  // ================= 期末 =================
  /**
   * 结转损益:把本期损益类科目的发生额结转至「本年利润」,生成一张结转凭证(草稿)。
   * 收入类(贷方余额)→ 借收入/贷本年利润;费用类(借方余额)→ 借本年利润/贷费用。
   */
  carryForwardProfit(period) {
    this._requireAccountant();
    this._requirePeriodOpen(period);
    const profitAcct = this.db.get("SELECT * FROM accounts WHERE ledger_id=? AND name='本年利润'", [this.ledger.id]);
    if (!profitAcct) throw new Error('未找到「本年利润」科目');
    const existing = this.db.get('SELECT id FROM vouchers WHERE ledger_id=? AND period=? AND source=?', [this.ledger.id, period, 'carry-forward']);
    if (existing) throw new Error(`期间 ${period} 已生成结转损益凭证,请勿重复结转`);

    const bal = this._signedBalances(period);
    const entries = [];
    let profit = 0n;
    for (const a of this.db.all("SELECT * FROM accounts WHERE ledger_id=? AND category='pl' ORDER BY code", [this.ledger.id])) {
      const s = bal[a.id] || { period_debit: 0n, period_credit: 0n };
      const net = s.period_credit - s.period_debit; // 贷-借,正=收入(贷方余额)
      if (net === 0n) continue;
      profit += net;
      if (net > 0n) entries.push({ summary: `结转损益:${a.name}`, account_id: a.id, debit: M.formatAmount(net).replace(/,/g, '') });
      else entries.push({ summary: `结转损益:${a.name}`, account_id: a.id, credit: M.formatAmount(-net).replace(/,/g, '') });
    }
    if (entries.length === 0) throw new Error('本期无损益发生额,无需结转');
    if (profit > 0n) entries.push({ summary: '结转本年利润', account_id: profitAcct.id, credit: M.formatAmount(profit).replace(/,/g, '') });
    else if (profit < 0n) entries.push({ summary: '结转本年利润', account_id: profitAcct.id, debit: M.formatAmount(-profit).replace(/,/g, '') });

    const voucher = this.createVoucher({
      voucher_date: lastDayOfPeriod(period),
      voucher_type: '记',
      attachment_count: 0,
      entries,
      source: 'carry-forward',
    });
    this._audit('结转损益', 'period', period, null, { voucher_no: voucher.voucher_no, profit: M.formatAmount(profit).replace(/,/g, '') });
    this.db.save();
    return voucher;
  }

  closePeriod(period) {
    this._requireAccountant();
    this.db.run(
      'INSERT OR REPLACE INTO periods (ledger_id, period, status) VALUES (?,?,?)',
      [this.ledger.id, period, 'closed']
    );
    this._audit('结账', 'period', period, null, { status: 'closed' });
    this.db.save();
    return { period, status: 'closed' };
  }

  unclosePeriod(period) {
    this._requireAccountant();
    this.db.run(
      'INSERT OR REPLACE INTO periods (ledger_id, period, status) VALUES (?,?,?)',
      [this.ledger.id, period, 'open']
    );
    this._audit('反结账', 'period', period, null, { status: 'open' });
    this.db.save();
    return { period, status: 'open' };
  }

  listPeriods() {
    return this.db.all('SELECT * FROM periods WHERE ledger_id=? ORDER BY period', [this.ledger.id]);
  }
}

module.exports = { LedgerService, ROLE_LABELS, STATUS_LABELS, VOUCHER_TYPES };
