import type { Database, SqlJsStatic, SqlValue } from "sql.js";

const SQLITE_MAGIC = "SQLite format 3\0";
const SCORE_CORE_COLUMNS = [
  "version",
  "score",
  "shinyPerfectCount",
  "perfectCount",
  "nearCount",
  "missCount",
  "date",
  "songId",
  "songDifficulty",
  "modifier",
  "health",
  "ct",
] as const;

type SqlRecord = Record<string, SqlValue | undefined>;

export interface ScoreRow extends SqlRecord {
  id?: SqlValue;
  songId: string;
  songDifficulty: number;
  ct: number;
  score: number;
  shinyPerfectCount: number;
  perfectCount: number;
  nearCount: number;
  missCount: number;
  date: number;
}

export interface ClearRow extends SqlRecord {
  id?: SqlValue;
  songId: string;
  songDifficulty: number;
  clearType: number;
  ct: number;
}

interface ColumnInfo {
  name: string;
  notnull: number;
  dflt_value: SqlValue;
  pk: number;
}

export interface ParsedSave {
  id: string;
  name: string;
  bytes: Uint8Array;
  size: number;
  schemaVersion: number | null;
  scoreColumns: string[];
  clearColumns: string[];
  scores: Map<string, ScoreRow>;
  clears: Map<string, ClearRow>;
  scoreCount: number;
  chartCount: number;
}

export interface MergedChart {
  key: string;
  songId: string;
  songDifficulty: number;
  ct: number;
  score: number;
  clearType: number | null;
  date: number;
  sourceId: string;
  sourceName: string;
}

export interface MergeStats {
  totalCharts: number;
  totalSongs: number;
  maxScore: number;
}

export interface MergeResult {
  bytes: Uint8Array;
  rows: MergedChart[];
  stats: MergeStats;
  schemaVersion: number | null;
}

interface Winner {
  row: ScoreRow;
  clearType: number | null;
  sourceId: string;
  sourceName: string;
}

function queryObjects(db: Database, sql: string, params: SqlValue[] = []): SqlRecord[] {
  const statement = db.prepare(sql);
  const rows: SqlRecord[] = [];
  try {
    if (params.length) statement.bind(params);
    while (statement.step()) rows.push(statement.getAsObject());
  } finally {
    statement.free();
  }
  return rows;
}

function firstValue(db: Database, sql: string): SqlValue {
  const rows = queryObjects(db, sql);
  if (!rows.length) return null;
  return Object.values(rows[0])[0] ?? null;
}

function readSchemaVersion(db: Database): number | null {
  const table = queryObjects(
    db,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND lower(name) = 'schemaversion'",
  );
  if (!table.length) return null;
  const value = firstValue(db, "SELECT MAX(appliedVersion) FROM schemaversion");
  return value !== null && Number.isFinite(Number(value)) ? Number(value) : null;
}

function asInteger(value: SqlValue | undefined, label: string): number {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`${label} 不是有效数字`);
  return Math.trunc(result);
}

function asText(value: SqlValue | undefined, label: string): string {
  if (value === null || value === undefined || value === "") {
    throw new Error(`${label} 不能为空`);
  }
  return String(value);
}

function tableInfo(db: Database, table: "scores" | "cleartypes"): ColumnInfo[] {
  return queryObjects(db, `PRAGMA table_info(${table})`).map((row) => ({
    name: String(row.name ?? ""),
    notnull: Number(row.notnull ?? 0),
    dflt_value: row.dflt_value ?? null,
    pk: Number(row.pk ?? 0),
  }));
}

function requireColumns(columns: string[], required: string[], table: string) {
  const missing = required.filter((column) => !columns.includes(column));
  if (missing.length) {
    throw new Error(`${table} 表缺少字段：${missing.join(", ")}`);
  }
}

function chartKey(songId: string, difficulty: number, ct: number, includeCt: boolean) {
  return includeCt
    ? `${songId}\u0000${difficulty}\u0000${ct}`
    : `${songId}\u0000${difficulty}`;
}

function normalizeScore(row: SqlRecord, hasCt: boolean): ScoreRow {
  return {
    ...row,
    songId: asText(row.songId, "songId"),
    songDifficulty: asInteger(row.songDifficulty, "songDifficulty"),
    ct: hasCt ? asInteger(row.ct, "ct") : 0,
    score: asInteger(row.score, "score"),
    shinyPerfectCount: asInteger(row.shinyPerfectCount ?? 0, "shinyPerfectCount"),
    perfectCount: asInteger(row.perfectCount ?? 0, "perfectCount"),
    nearCount: asInteger(row.nearCount ?? 0, "nearCount"),
    missCount: asInteger(row.missCount ?? 0, "missCount"),
    date: asInteger(row.date ?? 0, "date"),
  };
}

