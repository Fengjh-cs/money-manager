'use strict';

const { app, BrowserWindow, ipcMain, protocol, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { openDatabase } = require('./src/db/database');
const { LedgerService } = require('./src/services/ledger-service');

// 自定义安全协议:用 app:// 加载本地资源,使 CSP 的 'self' 能正确生效
const APP_SCHEME = 'app';
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

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
  win.loadURL(`${APP_SCHEME}://./index.html`);

  // 开发辅助:把渲染进程的控制台与关键状态打印到终端,便于排障(打包后默认关闭,可用 LEDGER_DEV_VERIFY=1 开启)
  if (!app.isPackaged || process.env.LEDGER_DEV_VERIFY) {
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
          `JSON.stringify({ api: typeof window.api, appLen: (document.getElementById('app') || {}).innerHTML ? document.getElementById('app').innerHTML.length : 0, roleBtns: document.querySelectorAll('.role-btn').length })`
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
    'ledger:list': () => service.listLedgers(),
    'ledger:switch': (id) => service.switchLedger(id),

    'account:list': () => service.listAccounts(),
    'account:add': (opts) => service.addAccount(opts),

    'aux:list': (type) => service.listAuxItems(type),
    'aux:add': (opts) => service.addAuxItem(opts),
    'aux:delete': (id) => service.deleteAuxItem(id),
    'aux:ledger': (o) => service.auxLedger(o.aux_item_id, o.from, o.to),

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
    'report:cashFlow': (period) => service.cashFlowStatement(period),

    'audit:list': (limit) => service.listAuditLogs(limit || 500),

    'snapshot:create': (o) => service.createSnapshot(o.trigger, o.description),
    'snapshot:list': () => service.listSnapshots(),
    'snapshot:restore': (id) => service.restoreSnapshot(id),

    'period:close': (period) => service.closePeriod(period),
    'period:unclose': (period) => service.unclosePeriod(period),
    'period:list': () => service.listPeriods(),
    'period:carryForward': (period) => service.carryForwardProfit(period),

    // 导出 CSV(带 UTF-8 BOM,Excel 可直接打开中文)
    'export:csv': async ({ filename, content }) => {
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        defaultPath: filename,
        filters: [{ name: 'CSV 文件', extensions: ['csv'] }],
      });
      if (canceled || !filePath) return { canceled: true };
      fs.writeFileSync(filePath, '﻿' + content, 'utf8');
      return { saved: true, path: filePath };
    },

    // 打印:A4,弹出系统打印对话框
    'print:html': async ({ html }) => {
      const pw = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
      await pw.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      await new Promise((resolve) => {
        pw.webContents.print({ silent: false }, () => resolve());
      });
      pw.destroy();
      return { printed: true };
    },
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
  // 把 app:// 请求映射到 renderer 目录下的文件(用 fs 读取,兼容打包后的 asar)
  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
  };
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\//, '') || 'index.html';
    const rendererRoot = path.join(__dirname, 'renderer');
    let fp = path.normalize(path.join(rendererRoot, rel));
    if (!fp.startsWith(rendererRoot + path.sep)) fp = path.join(rendererRoot, 'index.html');
    try {
      const data = fs.readFileSync(fp);
      return new Response(data, {
        headers: { 'content-type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' },
      });
    } catch (e) {
      return new Response('Not found', { status: 404 });
    }
  });

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
