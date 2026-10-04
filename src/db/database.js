'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('sql.js');
const { schema } = require('./schema');

/**
 * 数据库封装(基于 sql.js,纯 WASM,零原生编译依赖)
 * ------------------------------------------------------------------
 * 整个数据库常驻内存,每次变更后调用 save() 原子写回磁盘(.db 文件)。
 * 快照 = 直接复制导出的字节,天然满足「历史版本 / 回滚」需求。
 */

function uuid() {
  return crypto.randomUUID();
}

/** 原子写入:先写临时文件,再重命名覆盖 */
function atomicWrite(filePath, buffer) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.tmp-' + crypto.randomBytes(4).toString('hex');
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, filePath);
}

class Database {
  constructor(db, filePath, SQL) {
    this._db = db;
    this._filePath = filePath;
    this._SQL = SQL;
  }

  /** 从字节重新加载(用于回滚:把某个快照内容载入内存) */
  loadFromBuffer(buffer) {
    this._db.close();
    this._db = new this._SQL.Database(buffer);
  }

  /** 执行单条 SQL(可带参数) */
  run(sql, params = []) {
    this._db.run(sql, params);
    return this;
  }

  /** 执行多条 SQL(不含参数) */
  exec(sql) {
    this._db.exec(sql);
    return this;
  }

  /** 查询多行 */
  all(sql, params = []) {
    const stmt = this._db.prepare(sql);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  /** 查询单行(无则 null) */
  get(sql, params = []) {
    const stmt = this._db.prepare(sql);
    try {
      stmt.bind(params);
      return stmt.step() ? stmt.getAsObject() : null;
    } finally {
      stmt.free();
    }
  }

  /** 导出当前库为字节 */
  export() {
    return Buffer.from(this._db.export());
  }

  /** 原子写回磁盘 */
  save() {
    atomicWrite(this._filePath, this.export());
  }

  /** 复制一份当前库到指定路径(快照) */
  saveAs(snapshotPath) {
    atomicWrite(snapshotPath, this.export());
  }

  close() {
    this._db.close();
  }

  get filePath() {
    return this._filePath;
  }
}

/**
 * 打开(或新建)数据库。
 * @param {string} dbFilePath .db 文件路径
 */
async function openDatabase(dbFilePath) {
  const SQL = await initSqlJs({
    locateFile: (f) => path.join(path.dirname(require.resolve('sql.js')), f),
  });
  let db;
  if (fs.existsSync(dbFilePath)) {
    const buf = fs.readFileSync(dbFilePath);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  const database = new Database(db, dbFilePath, SQL);
  for (const stmt of schema) database.exec(stmt);
  return database;
}

module.exports = { openDatabase, Database, atomicWrite, uuid };
