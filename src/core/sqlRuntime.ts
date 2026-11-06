import initSqlJs from "sql.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";

let sqlPromise: ReturnType<typeof initSqlJs> | null = null;

export function getSqlJs() {
  sqlPromise ??= initSqlJs({
    locateFile: () => sqlWasmUrl,
  });
  return sqlPromise;
}
