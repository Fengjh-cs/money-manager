'use strict';

/**
 * 冒烟测试:在 node 下直接验证核心会计逻辑(无需启动界面)。
 * 运行:npm run smoke
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../src/db/database');
const { LedgerService } = require('../src/services/ledger-service');

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}
function assertThrows(name, fn, msgContains) {
  try { fn(); check(name, false, '未抛出异常'); }
  catch (e) { check(name, String(e.message).includes(msgContains), e.message); }
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  const db = await openDatabase(path.join(tmp, 'ledger.db'));
  const svc = new LedgerService(db, tmp);

  console.log('— 初始化用户 —');
  check('建账前即有默认用户(会计+审计)', svc.listUsers().length === 2, '用户数=' + svc.listUsers().length);

  console.log('— 建账 —');
  const ledger = svc.createLedger({ name: '测试公司', accounting_standard: '企业会计准则', opening_period: '2026-01' });
  check('账套创建', !!ledger && svc.hasLedger());
  const accounts = svc.listAccounts();
  check('科目已预置(>80)', accounts.length > 80, '科目数=' + accounts.length);

  console.log('— 用户/角色 —');
  const users = svc.listUsers();
  check('默认用户:会计+审计', users.length === 2 && users.some(u => u.role === 'accountant') && users.some(u => u.role === 'auditor'));
  const accountant = users.find(u => u.role === 'accountant');
  const auditor = users.find(u => u.role === 'auditor');
  svc.setUser(accountant);

  console.log('— 登录密码 —');
  check('默认密码 123456 可登录', !!svc.login('会计', '123456'));
  assertThrows('错误密码被拒', () => svc.login('会计', '错误'), '密码错误');
  svc.changePassword('会计', '123456', 'abcd');
  check('改密后新密码可登录', !!svc.login('会计', 'abcd'));
  assertThrows('旧密码已失效', () => svc.login('会计', '123456'), '密码错误');
  svc.changePassword('会计', 'abcd', '123456'); // 恢复默认
  svc.setUser(accountant);

  console.log('— 期初余额 —');
  svc.setOpeningBalance('1001', '2026-01', '5000.00');
  svc.setOpeningBalance('4001', '2026-01', '-5000.00');
  check('期初余额设置', true);

  console.log('— 凭证:借贷平衡校验 —');
  assertThrows('拒绝借贷不平衡', () => svc.createVoucher({
    voucher_date: '2026-01-05', voucher_type: '记',
    entries: [
      { summary: '收投资款', account_id: '1001', debit: '1000' },
      { summary: '收投资款', account_id: '4001', credit: '900' },
    ],
  }), '借贷不平衡');
  assertThrows('拒绝非末级科目', () => svc.createVoucher({
    voucher_date: '2026-01-05',
    entries: [
      { summary: 'x', account_id: '1002', debit: '100' },
      { summary: 'x', account_id: '4001', credit: '100' },
    ],
  }), '不是末级科目');
  assertThrows('拒绝借货同填一行', () => svc.createVoucher({
    voucher_date: '2026-01-05',
    entries: [
      { summary: 'x', account_id: '1001', debit: '100', credit: '100' },
      { summary: 'x', account_id: '4001', credit: '100' },
    ],
  }), '不能同时');

  const v = svc.createVoucher({
    voucher_date: '2026-01-05', voucher_type: '记',
    entries: [
      { summary: '收到股东投资', account_id: '1001', debit: '1000.00' },
      { summary: '收到股东投资', account_id: '4001', credit: '1000.00' },
    ],
  });
  check('创建凭证成功', v.status === 'draft' && v.voucher_no === '记-2026-01-0001', v.voucher_no);

  console.log('— 审核/记账状态机 —');
  assertThrows('草稿不能直接记账', () => svc.postVoucher(v.id), '已审核');
  svc.reviewVoucher(v.id);
  check('审核通过', svc.getVoucher(v.id).status === 'approved');
  svc.postVoucher(v.id);
  check('记账完成', svc.getVoucher(v.id).status === 'posted');
  assertThrows('已记账不能作废', () => svc.voidVoucher(v.id), '冲销');

  console.log('— 报表 —');
  const tb = svc.trialBalance('2026-01');
  check('试算平衡', tb.balanced === true);
  check('期末借方合计=6000.00', tb.total.ending_debit === '6000.00', tb.total.ending_debit);
  check('期末贷方合计=6000.00', tb.total.ending_credit === '6000.00', tb.total.ending_credit);
  const bs = svc.balanceSheet('2026-01');
  check('资产负债表平衡', bs.balanced === true);
  check('资产合计=6000.00', bs.asset_total === '6000.00', bs.asset_total);
  const inc = svc.incomeStatement('2026-01');
  check('利润表利润=0.00', inc.profit === '0.00', inc.profit);

  console.log('— 外币换算 —');
  svc.setExchangeRate('USD', '2026-01', '7.10');
  const v2 = svc.createVoucher({
    voucher_date: '2026-01-06',
    entries: [
      { summary: '收到美元货款', account_id: '100201', currency_code: 'USD', exchange_rate: '7.10', debit: '100.00' },
      { summary: '收到美元货款', account_id: '6001', credit: '710.00' },
    ],
  });
  const e0 = v2.entries[0];
  check('100美元×7.1=710(本位币分)', e0.debit === 71000 && e0.debit_foreign === 10000, JSON.stringify({ debit: e0.debit, foreign: e0.debit_foreign }));
  svc.reviewVoucher(v2.id); svc.postVoucher(v2.id);
  const tb2 = svc.trialBalance('2026-01');
  check('含外币后仍平衡', tb2.balanced === true);
  check('收入=710.00', inc2(), '见利润表');

  function inc2() { const i = svc.incomeStatement('2026-01'); return i.revenue === '710.00'; }

  console.log('— 审计日志 —');
  const logs = svc.listAuditLogs();
  check('审计日志已记录', logs.length > 0, '条数=' + logs.length);
  check('含「创建凭证」', logs.some(l => l.action === '创建凭证'));
  check('含「记账」', logs.some(l => l.action === '记账'));

  console.log('— 快照/回滚 —');
  const snap = svc.createSnapshot('manual', '测试快照');
  check('创建快照文件', fs.existsSync(snap.file_path));
  const beforeRestore = svc.listVouchers().length;
  svc.createVoucher({ voucher_date: '2026-01-07', entries: [
    { summary: '临时', account_id: '1001', debit: '1' }, { summary: '临时', account_id: '4001', credit: '1' },
  ]});
  check('回滚前多一张凭证', svc.listVouchers().length === beforeRestore + 1);
  const res = svc.restoreSnapshot(snap.id);
  check('回滚成功', res.restored === true);
  check('回滚后凭证数恢复', svc.listVouchers().length === beforeRestore, `before=${beforeRestore} after=${svc.listVouchers().length}`);
  check('恢复前自动备份存在', svc.listSnapshots().some(s => s.id === res.before_backup));

  console.log('— 审计只读 —');
  svc.setUser(auditor);
  assertThrows('审计不能创建凭证', () => svc.createVoucher({ voucher_date: '2026-01-08', entries: [
    { summary: 'x', account_id: '1001', debit: '1' }, { summary: 'x', account_id: '4001', credit: '1' },
  ]}), '只读');
  svc.setUser(accountant);

  console.log('— 结账期间锁 —');
  svc.closePeriod('2026-01');
  assertThrows('结账后不能新增凭证', () => svc.createVoucher({ voucher_date: '2026-01-09', entries: [
    { summary: 'x', account_id: '1001', debit: '1' }, { summary: 'x', account_id: '4001', credit: '1' },
  ]}), '已结账');
  svc.unclosePeriod('2026-01');

  console.log('— 冲销(蓝字) —');
  svc.setUser(accountant);
  const rev = svc.reverseVoucher(v2.id);
  check('冲销凭证已生成', rev.status === 'draft' && rev.entries.length === v2.entries.length);

  console.log('— 结转损益 —');
  // 当前 2026-01 已有一笔收入 6001 贷方 710.00,结转后应借 6001 710 / 贷 4103 710
  const cf = svc.carryForwardProfit('2026-01');
  check('结转凭证已生成', cf.status === 'draft' && cf.source === 'carry-forward');
  const cfIncome = cf.entries.find(e => e.account_id === '6001');
  const cfProfit = cf.entries.find(e => e.account_id === '4103');
  check('收入科目被借方冲销 710', cfIncome && cfIncome.debit === 71000, JSON.stringify(cfIncome));
  check('本年利润贷方 710', cfProfit && cfProfit.credit === 71000, JSON.stringify(cfProfit));
  assertThrows('重复结转被拒绝', () => svc.carryForwardProfit('2026-01'), '已生成结转损益凭证');

  console.log('— 现金流量表(直接法) —');
  const cfStmt = svc.cashFlowStatement('2026-01');
  check('经营流入 710', cfStmt.operating.inflow === '710.00', cfStmt.operating.inflow);
  check('筹资流入 1000', cfStmt.financing.inflow === '1000.00', cfStmt.financing.inflow);
  check('现金净增加 1710', cfStmt.net_increase === '1710.00', cfStmt.net_increase);

  console.log('— 多账套 —');
  const firstLedgerId = svc.getLedger().id;
  const lg2 = svc.createLedger({ name: '第二账套', accounting_standard: '小企业会计准则', opening_period: '2026-02' });
  check('新建第二账套后共 2 个', svc.listLedgers().length === 2);
  check('活动账套已切换为新账套', svc.getLedger().id === lg2.id);
  svc.switchLedger(firstLedgerId);
  check('切回第一账套', svc.getLedger().id === firstLedgerId);

  console.log('— 辅助核算 —');
  const aux = svc.addAuxItem({ type: 'customer', code: 'KH001', name: '甲公司' });
  check('新增辅助对象', !!aux.id);
  const vAux = svc.createVoucher({
    voucher_date: '2026-01-08', voucher_type: '记',
    entries: [
      { summary: '销售给甲公司', account_id: '1001', debit: '500', aux_item_id: aux.id },
      { summary: '销售给甲公司', account_id: '6001', credit: '500' },
    ],
  });
  const eAux = vAux.entries.find(e => e.aux_item_id === aux.id);
  check('分录带辅助对象', !!eAux);
  svc.reviewVoucher(vAux.id); svc.postVoucher(vAux.id);
  const auxLedger = svc.auxLedger(aux.id, '2026-01', '2026-01');
  check('辅助明细有记录', auxLedger.lines.length === 1, '行数=' + auxLedger.lines.length);
  assertThrows('已使用的辅助对象不能删除', () => svc.deleteAuxItem(aux.id), '不能删除');

  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(`\n结果:${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FAIL', e); process.exit(1); });
