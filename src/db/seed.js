'use strict';

/**
 * 种子数据:两套会计准则科目表 + 常用币种
 * ------------------------------------------------------------------
 * 科目层级通过 children 表达;父科目自动设为非末级(不可直接记账)。
 * direction: debit 借方 / credit 贷方(余额方向)。
 */

const STANDARDS = {
  enterprise: '企业会计准则',
  small: '小企业会计准则',
};

// 类别 -> 中文
const CATEGORY_LABELS = {
  asset: '资产',
  liability: '负债',
  common: '共同',
  equity: '所有者权益',
  cost: '成本',
  pl: '损益',
};

// ---- 企业会计准则(常用一级科目 + 少量二级)----
const enterpriseChart = [
  // 资产类 1xxx
  { code: '1001', name: '库存现金', category: 'asset', direction: 'debit', cash: true },
  { code: '1002', name: '银行存款', category: 'asset', direction: 'debit', cash: true, foreign: true, children: [
    { code: '100201', name: '基本存款账户', category: 'asset', direction: 'debit', cash: true, foreign: true },
    { code: '100202', name: '一般存款账户', category: 'asset', direction: 'debit', cash: true, foreign: true },
  ]},
  { code: '1012', name: '其他货币资金', category: 'asset', direction: 'debit', cash: true },
  { code: '1101', name: '交易性金融资产', category: 'asset', direction: 'debit' },
  { code: '1121', name: '应收票据', category: 'asset', direction: 'debit' },
  { code: '1122', name: '应收账款', category: 'asset', direction: 'debit', foreign: true },
  { code: '1123', name: '预付账款', category: 'asset', direction: 'debit' },
  { code: '1131', name: '应收股利', category: 'asset', direction: 'debit' },
  { code: '1132', name: '应收利息', category: 'asset', direction: 'debit' },
  { code: '1221', name: '其他应收款', category: 'asset', direction: 'debit' },
  { code: '1231', name: '坏账准备', category: 'asset', direction: 'credit' },
  { code: '1401', name: '材料采购', category: 'asset', direction: 'debit' },
  { code: '1402', name: '在途物资', category: 'asset', direction: 'debit' },
  { code: '1403', name: '原材料', category: 'asset', direction: 'debit' },
  { code: '1405', name: '库存商品', category: 'asset', direction: 'debit' },
  { code: '1406', name: '发出商品', category: 'asset', direction: 'debit' },
  { code: '1408', name: '委托加工物资', category: 'asset', direction: 'debit' },
  { code: '1471', name: '存货跌价准备', category: 'asset', direction: 'credit' },
  { code: '1511', name: '长期股权投资', category: 'asset', direction: 'debit' },
  { code: '1512', name: '长期股权投资减值准备', category: 'asset', direction: 'credit' },
  { code: '1521', name: '投资性房地产', category: 'asset', direction: 'debit' },
  { code: '1531', name: '长期应收款', category: 'asset', direction: 'debit' },
  { code: '1601', name: '固定资产', category: 'asset', direction: 'debit' },
  { code: '1602', name: '累计折旧', category: 'asset', direction: 'credit' },
  { code: '1603', name: '固定资产减值准备', category: 'asset', direction: 'credit' },
  { code: '1604', name: '在建工程', category: 'asset', direction: 'debit' },
  { code: '1605', name: '工程物资', category: 'asset', direction: 'debit' },
  { code: '1606', name: '固定资产清理', category: 'asset', direction: 'debit' },
  { code: '1701', name: '无形资产', category: 'asset', direction: 'debit' },
  { code: '1702', name: '累计摊销', category: 'asset', direction: 'credit' },
  { code: '1703', name: '无形资产减值准备', category: 'asset', direction: 'credit' },
  { code: '1801', name: '长期待摊费用', category: 'asset', direction: 'debit' },
  { code: '1811', name: '递延所得税资产', category: 'asset', direction: 'debit' },
  { code: '1901', name: '待处理财产损溢', category: 'asset', direction: 'debit' },

  // 负债类 2xxx
  { code: '2001', name: '短期借款', category: 'liability', direction: 'credit', foreign: true },
  { code: '2101', name: '交易性金融负债', category: 'liability', direction: 'credit' },
  { code: '2201', name: '应付票据', category: 'liability', direction: 'credit' },
  { code: '2202', name: '应付账款', category: 'liability', direction: 'credit', foreign: true },
  { code: '2203', name: '预收账款', category: 'liability', direction: 'credit' },
  { code: '2211', name: '应付职工薪酬', category: 'liability', direction: 'credit', children: [
    { code: '221101', name: '工资', category: 'liability', direction: 'credit' },
    { code: '221102', name: '社会保险费', category: 'liability', direction: 'credit' },
    { code: '221103', name: '住房公积金', category: 'liability', direction: 'credit' },
    { code: '221104', name: '职工福利费', category: 'liability', direction: 'credit' },
    { code: '221105', name: '工会经费', category: 'liability', direction: 'credit' },
    { code: '221199', name: '其他', category: 'liability', direction: 'credit' },
  ]},
  { code: '2221', name: '应交税费', category: 'liability', direction: 'credit', children: [
    { code: '222101', name: '应交增值税', category: 'liability', direction: 'credit' },
    { code: '222102', name: '应交城市维护建设税', category: 'liability', direction: 'credit' },
    { code: '222103', name: '应交企业所得税', category: 'liability', direction: 'credit' },
    { code: '222104', name: '应交个人所得税', category: 'liability', direction: 'credit' },
    { code: '222105', name: '应交印花税', category: 'liability', direction: 'credit' },
    { code: '222199', name: '其他应交税费', category: 'liability', direction: 'credit' },
  ]},
  { code: '2231', name: '应付利息', category: 'liability', direction: 'credit' },
  { code: '2232', name: '应付股利', category: 'liability', direction: 'credit' },
  { code: '2241', name: '其他应付款', category: 'liability', direction: 'credit' },
  { code: '2401', name: '递延收益', category: 'liability', direction: 'credit' },
  { code: '2501', name: '长期借款', category: 'liability', direction: 'credit' },
  { code: '2502', name: '应付债券', category: 'liability', direction: 'credit' },
  { code: '2701', name: '长期应付款', category: 'liability', direction: 'credit' },
  { code: '2901', name: '递延所得税负债', category: 'liability', direction: 'credit' },

  // 共同类 3xxx
  { code: '3101', name: '衍生工具', category: 'common', direction: 'debit' },
  { code: '3201', name: '套期工具', category: 'common', direction: 'debit' },

  // 所有者权益类 4xxx
  { code: '4001', name: '实收资本', category: 'equity', direction: 'credit' },
  { code: '4002', name: '资本公积', category: 'equity', direction: 'credit', children: [
    { code: '400201', name: '资本溢价', category: 'equity', direction: 'credit' },
    { code: '400202', name: '其他资本公积', category: 'equity', direction: 'credit' },
  ]},
  { code: '4101', name: '盈余公积', category: 'equity', direction: 'credit', children: [
    { code: '410101', name: '法定盈余公积', category: 'equity', direction: 'credit' },
    { code: '410102', name: '任意盈余公积', category: 'equity', direction: 'credit' },
  ]},
  { code: '4103', name: '本年利润', category: 'equity', direction: 'credit' },
  { code: '4104', name: '利润分配', category: 'equity', direction: 'credit', children: [
    { code: '410401', name: '未分配利润', category: 'equity', direction: 'credit' },
    { code: '410402', name: '提取法定盈余公积', category: 'equity', direction: 'credit' },
    { code: '410403', name: '应付股利', category: 'equity', direction: 'credit' },
  ]},

  // 成本类 5xxx
  { code: '5001', name: '生产成本', category: 'cost', direction: 'debit', children: [
    { code: '500101', name: '直接材料', category: 'cost', direction: 'debit' },
    { code: '500102', name: '直接人工', category: 'cost', direction: 'debit' },
    { code: '500103', name: '制造费用', category: 'cost', direction: 'debit' },
  ]},
  { code: '5101', name: '制造费用', category: 'cost', direction: 'debit', children: [
    { code: '510101', name: '工资', category: 'cost', direction: 'debit' },
    { code: '510102', name: '折旧费', category: 'cost', direction: 'debit' },
    { code: '510103', name: '水电费', category: 'cost', direction: 'debit' },
    { code: '510104', name: '机物料消耗', category: 'cost', direction: 'debit' },
    { code: '510199', name: '其他', category: 'cost', direction: 'debit' },
  ]},
  { code: '5201', name: '劳务成本', category: 'cost', direction: 'debit' },
  { code: '5301', name: '研发支出', category: 'cost', direction: 'debit' },

  // 损益类 6xxx
  { code: '6001', name: '主营业务收入', category: 'pl', direction: 'credit' },
  { code: '6051', name: '其他业务收入', category: 'pl', direction: 'credit' },
  { code: '6101', name: '公允价值变动损益', category: 'pl', direction: 'credit' },
  { code: '6111', name: '投资收益', category: 'pl', direction: 'credit' },
  { code: '6301', name: '营业外收入', category: 'pl', direction: 'credit' },
  { code: '6401', name: '主营业务成本', category: 'pl', direction: 'debit' },
  { code: '6402', name: '其他业务成本', category: 'pl', direction: 'debit' },
  { code: '6403', name: '税金及附加', category: 'pl', direction: 'debit' },
  { code: '6601', name: '销售费用', category: 'pl', direction: 'debit', children: [
    { code: '660101', name: '广告费', category: 'pl', direction: 'debit' },
    { code: '660102', name: '运输费', category: 'pl', direction: 'debit' },
    { code: '660103', name: '装卸费', category: 'pl', direction: 'debit' },
    { code: '660104', name: '包装费', category: 'pl', direction: 'debit' },
    { code: '660105', name: '保险费', category: 'pl', direction: 'debit' },
    { code: '660106', name: '工资', category: 'pl', direction: 'debit' },
    { code: '660199', name: '其他', category: 'pl', direction: 'debit' },
  ]},
  { code: '6602', name: '管理费用', category: 'pl', direction: 'debit', children: [
    { code: '660201', name: '工资', category: 'pl', direction: 'debit' },
    { code: '660202', name: '办公费', category: 'pl', direction: 'debit' },
    { code: '660203', name: '差旅费', category: 'pl', direction: 'debit' },
    { code: '660204', name: '业务招待费', category: 'pl', direction: 'debit' },
    { code: '660205', name: '折旧费', category: 'pl', direction: 'debit' },
    { code: '660206', name: '水电费', category: 'pl', direction: 'debit' },
    { code: '660207', name: '租赁费', category: 'pl', direction: 'debit' },
    { code: '660208', name: '邮电费', category: 'pl', direction: 'debit' },
    { code: '660209', name: '社会保险费', category: 'pl', direction: 'debit' },
    { code: '660210', name: '职工福利费', category: 'pl', direction: 'debit' },
    { code: '660299', name: '其他', category: 'pl', direction: 'debit' },
  ]},
  { code: '6603', name: '财务费用', category: 'pl', direction: 'debit', children: [
    { code: '660301', name: '利息支出', category: 'pl', direction: 'debit' },
    { code: '660302', name: '手续费', category: 'pl', direction: 'debit' },
    { code: '660303', name: '汇兑损益', category: 'pl', direction: 'debit' },
    { code: '660399', name: '其他', category: 'pl', direction: 'debit' },
  ]},
  { code: '6701', name: '资产减值损失', category: 'pl', direction: 'debit' },
  { code: '6702', name: '营业外支出', category: 'pl', direction: 'debit' },
  { code: '6711', name: '所得税费用', category: 'pl', direction: 'debit' },
];

