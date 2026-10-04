'use strict';

/**
 * 精确金额工具
 * ------------------------------------------------------------------
 * 财务红线:金额一律以「整数最小货币单位」存储(本位币 CNY 默认 2 位小数 = 分),
 * 全部运算走 BigInt,绝不使用浮点,杜绝分位误差。
 * 汇率以整数放大 1e8(8 位小数)存储,换算时用 BigInt 四舍五入(远离零)。
 */

const RATE_SCALE = 100000000n; // 汇率放大倍数(8 位小数)

/** 任意值 -> BigInt(仅接受安全整数/字符串/BigInt) */
function toBigInt(v) {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new Error(`金额应为整数,收到: ${v}`);
    return BigInt(v);
  }
  if (typeof v === 'string') return BigInt(v.trim());
  if (v == null) return 0n;
  throw new Error(`无法识别的金额值: ${JSON.stringify(v)}`);
}

function pow10(n) {
  return 10n ** BigInt(n);
}

/**
 * 解析用户输入的金额字符串 -> 整数(按 precision 位小数)。
 * 支持 "1,234.56"、"1，234.56"、"-8.5"、"+100"、"￥9.9" 等;非法输入抛错。
 */
function parseAmount(input, precision = 2) {
  if (input == null) return 0n;
  let s = String(input)
    .trim()
    .replace(/,/g, '')
    .replace(/，/g, '')
    .replace(/\s+/g, '')
    .replace(/￥/g, '')
    .replace(/¥/g, '');
  if (s === '' || s === '-' || s === '+') return 0n;
  let neg = false;
  if (s[0] === '-') { neg = true; s = s.slice(1); }
  else if (s[0] === '+') { s = s.slice(1); }
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`无效金额: ${input}`);
  const [intPart, fracPart = ''] = s.split('.');
  const fracPadded = (fracPart + '0'.repeat(precision)).slice(0, precision);
  let val = BigInt(intPart) * pow10(precision) + BigInt(fracPadded);
  return neg ? -val : val;
}

/** 整数金额 -> 带千分位、指定小数位的字符串 */
function formatAmount(value, precision = 2) {
  let v = toBigInt(value);
  const neg = v < 0n;
  if (neg) v = -v;
  const scale = pow10(precision);
  const intPart = v / scale;
  const frac = (v % scale).toString().padStart(precision, '0');
  const intStr = intPart.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + (precision > 0 ? `${intStr}.${frac}` : intStr);
}

/** 四舍五入(远离零):n / d 的整数结果 */
function roundHalfAwayFromZero(n, d) {
  const num = toBigInt(n);
  const divisor = toBigInt(d);
  const neg = num < 0n;
  const abs = neg ? -num : num;
  const q = abs / divisor;
  const rem = abs % divisor;
  const r = (rem * 2n >= divisor) ? q + 1n : q;
  return neg ? -r : r;
}

/** 外币金额(外币最小单位)按汇率换算为本位币最小单位 */
function convertForeignToBase(foreignAmount, rateScaled) {
  const f = toBigInt(foreignAmount);
  const r = toBigInt(rateScaled);
  return roundHalfAwayFromZero(f * r, RATE_SCALE);
}

/** 汇率字符串 -> 放大整数(8 位小数) */
function parseRate(input) { return parseAmount(input, 8); }

/** 放大整数 -> 汇率字符串(去掉尾部多余的 0) */
function formatRate(rateScaled) {
  let v = toBigInt(rateScaled);
  const neg = v < 0n;
  if (neg) v = -v;
  const intPart = v / RATE_SCALE;
  const frac = (v % RATE_SCALE).toString().padStart(8, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + (frac ? `${intPart}.${frac}` : `${intPart}`);
}

module.exports = {
  RATE_SCALE,
  toBigInt,
  parseAmount,
  formatAmount,
  roundHalfAwayFromZero,
  convertForeignToBase,
  parseRate,
  formatRate,
};