function normalizeClear(row: SqlRecord, hasCt: boolean): ClearRow {
  return {
    ...row,
    songId: asText(row.songId, "songId"),
    songDifficulty: asInteger(row.songDifficulty, "songDifficulty"),
    clearType: asInteger(row.clearType, "clearType"),
    ct: hasCt ? asInteger(row.ct, "ct") : 0,
  };
}

function findClear(source: ParsedSave, row: ScoreRow): number | null {
  return findClearRow(source, row)?.clearType ?? null;
}

function findClearRow(source: ParsedSave, row: ScoreRow): ClearRow | null {
  const includeCt = source.clearColumns.includes("ct");
  return (
    source.clears.get(chartKey(row.songId, row.songDifficulty, row.ct, includeCt)) ??
    source.clears.get(chartKey(row.songId, row.songDifficulty, 0, false)) ??
    null
  );
}

function compareWinner(candidate: Winner, current: Winner | undefined): boolean {
  if (!current) return true;
  if (candidate.row.score !== current.row.score) {
    return candidate.row.score > current.row.score;
  }
  const candidateClear = candidate.clearType ?? -1;
  const currentClear = current.clearType ?? -1;
  if (candidateClear !== currentClear) return candidateClear > currentClear;
  if (candidate.row.date !== current.row.date) {
    return candidate.row.date > current.row.date;
  }
  if (candidate.row.missCount !== current.row.missCount) {
    return candidate.row.missCount < current.row.missCount;
  }
  if (candidate.row.nearCount !== current.row.nearCount) {
    return candidate.row.nearCount < current.row.nearCount;
  }
  if (candidate.row.shinyPerfectCount !== current.row.shinyPerfectCount) {
    return candidate.row.shinyPerfectCount > current.row.shinyPerfectCount;
  }
  if (candidate.row.perfectCount !== current.row.perfectCount) {
    return candidate.row.perfectCount > current.row.perfectCount;
  }
  if (candidate.sourceName !== current.sourceName) {
    return candidate.sourceName.localeCompare(current.sourceName) < 0;
  }
  return false;
}

function quoteIdentifier(name: string) {
  return `"${name.replaceAll('"', '""')}"`;
}

function sameScoreRecord(left: ScoreRow, right: ScoreRow) {
  return SCORE_CORE_COLUMNS.every((column) => left[column] === right[column]);
}

export function parseSave(
  id: string,
  name: string,
  bytes: Uint8Array,
  SQL: SqlJsStatic,
): ParsedSave {
  if (bytes.byteLength < 100) {
    throw new Error("文件体积过小，不是有效的 st3 存档");
  }
  const header = new TextDecoder("ascii").decode(bytes.subarray(0, 16));
  if (header !== SQLITE_MAGIC) {
    throw new Error("文件头不是 SQLite 3，请选择 Arcaea 的 st3 文件");
  }

  const db = new SQL.Database(bytes);
  try {
    const tableRows = queryObjects(
      db,
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    );
    const tableNames = new Set(
      tableRows.map((row) => String(row.name ?? "").toLowerCase()),
    );
    if (!tableNames.has("scores") || !tableNames.has("cleartypes")) {
      throw new Error("未找到 scores / cleartypes 表，这不是 Arcaea 成绩存档");
    }

    const quickCheck = String(firstValue(db, "PRAGMA quick_check") ?? "");
    if (quickCheck !== "ok") {
      throw new Error(`SQLite 完整性检查失败：${quickCheck || "未知错误"}`);
    }

    const scoreInfo = tableInfo(db, "scores");
    const clearInfo = tableInfo(db, "cleartypes");
    const scoreColumns = scoreInfo.map((column) => column.name);
    const clearColumns = clearInfo.map((column) => column.name);
    requireColumns(scoreColumns, ["songId", "songDifficulty", "score"], "scores");
    requireColumns(clearColumns, ["songId", "songDifficulty", "clearType"], "cleartypes");

    const hasScoreCt = scoreColumns.includes("ct");
    const hasClearCt = clearColumns.includes("ct");
    const scores = new Map<string, ScoreRow>();
    for (const raw of queryObjects(db, "SELECT * FROM scores")) {
      const row = normalizeScore(raw, hasScoreCt);
      const key = chartKey(row.songId, row.songDifficulty, row.ct, hasScoreCt);
      if (scores.has(key)) {
        throw new Error(`scores 中出现了重复谱面主键：${row.songId}`);
      }
      scores.set(key, row);
    }

    const clears = new Map<string, ClearRow>();
    for (const raw of queryObjects(db, "SELECT * FROM cleartypes")) {
      const row = normalizeClear(raw, hasClearCt);
      const key = chartKey(row.songId, row.songDifficulty, row.ct, hasClearCt);
      if (clears.has(key)) {
        throw new Error(`cleartypes 中出现了重复谱面主键：${row.songId}`);
      }
      clears.set(key, row);
    }

    return {
      id,
      name,
      bytes: new Uint8Array(bytes),
      size: bytes.byteLength,
      schemaVersion: readSchemaVersion(db),
      scoreColumns,
      clearColumns,
      scores,
      clears,
      scoreCount: scores.size,
      chartCount: new Set(
        [...scores.values()].map((row) => `${row.songId}\u0000${row.songDifficulty}`),
      ).size,
    };
  } finally {
    db.close();
  }
}

