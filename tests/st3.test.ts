import { createRequire } from "node:module";
import { resolve } from "node:path";
import initSqlJs, { type SqlJsStatic } from "sql.js";
import { beforeAll, describe, expect, it } from "vitest";
import { mergeSaves, parseSave } from "../src/core/st3";

const require = createRequire(import.meta.url);
const sqlWasmDirectory = resolve(
  require.resolve("sql.js/package.json"),
  "../dist",
);

interface FixtureScore {
  songId: string;
  difficulty: number;
  ct?: number;
  score: number;
  clearType: number;
  date?: number;
}

let SQL: SqlJsStatic;

beforeAll(async () => {
  SQL = await initSqlJs({
    locateFile: (file) => resolve(sqlWasmDirectory, file),
  });
});

function makeSave(scores: FixtureScore[], options?: { legacy?: boolean }) {
  const db = new SQL.Database();
  const legacy = options?.legacy ?? false;
  db.run(`
    CREATE TABLE scores (
      id INTEGER PRIMARY KEY,
      version TEXT NOT NULL DEFAULT '',
      score INTEGER NOT NULL,
      shinyPerfectCount INTEGER NOT NULL DEFAULT 0,
      perfectCount INTEGER NOT NULL DEFAULT 0,
      nearCount INTEGER NOT NULL DEFAULT 0,
      missCount INTEGER NOT NULL DEFAULT 0,
      date INTEGER NOT NULL DEFAULT 0,
      songId TEXT NOT NULL,
      songDifficulty INTEGER NOT NULL,
      modifier INTEGER NOT NULL DEFAULT 0,
      health INTEGER NOT NULL DEFAULT 0
      ${legacy ? "" : ", ct INTEGER NOT NULL DEFAULT 0"}
    );
    CREATE TABLE cleartypes (
      id INTEGER PRIMARY KEY,
      songId TEXT NOT NULL,
      songDifficulty INTEGER NOT NULL,
      clearType INTEGER NOT NULL
      ${legacy ? "" : ", ct INTEGER NOT NULL DEFAULT 0"}
    );
  `);
  if (!legacy) {
    db.run("CREATE TABLE schemaversion (appliedVersion INTEGER NOT NULL)");
    db.run("INSERT INTO schemaversion VALUES (4)");
  }

  for (const item of scores) {
    const ct = item.ct ?? 0;
    const columns = legacy
      ? "version,score,shinyPerfectCount,perfectCount,nearCount,missCount,date,songId,songDifficulty,modifier,health"
      : "version,score,shinyPerfectCount,perfectCount,nearCount,missCount,date,songId,songDifficulty,modifier,health,ct";
    const placeholders = columns.split(",").map(() => "?").join(",");
    const values = [
      "4.0",
      item.score,
      0,
      100,
      0,
      0,
      item.date ?? 1_700_000_000,
      item.songId,
      item.difficulty,
      0,
      0,
    ];
    if (!legacy) values.push(ct);
    db.run(`INSERT INTO scores (${columns}) VALUES (${placeholders})`, values);

    const clearColumns = legacy
      ? "songId,songDifficulty,clearType"
      : "songId,songDifficulty,clearType,ct";
    const clearValues: Array<string | number> = [
      item.songId,
      item.difficulty,
      item.clearType,
    ];
    if (!legacy) clearValues.push(ct);
    db.run(
      `INSERT INTO cleartypes (${clearColumns}) VALUES (${clearColumns
        .split(",")
        .map(() => "?")
        .join(",")})`,
      clearValues,
    );
  }

  const bytes = db.export();
  db.close();
  return bytes;
}

