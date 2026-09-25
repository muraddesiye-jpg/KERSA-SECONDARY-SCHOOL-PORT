import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";
import "dotenv/config";

const dataDir = path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = process.env.SQLITE_PATH?.trim() || path.join(dataDir, "kersa.sqlite");

export const database = new DatabaseSync(dbPath, { timeout: 10000 });
database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 10000;");

function sqliteError(error) {
  const message = error?.message || String(error);
  if (/UNIQUE constraint failed/i.test(message)) error.code = "23505";
  if (/FOREIGN KEY constraint failed/i.test(message)) error.code = "23503";
  return error;
}

function bindPostgresParams(text, params = []) {
  const ordered = [];
  const sql = String(text).replace(/\$(\d+)/g, (_, n) => {
    const index = Number(n) - 1;
    ordered.push(params[index]);
    return "?";
  });
  return { sql, params: ordered };
}

function normalizeSql(text) {
  return String(text)
    .replace(/::(?:integer|int|varchar|text|numeric|bigint|boolean|jsonb)/gi, "")
    .replace(/\bFOR\s+UPDATE\b/gi, "")
    .replace(/NOW\(\)\s*-\s*INTERVAL\s+'45 seconds'/gi, "datetime('now','-45 seconds')")
    .replace(/\bNOW\(\)/gi, "datetime('now')");
}

function execute(text, params = []) {
  let sql = normalizeSql(text);
  const bound = bindPostgresParams(sql, params);
  sql = bound.sql;

  try {
    if (!bound.params.length && /;\s*\S/.test(sql.trim().replace(/;\s*$/, ""))) {
      database.exec(sql);
      return { rows: [], rowCount: 0, command: "" };
    }

    const trimmed = sql.trim();
    if (/^(SELECT|WITH|PRAGMA)\b/i.test(trimmed) || /\bRETURNING\b/i.test(trimmed)) {
      const rows = database.prepare(sql).all(...bound.params);
      return { rows, rowCount: rows.length, command: "" };
    }

    if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(trimmed)) {
      database.exec(sql);
      return { rows: [], rowCount: 0, command: trimmed.split(/\s+/)[0].toUpperCase() };
    }

    const result = database.prepare(sql).run(...bound.params);
    return { rows: [], rowCount: Number(result.changes || 0), command: "" };
  } catch (error) {
    throw sqliteError(error);
  }
}

export async function query(text, params = []) {
  return execute(text, params);
}

const client = {
  query,
  release() {}
};

export const pool = {
  query,
  async connect() { return client; },
  async end() { database.close(); }
};

process.once("SIGINT", () => { try { database.close(); } catch {} });
process.once("SIGTERM", () => { try { database.close(); } catch {} });