function normalizedSourceView(source: ParsedSave, includeCt: boolean) {
  const scores = new Map<string, ScoreRow>();
  for (const row of source.scores.values()) {
    const key = chartKey(row.songId, row.songDifficulty, row.ct, includeCt);
    const existing = scores.get(key);
    if (
      !existing ||
      compareWinner(
        {
          row,
          clearType: findClear(source, row),
          sourceId: source.id,
          sourceName: source.name,
        },
        {
          row: existing,
          clearType: findClear(source, existing),
          sourceId: source.id,
          sourceName: source.name,
        },
      )
    ) {
      scores.set(key, row);
    }
  }
  return scores;
}

function insertableColumns(
  info: ColumnInfo[],
  row: ScoreRow | ClearRow,
  targetCt: number,
) {
  const values = new Map<string, SqlValue>();
  for (const column of info) {
    if (column.pk > 0 || column.name === "id") continue;
    if (Object.prototype.hasOwnProperty.call(row, column.name)) {
      values.set(column.name, row[column.name] ?? null);
    } else if (column.name === "ct") {
      values.set("ct", targetCt);
    }
  }
  return values;
}

function missingRequiredInsertColumns(info: ColumnInfo[], values: Map<string, SqlValue>) {
  return info
    .filter(
      (column) =>
        column.pk === 0 &&
        column.name !== "id" &&
        column.notnull === 1 &&
        column.dflt_value === null &&
        !values.has(column.name),
    )
    .map((column) => column.name);
}

function chooseSchemaSource(sources: ParsedSave[]) {
  return [...sources].sort((left, right) => {
    const leftCt = Number(left.scoreColumns.includes("ct"));
    const rightCt = Number(right.scoreColumns.includes("ct"));
    return (
      rightCt - leftCt ||
      (right.schemaVersion ?? 0) - (left.schemaVersion ?? 0) ||
      right.scoreCount - left.scoreCount ||
      left.name.localeCompare(right.name)
    );
  })[0];
}