describe("st3 parsing and merging", () => {
  it("keeps separate control types and merges every score by chart key", () => {
    const first = parseSave(
      "first",
      "first.st3",
      makeSave([
        {
          songId: "alpha",
          difficulty: 2,
          score: 9_800_000,
          clearType: 2,
          date: 1_700_000_100,
        },
        {
          songId: "beta",
          difficulty: 2,
          score: 9_100_000,
          clearType: 1,
          date: 1_700_000_100,
        },
        {
          songId: "duo",
          difficulty: 2,
          ct: 0,
          score: 8_900_000,
          clearType: 1,
          date: 1_700_000_100,
        },
      ]),
      SQL,
    );
    const second = parseSave(
      "second",
      "second.st3",
      makeSave([
        {
          songId: "alpha",
          difficulty: 2,
          score: 9_950_000,
          clearType: 5,
          date: 1_700_000_200,
        },
        {
          songId: "beta",
          difficulty: 2,
          score: 9_100_000,
          clearType: 3,
          date: 1_700_000_100,
        },
        {
          songId: "gamma",
          difficulty: 3,
          score: 9_250_000,
          clearType: 1,
          date: 1_700_000_300,
        },
        {
          songId: "duo",
          difficulty: 2,
          ct: 1,
          score: 9_500_000,
          clearType: 4,
          date: 1_700_000_300,
        },
      ]),
      SQL,
    );

    const result = mergeSaves([first, second], SQL);
    expect(result.stats).toEqual({
      totalCharts: 5,
      totalSongs: 4,
      maxScore: 9_950_000,
    });

    const merged = parseSave("merged", "merged.st3", result.bytes, SQL);
    expect(merged.scores.size).toBe(5);
    expect(
      [...merged.scores.values()].find(
        (row) => row.songId === "alpha" && row.ct === 0,
      )?.score,
    ).toBe(9_950_000);
    expect(
      [...merged.clears.values()].find(
        (row) => row.songId === "alpha" && row.ct === 0,
      )?.clearType,
    ).toBe(5);
    expect(
      [...merged.scores.values()].find(
        (row) => row.songId === "duo" && row.ct === 0,
      )?.score,
    ).toBe(8_900_000);
    expect(
      [...merged.scores.values()].find(
        (row) => row.songId === "duo" && row.ct === 1,
      )?.score,
    ).toBe(9_500_000);
    expect(
      [...merged.clears.values()].find(
        (row) => row.songId === "beta" && row.ct === 0,
      )?.clearType,
    ).toBe(3);
    expect(merged.schemaVersion).toBe(4);

    const reversed = mergeSaves([second, first], SQL);
    expect(
      reversed.rows.map(({ songId, songDifficulty, ct, score, clearType }) => ({
        songId,
        songDifficulty,
        ct,
        score,
        clearType,
      })),
    ).toEqual(
      result.rows.map(({ songId, songDifficulty, ct, score, clearType }) => ({
        songId,
        songDifficulty,
        ct,
        score,
        clearType,
      })),
    );
  });

  it("merges legacy databases without a ct column", () => {
    const first = parseSave(
      "legacy-a",
      "legacy-a.st3",
      makeSave(
        [
          {
            songId: "legacy",
            difficulty: 1,
            score: 9_000_000,
            clearType: 1,
          },
        ],
        { legacy: true },
      ),
      SQL,
    );
    const second = parseSave(
      "legacy-b",
      "legacy-b.st3",
      makeSave(
        [
          {
            songId: "legacy",
            difficulty: 1,
            score: 9_600_000,
            clearType: 3,
          },
          {
            songId: "new-song",
            difficulty: 0,
            score: 9_100_000,
            clearType: 1,
          },
        ],
        { legacy: true },
      ),
      SQL,
    );

    const result = mergeSaves([first, second], SQL);
    const merged = parseSave(
      "legacy-merged",
      "legacy-merged.st3",
      result.bytes,
      SQL,
    );
    expect(merged.scores.size).toBe(2);
    expect(
      [...merged.scores.values()].find((row) => row.songId === "legacy")
        ?.score,
    ).toBe(9_600_000);
    expect(merged.clearColumns).not.toContain("ct");
  });

  it("rejects non-SQLite files and databases without an Arcaea schema", () => {
    expect(() =>
      parseSave("bad", "bad.st3", new Uint8Array(200).fill(1), SQL),
    ).toThrow(/SQLite/);

    const empty = new SQL.Database();
    empty.run("CREATE TABLE unrelated (value TEXT)");
    const bytes = empty.export();
    empty.close();
    expect(() => parseSave("empty", "empty.st3", bytes, SQL)).toThrow(
      /scores/,
    );
  });
});
