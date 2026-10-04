'use strict';

/**
 * 数据库文件加密:AES-256-GCM,密钥由主密码经 scrypt 派生。
 * 文件格式:MAGIC(4) | salt(16) | iv(12) | authTag(16) | ciphertext
 */

const crypto = require('crypto');

const MAGIC = Buffer.from('LEDB');
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const HEADER_LEN = MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN;

/** 由密码 + 盐派生 32 字节密钥 */
function deriveKey(password, salt) {
  return crypto.scryptSync(String(password), salt, KEY_LEN);
}

/** 首次设置主密码:生成盐 + 密钥(盐固定,后续加解密复用) */
function sealSetup(password) {
  const salt = crypto.randomBytes(SALT_LEN);
  return { salt, key: deriveKey(password, salt) };
}

/** 从密文中读取盐 */
function readSalt(buffer) {
  if (!buffer || buffer.length < MAGIC.length + SALT_LEN) return null;
  return buffer.slice(MAGIC.length, MAGIC.length + SALT_LEN);
}

/** 加密(每次用新的 iv) */
function encrypt(plaintext, salt, key) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, salt, iv, tag, ct]);
}

/** 解密(密钥错误时 final() 抛错) */
function decrypt(buffer, key) {
  if (!buffer || buffer.length < HEADER_LEN) throw new Error('数据文件无效');
  const iv = buffer.slice(MAGIC.length + SALT_LEN, MAGIC.length + SALT_LEN + IV_LEN);
  const tag = buffer.slice(MAGIC.length + SALT_LEN + IV_LEN, HEADER_LEN);
  const ct = buffer.slice(HEADER_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/** 判断是否为加密文件 */
function isEncrypted(buffer) {
  return !!(buffer && buffer.length >= MAGIC.length && buffer.slice(0, MAGIC.length).equals(MAGIC));
}

module.exports = { deriveKey, sealSetup, readSalt, encrypt, decrypt, isEncrypted };