export function mergeSaves(sources: ParsedSave[], SQL: SqlJsStatic): MergeResult {
  if (sources.length < 2) {
    throw new Error("至少需要两个存档才能合并");
  }

  // This is only the SQLite schema container. Score selection is symmetric.
  const schemaSource = chooseSchemaSource(sources);
  const db = new SQL.Database(schemaSource.bytes);

  try {
    const scoreInfo = tableInfo(db, "scores");
    const clearInfo = tableInfo(db, "cleartypes");
    const includeScoreCt = scoreInfo.some((column) => column.name === "ct");
    const includeClearCt = clearInfo.some((column) => column.name === "ct");
    const winners = new Map<string, Winner>();

    for (const source of sources) {
      for (const [key, row] of normalizedSourceView(source, includeScoreCt)) {
        const candidate: Winner = {
          row,
          clearType: findClear(source, row),
          sourceId: source.id,
          sourceName: source.name,
        };
        if (compareWinner(candidate, winners.get(key))) {
          winners.set(key, candidate);
        }
      }
    }

    const sourceById = new Map(sources.map((source) => [source.id, source]));
    const outputView = normalizedSourceView(schemaSource, includeScoreCt);
    const clearInserted = new Set<string>();

    db.run("BEGIN IMMEDIATE");
    try {
      for (const [key, winner] of winners) {
        const outputRow = outputView.get(key);
        if (!outputRow) {
          const values = insertableColumns(scoreInfo, winner.row, winner.row.ct);
          const missing = missingRequiredInsertColumns(scoreInfo, values);
          if (missing.length) {
            throw new Error(
              `无法补入 ${winner.row.songId}：缺少字段 ${missing.join(", ")} 的默认值`,
            );
          }
          const columns = [...values.keys()];
          db.run(
            `INSERT INTO scores (${columns.map(quoteIdentifier).join(", ")}) VALUES (${columns
              .map(() => "?")
              .join(", ")})`,
            [...values.values()],
          );
        } else if (!sameScoreRecord(winner.row, outputRow)) {
          const assignments: string[] = [];
          const values: SqlValue[] = [];
          for (const column of scoreInfo) {
            if (column.pk > 0 || column.name === "id") continue;
            if (!Object.prototype.hasOwnProperty.call(winner.row, column.name)) continue;
            assignments.push(`${quoteIdentifier(column.name)} = ?`);
            values.push(winner.row[column.name] ?? null);
          }
          values.push(winner.row.songId, winner.row.songDifficulty);
          if (includeScoreCt) values.push(winner.row.ct);
          db.run(
            `UPDATE scores SET ${assignments.join(", ")} WHERE songId = ? AND songDifficulty = ?${
              includeScoreCt ? " AND ct = ?" : ""
            }`,
            values,
          );
        }

        if (winner.clearType === null) continue;
        const winningSource = sourceById.get(winner.sourceId);
        const sourceClearRow = winningSource
          ? findClearRow(winningSource, winner.row)
          : null;
        if (!sourceClearRow) continue;

        const clearKey = chartKey(
          winner.row.songId,
          winner.row.songDifficulty,
          winner.row.ct,
          includeClearCt,
        );
        const existingClear = queryObjects(
          db,
          `SELECT id FROM cleartypes WHERE songId = ? AND songDifficulty = ?${
            includeClearCt ? " AND ct = ?" : ""
          } LIMIT 1`,
          includeClearCt
            ? [winner.row.songId, winner.row.songDifficulty, winner.row.ct]
            : [winner.row.songId, winner.row.songDifficulty],
        );

        if (!existingClear.length && !clearInserted.has(clearKey)) {
          const clearValues = insertableColumns(
            clearInfo,
            sourceClearRow,
            winner.row.ct,
          );
          const missing = missingRequiredInsertColumns(clearInfo, clearValues);
          if (missing.length) {
            throw new Error(
              `无法写入 ${winner.row.songId} 的通关类型：缺少字段 ${missing.join(", ")}`,
            );
          }
          const columns = [...clearValues.keys()];
          db.run(
            `INSERT INTO cleartypes (${columns.map(quoteIdentifier).join(", ")}) VALUES (${columns
              .map(() => "?")
              .join(", ")})`,
            [...clearValues.values()],
          );
          clearInserted.add(clearKey);
        } else {
          const values: SqlValue[] = [sourceClearRow.clearType];
          let sql = "UPDATE cleartypes SET clearType = ?";
          if (includeClearCt) {
            sql += ", ct = ?";
            values.push(winner.row.ct);
          }
          sql += " WHERE songId = ? AND songDifficulty = ?";
          values.push(winner.row.songId, winner.row.songDifficulty);
          if (includeClearCt) {
            sql += " AND ct = ?";
            values.push(winner.row.ct);
          }
          db.run(sql, values);
        }
      }

      const quickCheck = String(firstValue(db, "PRAGMA quick_check") ?? "");
      if (quickCheck !== "ok") {
        throw new Error(`合并结果未通过 SQLite 完整性检查：${quickCheck}`);
      }
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }

    const rows: MergedChart[] = [...winners.entries()]
      .map(([key, winner]) => ({
        key,
        songId: winner.row.songId,
        songDifficulty: winner.row.songDifficulty,
        ct: winner.row.ct,
        score: winner.row.score,
        clearType: winner.clearType,
        date: winner.row.date,
        sourceId: winner.sourceId,
        sourceName: winner.sourceName,
      }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.songId.localeCompare(right.songId) ||
          left.songDifficulty - right.songDifficulty ||
          left.ct - right.ct,
      );

    return {
      bytes: db.export(),
      rows,
      stats: {
        totalCharts: winners.size,
        totalSongs: new Set(rows.map((row) => row.songId)).size,
        maxScore: rows[0]?.score ?? 0,
      },
      schemaVersion: readSchemaVersion(db),
    };
  } finally {
    db.close();
  }
}