// ---- 小企业会计准则(常用一级科目 + 少量二级)----
const smallChart = [
  // 资产类 1xxx
  { code: '1001', name: '库存现金', category: 'asset', direction: 'debit', cash: true },
  { code: '1002', name: '银行存款', category: 'asset', direction: 'debit', cash: true, foreign: true, children: [
    { code: '100201', name: '基本存款账户', category: 'asset', direction: 'debit', cash: true, foreign: true },
    { code: '100202', name: '一般存款账户', category: 'asset', direction: 'debit', cash: true, foreign: true },
  ]},
  { code: '1012', name: '其他货币资金', category: 'asset', direction: 'debit', cash: true },
  { code: '1101', name: '短期投资', category: 'asset', direction: 'debit' },
  { code: '1121', name: '应收票据', category: 'asset', direction: 'debit' },
  { code: '1122', name: '应收账款', category: 'asset', direction: 'debit', foreign: true },
  { code: '1123', name: '预付账款', category: 'asset', direction: 'debit' },
  { code: '1131', name: '应收股利', category: 'asset', direction: 'debit' },
  { code: '1132', name: '应收利息', category: 'asset', direction: 'debit' },
  { code: '1221', name: '其他应收款', category: 'asset', direction: 'debit' },
  { code: '1401', name: '材料采购', category: 'asset', direction: 'debit' },
  { code: '1402', name: '在途物资', category: 'asset', direction: 'debit' },
  { code: '1403', name: '原材料', category: 'asset', direction: 'debit' },
  { code: '1404', name: '材料成本差异', category: 'asset', direction: 'debit' },
  { code: '1405', name: '库存商品', category: 'asset', direction: 'debit' },
  { code: '1406', name: '商品进销差价', category: 'asset', direction: 'credit' },
  { code: '1407', name: '委托加工物资', category: 'asset', direction: 'debit' },
  { code: '1408', name: '周转材料', category: 'asset', direction: 'debit' },
  { code: '1501', name: '长期债券投资', category: 'asset', direction: 'debit' },
  { code: '1511', name: '长期股权投资', category: 'asset', direction: 'debit' },
  { code: '1601', name: '固定资产', category: 'asset', direction: 'debit' },
  { code: '1602', name: '累计折旧', category: 'asset', direction: 'credit' },
  { code: '1603', name: '固定资产清理', category: 'asset', direction: 'debit' },
  { code: '1604', name: '在建工程', category: 'asset', direction: 'debit' },
  { code: '1605', name: '工程物资', category: 'asset', direction: 'debit' },
  { code: '1701', name: '无形资产', category: 'asset', direction: 'debit' },
  { code: '1702', name: '累计摊销', category: 'asset', direction: 'credit' },
  { code: '1801', name: '长期待摊费用', category: 'asset', direction: 'debit' },
  { code: '1901', name: '待处理财产损溢', category: 'asset', direction: 'debit' },

  // 负债类 2xxx
  { code: '2001', name: '短期借款', category: 'liability', direction: 'credit', foreign: true },
  { code: '2201', name: '应付票据', category: 'liability', direction: 'credit' },
  { code: '2202', name: '应付账款', category: 'liability', direction: 'credit', foreign: true },
  { code: '2203', name: '预收账款', category: 'liability', direction: 'credit' },
  { code: '2211', name: '应付职工薪酬', category: 'liability', direction: 'credit', children: [
    { code: '221101', name: '工资', category: 'liability', direction: 'credit' },
    { code: '221102', name: '社会保险费', category: 'liability', direction: 'credit' },
    { code: '221103', name: '住房公积金', category: 'liability', direction: 'credit' },
    { code: '221104', name: '职工福利费', category: 'liability', direction: 'credit' },
    { code: '221105', name: '工会经费', category: 'liability', direction: 'credit' },
    { code: '221199', name: '其他', category: 'liability', direction: 'credit' },
  ]},
  { code: '2221', name: '应交税费', category: 'liability', direction: 'credit', children: [
    { code: '222101', name: '应交增值税', category: 'liability', direction: 'credit' },
    { code: '222102', name: '应交企业所得税', category: 'liability', direction: 'credit' },
    { code: '222104', name: '应交个人所得税', category: 'liability', direction: 'credit' },
    { code: '222105', name: '应交印花税', category: 'liability', direction: 'credit' },
    { code: '222199', name: '其他应交税费', category: 'liability', direction: 'credit' },
  ]},
  { code: '2231', name: '应付利息', category: 'liability', direction: 'credit' },
  { code: '2232', name: '应付利润', category: 'liability', direction: 'credit' },
  { code: '2241', name: '其他应付款', category: 'liability', direction: 'credit' },
  { code: '2401', name: '递延收益', category: 'liability', direction: 'credit' },
  { code: '2501', name: '长期借款', category: 'liability', direction: 'credit' },
  { code: '2701', name: '长期应付款', category: 'liability', direction: 'credit' },

  // 所有者权益类 3xxx
  { code: '3001', name: '实收资本', category: 'equity', direction: 'credit' },
  { code: '3002', name: '资本公积', category: 'equity', direction: 'credit', children: [
    { code: '300201', name: '资本溢价', category: 'equity', direction: 'credit' },
    { code: '300202', name: '其他资本公积', category: 'equity', direction: 'credit' },
  ]},
  { code: '3101', name: '盈余公积', category: 'equity', direction: 'credit', children: [
    { code: '310101', name: '法定盈余公积', category: 'equity', direction: 'credit' },
    { code: '310102', name: '任意盈余公积', category: 'equity', direction: 'credit' },
  ]},
  { code: '3103', name: '本年利润', category: 'equity', direction: 'credit' },
  { code: '3104', name: '利润分配', category: 'equity', direction: 'credit', children: [
    { code: '310401', name: '未分配利润', category: 'equity', direction: 'credit' },
    { code: '310402', name: '应付利润', category: 'equity', direction: 'credit' },
  ]},

  // 成本类 4xxx
  { code: '4001', name: '生产成本', category: 'cost', direction: 'debit', children: [
    { code: '400101', name: '直接材料', category: 'cost', direction: 'debit' },
    { code: '400102', name: '直接人工', category: 'cost', direction: 'debit' },
    { code: '400103', name: '制造费用', category: 'cost', direction: 'debit' },
  ]},
  { code: '4101', name: '制造费用', category: 'cost', direction: 'debit', children: [
    { code: '410101', name: '工资', category: 'cost', direction: 'debit' },
    { code: '410102', name: '折旧费', category: 'cost', direction: 'debit' },
    { code: '410103', name: '水电费', category: 'cost', direction: 'debit' },
    { code: '410104', name: '机物料消耗', category: 'cost', direction: 'debit' },
    { code: '410199', name: '其他', category: 'cost', direction: 'debit' },
  ]},
  { code: '4301', name: '研发支出', category: 'cost', direction: 'debit' },
  { code: '4401', name: '工程施工', category: 'cost', direction: 'debit' },
  { code: '4403', name: '工程结算', category: 'cost', direction: 'credit' },

  // 损益类 5xxx
  { code: '5001', name: '主营业务收入', category: 'pl', direction: 'credit' },
  { code: '5051', name: '其他业务收入', category: 'pl', direction: 'credit' },
  { code: '5111', name: '投资收益', category: 'pl', direction: 'credit' },
  { code: '5301', name: '营业外收入', category: 'pl', direction: 'credit' },
  { code: '5401', name: '主营业务成本', category: 'pl', direction: 'debit' },
  { code: '5402', name: '其他业务成本', category: 'pl', direction: 'debit' },
  { code: '5403', name: '营业税金及附加', category: 'pl', direction: 'debit' },
  { code: '5601', name: '销售费用', category: 'pl', direction: 'debit', children: [
    { code: '560101', name: '广告费', category: 'pl', direction: 'debit' },
    { code: '560102', name: '运输费', category: 'pl', direction: 'debit' },
    { code: '560103', name: '装卸费', category: 'pl', direction: 'debit' },
    { code: '560104', name: '包装费', category: 'pl', direction: 'debit' },
    { code: '560105', name: '保险费', category: 'pl', direction: 'debit' },
    { code: '560106', name: '工资', category: 'pl', direction: 'debit' },
    { code: '560199', name: '其他', category: 'pl', direction: 'debit' },
  ]},
  { code: '5602', name: '管理费用', category: 'pl', direction: 'debit', children: [
    { code: '560201', name: '工资', category: 'pl', direction: 'debit' },
    { code: '560202', name: '办公费', category: 'pl', direction: 'debit' },
    { code: '560203', name: '差旅费', category: 'pl', direction: 'debit' },
    { code: '560204', name: '业务招待费', category: 'pl', direction: 'debit' },
    { code: '560205', name: '折旧费', category: 'pl', direction: 'debit' },
    { code: '560206', name: '水电费', category: 'pl', direction: 'debit' },
    { code: '560207', name: '租赁费', category: 'pl', direction: 'debit' },
    { code: '560208', name: '邮电费', category: 'pl', direction: 'debit' },
    { code: '560209', name: '社会保险费', category: 'pl', direction: 'debit' },
    { code: '560210', name: '职工福利费', category: 'pl', direction: 'debit' },
    { code: '560299', name: '其他', category: 'pl', direction: 'debit' },
  ]},
  { code: '5603', name: '财务费用', category: 'pl', direction: 'debit', children: [
    { code: '560301', name: '利息支出', category: 'pl', direction: 'debit' },
    { code: '560302', name: '手续费', category: 'pl', direction: 'debit' },
    { code: '560303', name: '汇兑损益', category: 'pl', direction: 'debit' },
    { code: '560399', name: '其他', category: 'pl', direction: 'debit' },
  ]},
  { code: '5711', name: '营业外支出', category: 'pl', direction: 'debit' },
  { code: '5801', name: '所得税费用', category: 'pl', direction: 'debit' },
];

