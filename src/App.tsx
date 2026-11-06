import {
  type DragEvent,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CloseIcon,
  CrystalMark,
  DownloadIcon,
  FileIcon,
  MergeIcon,
  SearchIcon,
  TrashIcon,
  UploadIcon,
} from "./components/Icons";
import { getSqlJs } from "./core/sqlRuntime";
import {
  type MergeResult,
  type ParsedSave,
  mergeSaves,
  parseSave,
} from "./core/st3";

const MAX_FILE_SIZE = 80 * 1024 * 1024;

interface Toast {
  kind: "error" | "success";
  message: string;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatScore(score: number) {
  return new Intl.NumberFormat("en-US").format(score);
}

function formatDate(timestamp: number) {
  if (!timestamp || timestamp < 1_000_000_000) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date(timestamp * 1000))
    .replaceAll("/", ".");
}

function localDateStamp() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function createId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "发生了未知错误";
}

function App() {
  const [saves, setSaves] = useState<ParsedSave[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [result, setResult] = useState<MergeResult | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [query, setQuery] = useState("");
  const [difficulty, setDifficulty] = useState<number | "all">("all");
  const [visibleLimit, setVisibleLimit] = useState(100);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const difficulties = useMemo(
    () =>
      result
        ? [...new Set(result.rows.map((row) => row.songDifficulty))].sort(
            (left, right) => left - right,
          )
        : [],
    [result],
  );

  const filteredRows = useMemo(
    () =>
      result?.rows.filter(
        (row) =>
          (difficulty === "all" || row.songDifficulty === difficulty) &&
          (!deferredQuery ||
            `${row.songId} ${row.sourceName}`.toLowerCase().includes(deferredQuery)),
      ) ?? [],
    [result, difficulty, deferredQuery],
  );

  useEffect(() => {
    setVisibleLimit(100);
  }, [deferredQuery, difficulty, result]);

  async function addFiles(fileList: FileList | File[]) {
    const incoming = Array.from(fileList);
    if (!incoming.length) return;
    setIsParsing(true);
    const accepted: ParsedSave[] = [];
    const issues: string[] = [];

    try {
      const SQL = await getSqlJs();
      for (const file of incoming) {
        try {
          if (file.size > MAX_FILE_SIZE) {
            throw new Error(`${file.name} 超过 80 MB 限制`);
          }
          const bytes = new Uint8Array(await file.arrayBuffer());
          accepted.push(parseSave(createId(), file.name, bytes, SQL));
        } catch (error) {
          issues.push(`${file.name}：${errorMessage(error)}`);
        }
      }
    } catch (error) {
      issues.push(`SQLite 引擎加载失败：${errorMessage(error)}`);
    }

    if (accepted.length) {
      setSaves((current) => {
        const fingerprints = new Set(
          current.map((save) => `${save.name}\u0000${save.size}`),
        );
        const unique = accepted.filter((save) => {
          const fingerprint = `${save.name}\u0000${save.size}`;
          if (fingerprints.has(fingerprint)) return false;
          fingerprints.add(fingerprint);
          return true;
        });
        if (unique.length < accepted.length) {
          issues.push("已跳过重复文件");
        }
        return [...current, ...unique];
      });
      setResult(null);
    }

    if (issues.length) {
      setToast({ kind: "error", message: issues.join("；") });
    } else if (accepted.length) {
      setToast({ kind: "success", message: `已读取 ${accepted.length} 个存档` });
    }
    setIsParsing(false);
  }

  async function merge() {
    if (saves.length < 2) return;
    setIsMerging(true);
    try {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const SQL = await getSqlJs();
      const merged = mergeSaves(saves, SQL);
      setResult(merged);
      setToast({
        kind: "success",
        message: `已合并 ${merged.stats.totalCharts} 个谱面`,
      });
      window.setTimeout(() => {
        resultRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 60);
    } catch (error) {
      setToast({ kind: "error", message: `合并失败：${errorMessage(error)}` });
    } finally {
      setIsMerging(false);
    }
  }

  function downloadResult() {
    if (!result) return;
    const blob = new Blob([result.bytes], {
      type: "application/vnd.sqlite3",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `Arcaea_merged_${localDateStamp()}.st3`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function removeSave(id: string) {
    setSaves((current) => current.filter((save) => save.id !== id));
    setResult(null);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    void addFiles(event.dataTransfer.files);
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#" aria-label="Arc Merge 首页">
          <CrystalMark className="brand-mark" />
          <span>ARC/MERGE</span>
        </a>
        <span className="local-status">
          <span />
          本地处理
        </span>
      </header>

      <main>
        <section className="intro">
          <h1>Arcaea 存档合并</h1>
          <p>上传两个或更多 st3，每个谱面保留最高成绩。</p>
        </section>

        <section className="workspace" aria-labelledby="workspace-title">
          <div className="section-heading">
            <h2 id="workspace-title">存档</h2>
            <span>{saves.length ? `${saves.length} 个文件` : "等待上传"}</span>
          </div>

          <div
            className={`drop-zone ${isDragging ? "is-dragging" : ""} ${
              isParsing ? "is-busy" : ""
            }`}
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                setIsDragging(false);
              }
            }}
            onDrop={handleDrop}
          >
            <UploadIcon />
            <div>
              <strong>{isParsing ? "正在读取…" : "拖入 st3 存档"}</strong>
              <span>支持一次选择多个文件</span>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isParsing}
            >
              选择文件
            </button>
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              accept=".st3,application/vnd.sqlite3,application/x-sqlite3"
              multiple
              onChange={(event) => {
                if (event.target.files) void addFiles(event.target.files);
                event.target.value = "";
              }}
              aria-label="选择 Arcaea st3 存档"
            />
          </div>

          {saves.length > 0 && (
            <div className="file-list" aria-label="已上传存档">
              {saves.map((save, index) => (
                <div className="file-row" key={save.id}>
                  <span className="file-index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <FileIcon />
                  <div className="file-details">
                    <strong title={save.name}>{save.name}</strong>
                    <span>
                      {save.scoreCount.toLocaleString()} 条成绩 ·{" "}
                      {formatBytes(save.size)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => removeSave(save.id)}
                    aria-label={`移除 ${save.name}`}
                  >
                    <TrashIcon />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="action-bar">
            <span>
              {saves.length < 2
                ? "至少需要 2 个存档"
                : `准备合并 ${saves.length} 个存档`}
            </span>
            <button
              type="button"
              className="primary-button"
              disabled={saves.length < 2 || isMerging || isParsing}
              onClick={() => void merge()}
            >
              {isMerging ? (
                <>
                  <span className="spinner" />
                  正在合并
                </>
              ) : (
                <>
                  <MergeIcon />
                  合并
                </>
              )}
            </button>
          </div>
        </section>

        {result && (
          <section
            className="results"
            ref={resultRef}
            aria-labelledby="results-title"
          >
            <div className="results-heading">
              <div>
                <h2 id="results-title">合并结果</h2>
                <span>全部字段直接来自上传的存档</span>
              </div>
              <button
                type="button"
                className="primary-button download-button"
                onClick={downloadResult}
              >
                <DownloadIcon />
                导出 st3
              </button>
            </div>

            <div className="result-stats">
              <div>
                <span>谱面</span>
                <strong>{result.stats.totalCharts.toLocaleString()}</strong>
              </div>
              <div>
                <span>songId</span>
                <strong>{result.stats.totalSongs.toLocaleString()}</strong>
              </div>
              <div>
                <span>最高分</span>
                <strong>{formatScore(result.stats.maxScore)}</strong>
              </div>
            </div>

            <div className="toolbar">
              <label className="search-field">
                <SearchIcon />
                <span className="visually-hidden">搜索 songId 或来源文件</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索 songId 或来源文件"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="清除搜索"
                  >
                    <CloseIcon />
                  </button>
                )}
              </label>

              <label className="select-field">
                <span>难度代码</span>
                <select
                  value={difficulty}
                  onChange={(event) =>
                    setDifficulty(
                      event.target.value === "all"
                        ? "all"
                        : Number(event.target.value),
                    )
                  }
                >
                  <option value="all">全部</option>
                  {difficulties.map((value) => (
                    <option value={value} key={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="table-frame">
              <table>
                <thead>
                  <tr>
                    <th>songId</th>
                    <th>难度</th>
                    <th>ct</th>
                    <th>分数</th>
                    <th>clearType</th>
                    <th>日期</th>
                    <th>来源</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.slice(0, visibleLimit).map((row) => (
                    <tr key={row.key}>
                      <td>
                        <strong className="song-id">{row.songId}</strong>
                      </td>
                      <td>{row.songDifficulty}</td>
                      <td>{row.ct}</td>
                      <td>
                        <strong className="score">{formatScore(row.score)}</strong>
                      </td>
                      <td>{row.clearType ?? "—"}</td>
                      <td>{formatDate(row.date)}</td>
                      <td>
                        <span className="source-name" title={row.sourceName}>
                          {row.sourceName}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {!filteredRows.length && (
                <div className="table-empty">没有匹配的谱面</div>
              )}
            </div>

            <div className="table-footer">
              <span>
                {Math.min(filteredRows.length, visibleLimit).toLocaleString()} /{" "}
                {filteredRows.length.toLocaleString()}
              </span>
              {visibleLimit < filteredRows.length && (
                <button
                  type="button"
                  onClick={() => setVisibleLimit((value) => value + 100)}
                >
                  显示更多
                </button>
              )}
            </div>
          </section>
        )}
      </main>

      <footer>
        <span>本项目由 DeepSeek 生成</span>
        <span>非官方工具 · 文件仅在浏览器本地处理</span>
      </footer>

      {toast && (
        <div
          className={`toast toast-${toast.kind}`}
          role="status"
          aria-live="polite"
        >
          <p>{toast.message}</p>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="关闭提示"
          >
            <CloseIcon />
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
