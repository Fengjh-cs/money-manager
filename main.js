'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { openDatabase } = require('./src/db/database');
const { LedgerService } = require('./src/services/ledger-service');

let win = null;
let service = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#f4f6f9',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 开发辅助:把渲染进程的控制台与关键状态打印到终端,便于排障(打包后关闭)
  if (!app.isPackaged) {
    const rendererLogs = [];
    win.webContents.on('console-message', (event, level, message) => {
      const m = (event && typeof event === 'object' && 'message' in event) ? event.message : message;
      const l = (event && typeof event === 'object' && 'level' in event) ? event.level : level;
      if (m) { rendererLogs.push(`[${l}] ${m}`); console.log('[renderer]', l, m); }
    });
    win.webContents.on('did-fail-load', (_e, code, desc) => {
      console.log('[dev-verify] did-fail-load', code, desc);
    });
    win.webContents.on('did-finish-load', async () => {
      await new Promise(r => setTimeout(r, 2500));
      try {
        const r = await win.webContents.executeJavaScript(
          `JSON.stringify({ api: typeof window.api, appLen: (document.getElementById('app') || {}).innerHTML ? document.getElementById('app').innerHTML.length : 0 })`
        );
        console.log('[dev-verify] 延迟检查:', r);
      } catch (e) {
        console.log('[dev-verify] error:', e.message);
      }
    });
  }
}

/**
 * IPC 白名单:渲染进程只能调用这里显式列出的方法。
 * 统一返回 { ok, data } 或 { ok:false, error },便于界面直接展示错误。
 */
function registerIpc() {
  const handlers = {
    'app:init': () => ({
      hasLedger: service.hasLedger(),
      ledger: service.getLedger(),
      users: service.listUsers(),
      standards: service.listStandards(),
      currencies: service.listCurrencies(),
    }),

    'login': ({ username }) => {
      const u = service.listUsers().find(x => x.username === username);
      if (!u) throw new Error('用户不存在');
      service.setUser(u);
      return { user: u, hasLedger: service.hasLedger(), ledger: service.getLedger() };
    },

    'ledger:create': (opts) => service.createLedger(opts),

    'account:list': () => service.listAccounts(),
    'account:add': (opts) => service.addAccount(opts),

    'opening:set': (opts) => service.setOpeningBalance(opts.account_id, opts.period, opts.amount, opts.currency_code),
    'opening:list': (period) => service.listOpeningBalances(period),

    'rate:set': (opts) => service.setExchangeRate(opts.currency_code, opts.period, opts.rate),
    'rate:list': (period) => service.listExchangeRates(period),
    'currency:list': () => service.listCurrencies(),

    'voucher:create': (opts) => service.createVoucher(opts),
    'voucher:update': (opts) => service.updateVoucher(opts.id, opts),
    'voucher:get': (id) => service.getVoucher(id),
    'voucher:list': (opts) => service.listVouchers(opts),
    'voucher:review': (id) => service.reviewVoucher(id),
    'voucher:unreview': (id) => service.unreviewVoucher(id),
    'voucher:post': (id) => service.postVoucher(id),
    'voucher:unpost': (id) => service.unpostVoucher(id),
    'voucher:void': (id) => service.voidVoucher(id),
    'voucher:reverse': (id) => service.reverseVoucher(id),

    'report:trialBalance': (period) => service.trialBalance(period),
    'report:balanceSheet': (period) => service.balanceSheet(period),
    'report:incomeStatement': (period) => service.incomeStatement(period),
    'report:subsidiaryLedger': (o) => service.subsidiaryLedger(o.account_id, o.from, o.to),
    'report:generalLedger': (o) => service.generalLedger(o.account_id, o.from, o.to),

    'audit:list': (limit) => service.listAuditLogs(limit || 500),

    'snapshot:create': (o) => service.createSnapshot(o.trigger, o.description),
    'snapshot:list': () => service.listSnapshots(),
    'snapshot:restore': (id) => service.restoreSnapshot(id),

    'period:close': (period) => service.closePeriod(period),
    'period:unclose': (period) => service.unclosePeriod(period),
    'period:list': () => service.listPeriods(),
  };

  ipcMain.handle('api', (_event, method, payload) => {
    const fn = handlers[method];
    if (!fn) return { ok: false, error: '未知方法: ' + method };
    try {
      return { ok: true, data: fn(payload) };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });
}

app.whenReady().then(async () => {
  const dataDir = app.isPackaged
    ? path.join(app.getPath('userData'), 'data')
    : path.join(__dirname, 'data');
  const db = await openDatabase(path.join(dataDir, 'ledger.db'));
  service = new LedgerService(db, dataDir);
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
