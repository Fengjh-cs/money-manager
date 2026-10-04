'use strict';

const { app, BrowserWindow, ipcMain, protocol, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { openDatabase } = require('./src/db/database');
const { LedgerService } = require('./src/services/ledger-service');
const { isEncrypted, sealSetup, deriveKey, readSalt } = require('./src/db/crypto');

// 自定义安全协议:用 app:// 加载本地资源,使 CSP 的 'self' 能正确生效
const APP_SCHEME = 'app';
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let win = null;
let service = null;
let dbPath = null;
let dataDir = null;
let cryptoInfo = null; // { salt, key } 或 null

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#f4f6f9',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.ico'),
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
          `JSON.stringify({ api: typeof window.api, appLen: (document.getElementById('app') || {}).innerHTML ? document.getElementById('app').innerHTML.length : 0, roleBtns: document.querySelectorAll('.role-btn').length, unlock: !!document.getElementById('unlock-password') })`
        );
        console.log('[dev-verify] 延迟检查:', r);
      } catch (e) {
        console.log('[dev-verify] error:', e.message);
      }
    });
  }
}

/** 返回完整初始化数据(解锁后 / 已初始化时) */
function fullInit() {
  return {
    hasLedger: service.hasLedger(),
    ledger: service.getLedger(),
    users: service.listUsers(),
    standards: service.listStandards(),
    currencies: service.listCurrencies(),
  };
}

/**
 * IPC 白名单:渲染进程只能调用这里显式列出的方法。
 * 统一返回 { ok, data } 或 { ok:false, error },便于界面直接展示错误。
 */
function registerIpc() {
  const handlers = {
    'app:init': () => {
      if (!service) return { locked: true };
      return fullInit();
    },

    // 输入主密码解锁加密数据库
    'db:unlock': async ({ password }) => {
      if (service) return fullInit();
      const buf = fs.readFileSync(dbPath);
      const salt = readSalt(buf);
      const key = deriveKey(password, salt);
      let db;
      try {
        db = await openDatabase(dbPath, { salt, key });
      } catch (e) {
        throw new Error('数据库密码错误');
      }
      service = new LedgerService(db, dataDir);
      cryptoInfo = { salt, key };
      return fullInit();
    },

    'login': ({ username, password }) => {
      const user = service.login(username, password);
      return { user, hasLedger: service.hasLedger(), ledger: service.getLedger() };
    },
    'password:change': ({ username, oldPassword, newPassword }) => service.changePassword(username, oldPassword, newPassword),

    'ledger:create': (opts) => {
      const { masterPassword, ...rest } = opts;
      const ledger = service.createLedger(rest);
      // 首次建账时设置主密码 → 从此落盘为加密文件
      if (masterPassword && !cryptoInfo) {
        const sealed = sealSetup(masterPassword);
        cryptoInfo = sealed;
        service.db.setCrypto(sealed);
        service.db.save();
      }
      return ledger;
    },
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

    // 批量导入期初余额(CSV:科目编码,科目名称,借方余额,贷方余额)
    'opening:import': async (period) => {
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [{ name: 'CSV 文件', extensions: ['csv'] }],
      });
      if (canceled || !filePaths || !filePaths.length) return { canceled: true };
      const text = fs.readFileSync(filePaths[0], 'utf8').replace(/^﻿/, '');
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (!lines.length) throw new Error('文件为空');
      const rows = [];
      for (let i = 0; i < lines.length; i++) {
        const cells = lines[i].split(',').map(c => c.trim());
        if (i === 0 && cells[0] && /编码|科目|code/i.test(cells[0])) continue; // 跳过表头
        if (cells.length < 4) continue;
        rows.push({ code: cells[0], debit: cells[2], credit: cells[3] });
      }
      if (!rows.length) throw new Error('未解析到有效数据(格式:科目编码,科目名称,借方余额,贷方余额)');
      return service.importOpeningBalances(period, rows);
    },

    // 导出期初余额模板
    'opening:template': async () => {
      const accounts = service.listAccounts().filter(a => a.is_leaf);
      const content = '科目编码,科目名称,借方余额,贷方余额\r\n' + accounts.map(a => `${a.code},${a.name},,`).join('\r\n');
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        defaultPath: '期初余额模板.csv',
        filters: [{ name: 'CSV 文件', extensions: ['csv'] }],
      });
      if (canceled || !filePath) return { canceled: true };
      fs.writeFileSync(filePath, '﻿' + content, 'utf8');
      return { saved: true, path: filePath };
    },

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
      const pw = new BrowserWindow({ show: true, width: 720, height: 900, autoHideMenuBar: true, webPreferences: { sandbox: true } });
      await pw.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      await new Promise((resolve) => {
        pw.webContents.print({ silent: false, printBackground: true }, () => resolve());
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

  dataDir = app.isPackaged
    ? path.join(app.getPath('userData'), 'data')
    : path.join(__dirname, 'data');
  dbPath = path.join(dataDir, 'ledger.db');

  // 若数据文件已加密,保持 service 为空,由渲染层展示「解锁」页
  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath);
    if (!isEncrypted(buf)) {
      const db = await openDatabase(dbPath, null);
      service = new LedgerService(db, dataDir);
    }
  } else {
    const db = await openDatabase(dbPath, null);
    service = new LedgerService(db, dataDir);
  }

  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
