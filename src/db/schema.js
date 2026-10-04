'use strict';

/**
 * 数据库 schema
 * ------------------------------------------------------------------
 * 从第一天起就按「多币种 + 多账套 + 角色 + 审计日志 + 快照」设计,避免后续迁移。
 * 所有金额字段均为整数最小货币单位(本位币默认分),外币金额为对应币种的最小单位。
 */

const schema = [
  // ---- 账套 ----
  `CREATE TABLE IF NOT EXISTS ledgers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    company_name TEXT,
    tax_no TEXT,
    accounting_standard TEXT NOT NULL,
    base_currency TEXT NOT NULL DEFAULT 'CNY',
    fiscal_start_month INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  )`,

  // ---- 用户(角色:会计 / 审计)----
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('accountant','auditor')),
    created_at TEXT NOT NULL
  )`,

  // ---- 币种 ----
  `CREATE TABLE IF NOT EXISTS currencies (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    symbol TEXT,
    precision INTEGER NOT NULL DEFAULT 2,
    enabled INTEGER NOT NULL DEFAULT 1
  )`,

  // ---- 汇率(每账套、每币种、每会计期间一条)----
  `CREATE TABLE IF NOT EXISTS exchange_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ledger_id TEXT NOT NULL,
    currency_code TEXT NOT NULL,
    base_currency TEXT NOT NULL,
    period TEXT NOT NULL,
    rate_scaled INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(ledger_id, currency_code, base_currency, period)
  )`,

  // ---- 会计科目 ----
  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT NOT NULL,
    ledger_id TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('asset','liability','equity','cost','pl','common')),
    direction TEXT NOT NULL CHECK(direction IN ('debit','credit')),
    parent_id TEXT,
    is_leaf INTEGER NOT NULL DEFAULT 1,
    is_cash INTEGER NOT NULL DEFAULT 0,
    is_foreign INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (ledger_id, id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_accounts_code ON accounts(ledger_id, code)`,

  // ---- 期初余额(仅末级科目,含外币)----
  `CREATE TABLE IF NOT EXISTS opening_balances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ledger_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    period TEXT NOT NULL,
    amount INTEGER NOT NULL,
    currency_code TEXT,
    UNIQUE(ledger_id, account_id, period)
  )`,

  // ---- 记账凭证 ----
  `CREATE TABLE IF NOT EXISTS vouchers (
    id TEXT PRIMARY KEY,
    ledger_id TEXT NOT NULL,
    voucher_no TEXT NOT NULL,
    voucher_date TEXT NOT NULL,
    period TEXT NOT NULL,
    voucher_type TEXT NOT NULL CHECK(voucher_type IN ('记','收','付','转')),
    attachment_count INTEGER NOT NULL DEFAULT 0,
    maker TEXT NOT NULL,
    reviewer TEXT,
    status TEXT NOT NULL CHECK(status IN ('draft','approved','posted','voided')),
    source TEXT,
    created_at TEXT NOT NULL,
    reviewed_at TEXT,
    posted_at TEXT,
    UNIQUE(ledger_id, period, voucher_no)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_vouchers_period ON vouchers(ledger_id, period)`,

  // ---- 凭证分录 ----
  `CREATE TABLE IF NOT EXISTS voucher_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voucher_id TEXT NOT NULL,
    line_no INTEGER NOT NULL,
    summary TEXT NOT NULL,
    account_id TEXT NOT NULL,
    currency_code TEXT NOT NULL DEFAULT 'CNY',
    exchange_rate_scaled INTEGER,
    debit_foreign INTEGER,
    credit_foreign INTEGER,
    debit INTEGER NOT NULL DEFAULT 0,
    credit INTEGER NOT NULL DEFAULT 0,
    aux_item_id TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_entries_voucher ON voucher_entries(voucher_id)`,
  `CREATE INDEX IF NOT EXISTS idx_entries_account ON voucher_entries(account_id)`,
  `CREATE INDEX IF NOT EXISTS idx_entries_aux ON voucher_entries(aux_item_id)`,

  // ---- 辅助核算对象(往来单位/部门/项目)----
  `CREATE TABLE IF NOT EXISTS aux_items (
    id TEXT PRIMARY KEY,
    ledger_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('customer','supplier','department','project')),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,

  // ---- 会计期间 ----
  `CREATE TABLE IF NOT EXISTS periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ledger_id TEXT NOT NULL,
    period TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
    UNIQUE(ledger_id, period)
  )`,

  // ---- 审计日志(只追加,不提供修改/删除接口)----
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ledger_id TEXT,
    user_id TEXT,
    username TEXT,
    role TEXT,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    old_value TEXT,
    new_value TEXT,
    note TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at)`,

  // ---- 数据快照(回滚用)----
  `CREATE TABLE IF NOT EXISTS snapshots (
    id TEXT PRIMARY KEY,
    ledger_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    trigger TEXT NOT NULL,
    description TEXT,
    file_path TEXT NOT NULL,
    note TEXT
  )`,

  // ---- 系统设置(key-value)----
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,
];

module.exports = { schema };