// ---- 币种 ----
const currencies = [
  { code: 'CNY', name: '人民币', symbol: '¥', precision: 2 },
  { code: 'USD', name: '美元', symbol: '$', precision: 2 },
  { code: 'EUR', name: '欧元', symbol: '€', precision: 2 },
  { code: 'HKD', name: '港币', symbol: 'HK$', precision: 2 },
  { code: 'GBP', name: '英镑', symbol: '£', precision: 2 },
  { code: 'JPY', name: '日元', symbol: '¥', precision: 0 },
];

/** 将嵌套科目展开为平铺行(带 parent_id / is_leaf) */
function flatten(list, parentId = null) {
  const out = [];
  for (const item of list) {
    const hasChildren = Array.isArray(item.children) && item.children.length > 0;
    out.push({
      id: item.code,
      code: item.code,
      name: item.name,
      category: item.category,
      direction: item.direction,
      parent_id: parentId,
      is_leaf: hasChildren ? 0 : 1,
      is_cash: item.cash ? 1 : 0,
      is_foreign: item.foreign ? 1 : 0,
      sort_order: 0,
    });
    if (hasChildren) out.push(...flatten(item.children, item.code));
  }
  return out;
}

const charts = {
  [STANDARDS.enterprise]: flatten(enterpriseChart),
  [STANDARDS.small]: flatten(smallChart),
};

module.exports = {
  STANDARDS,
  CATEGORY_LABELS,
  charts,
  currencies,
};
