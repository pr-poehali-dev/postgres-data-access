import { useState, useRef, useEffect, useCallback } from "react";
import Icon from "@/components/ui/icon";
import { dbApi, ApiColumn, ApiRow, ApiCell } from "@/lib/dbApi";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Connection {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  user: string;
  color: string;
  status: "connected" | "disconnected" | "error";
  dsn: string;
}

interface TableSchema {
  name: string;
  schema: string;
  rows: number;
}

const STORAGE_KEY = "querybase_connections";

const DEFAULT_CONNECTIONS: Connection[] = [
  { id: "project", name: "База проекта", host: "poehali", port: 5432, database: "project_db", user: "app", color: "#22c55e", status: "disconnected", dsn: "project" },
];

function loadConnections(): Connection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return DEFAULT_CONNECTIONS;
}

const SQL_KEYWORDS = ["SELECT", "FROM", "WHERE", "JOIN", "LEFT", "INNER", "ON", "AND", "OR", "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "CREATE", "TABLE", "INDEX", "ORDER", "BY", "GROUP", "HAVING", "LIMIT", "OFFSET", "NOT", "NULL", "AS", "DISTINCT", "COUNT", "SUM", "AVG", "MAX", "MIN"];

// ─── SQL Highlighter ──────────────────────────────────────────────────────────

function highlightSQL(sql: string): string {
  const escaped = sql.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped
    .replace(/(--[^\n]*)/g, '<span style="color:hsl(215,10%,45%)">$1</span>')
    .replace(/'([^']*)'/g, "<span style=\"color:hsl(120,50%,60%)\">'$1'</span>")
    .replace(/\b(\d+)\b/g, '<span style="color:hsl(35,90%,65%)">$1</span>')
    .replace(new RegExp(`\\b(${SQL_KEYWORDS.join("|")})\\b`, "gi"),
      '<span style="color:hsl(199,89%,65%);font-weight:500">$1</span>');
}

// ─── Status Dot ───────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: Connection["status"] }) {
  const colors: Record<Connection["status"], string> = {
    connected: "bg-green-500",
    disconnected: "bg-gray-500",
    error: "bg-red-500",
  };
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full ${colors[status]} ${status === "connected" ? "shadow-[0_0_4px_1px_rgba(34,197,94,0.5)]" : ""}`}
    />
  );
}

// ─── Connection Item ──────────────────────────────────────────────────────────

function ConnectionItem({ conn, selected, onClick, onEdit, onDelete }: { conn: Connection; selected: boolean; onClick: () => void; onEdit: () => void; onDelete: () => void }) {
  const isProject = conn.id === "project";
  return (
    <div
      onClick={onClick}
      className={`group w-full text-left px-3 py-2 flex items-center gap-2.5 transition-all cursor-pointer ${selected ? "bg-[hsl(var(--sidebar-accent))] text-[hsl(var(--sidebar-accent-foreground))]" : "hover:bg-[hsl(220,13%,13%)] text-[hsl(var(--sidebar-foreground))]"}`}
    >
      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: conn.color }} />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-xs truncate">{conn.name}</div>
        <div className="font-mono-app text-[10px] text-[hsl(var(--muted-foreground))] truncate">{conn.host}/{conn.database}</div>
      </div>
      {!isProject && (
        <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
          <button
            onClick={e => { e.stopPropagation(); onEdit(); }}
            className="p-0.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))] transition-colors"
            title="Редактировать"
          >
            <Icon name="Pencil" size={11} />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            className="p-0.5 text-[hsl(var(--muted-foreground))] hover:text-red-400 transition-colors"
            title="Удалить"
          >
            <Icon name="Trash2" size={11} />
          </button>
        </div>
      )}
      <div className="group-hover:hidden">
        <StatusDot status={conn.status} />
      </div>
    </div>
  );
}

// ─── Table Item ───────────────────────────────────────────────────────────────

function TableItem({ table, selected, onClick }: { table: TableSchema; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 flex items-center gap-2 transition-all ${selected ? "bg-[hsl(var(--sidebar-accent))] text-[hsl(var(--sidebar-accent-foreground))]" : "hover:bg-[hsl(220,13%,13%)] text-[hsl(var(--sidebar-foreground))]"}`}
    >
      <Icon name="Table2" size={12} className="shrink-0 text-[hsl(var(--primary))]" />
      <span className="font-mono-app text-xs flex-1 truncate">{table.name}</span>
      <span className="font-mono-app text-[10px] text-[hsl(var(--muted-foreground))]">{table.rows >= 0 ? table.rows.toLocaleString() : ""}</span>
    </button>
  );
}

// ─── SQL Editor ───────────────────────────────────────────────────────────────

function SQLEditor({ dsn }: { dsn: string }) {
  const [sql, setSql] = useState("SELECT * FROM information_schema.tables\nWHERE table_schema = 'public'\nLIMIT 50;");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ columns: string[]; rows: ApiRow[]; rowCount: number; message?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const sync = () => {
    if (preRef.current && textRef.current) {
      preRef.current.scrollTop = textRef.current.scrollTop;
      preRef.current.scrollLeft = textRef.current.scrollLeft;
    }
  };

  const run = async () => {
    if (!sql.trim()) return;
    setRunning(true);
    setError(null);
    const t0 = performance.now();
    try {
      const res = await dbApi.query(dsn, sql);
      setResult(res);
      setElapsed((performance.now() - t0) / 1000);
    } catch (e) {
      setError((e as Error).message);
      setResult(null);
    } finally {
      setRunning(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); run(); }
    if (e.key === "Tab") {
      e.preventDefault();
      const t = textRef.current!;
      const s = t.selectionStart;
      const en = t.selectionEnd;
      const v = t.value;
      setSql(v.substring(0, s) + "  " + v.substring(en));
      setTimeout(() => { t.selectionStart = t.selectionEnd = s + 2; }, 0);
    }
  };

  const hasResult = result !== null || error !== null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--table-header))]">
        <button
          onClick={run}
          disabled={running}
          className="flex items-center gap-1.5 px-3 py-1 bg-[hsl(var(--primary))] text-[hsl(220,13%,9%)] text-xs font-medium rounded hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          <Icon name={running ? "Loader2" : "Play"} size={12} className={running ? "animate-spin" : ""} />
          {running ? "Выполнение..." : "Выполнить"}
        </button>
        <span className="text-[hsl(var(--muted-foreground))] text-[10px]">Ctrl+Enter</span>
        <div className="flex-1" />
        <button onClick={() => setSql("")} className="p-1 hover:text-red-400 text-[hsl(var(--muted-foreground))] transition-colors">
          <Icon name="Trash2" size={13} />
        </button>
      </div>

      <div className="relative overflow-hidden" style={{ minHeight: 180, flex: hasResult ? "0 0 180px" : "1" }}>
        <pre
          ref={preRef}
          aria-hidden
          className="font-mono-app text-xs absolute inset-0 p-3 m-0 overflow-auto pointer-events-none whitespace-pre leading-5 text-[hsl(var(--foreground))]"
          dangerouslySetInnerHTML={{ __html: highlightSQL(sql) + "\n" }}
        />
        <textarea
          ref={textRef}
          value={sql}
          onChange={e => setSql(e.target.value)}
          onKeyDown={handleKey}
          onScroll={sync}
          className="font-mono-app text-xs absolute inset-0 p-3 w-full h-full resize-none bg-transparent text-transparent caret-[hsl(var(--primary))] outline-none leading-5"
          spellCheck={false}
          placeholder="-- Введите SQL запрос..."
        />
      </div>

      {hasResult && (
        <div className="border-t border-[hsl(var(--border))] flex flex-col animate-fade-in flex-1 overflow-hidden">
          <div className="flex items-center gap-3 px-3 py-1.5 bg-[hsl(var(--table-header))] border-b border-[hsl(var(--border))] shrink-0">
            {error ? (
              <span className="text-red-400 text-xs font-medium flex items-center gap-1.5">
                <Icon name="XCircle" size={12} />Ошибка
              </span>
            ) : (
              <>
                <span className="text-green-400 text-xs font-medium">✓ {result!.rowCount} {result!.message ? "" : "строк"}</span>
                <span className="text-[hsl(var(--muted-foreground))] text-[10px]">{elapsed.toFixed(3)} сек</span>
              </>
            )}
          </div>
          <div className="overflow-auto flex-1">
            {error ? (
              <pre className="font-mono-app text-xs text-red-400 p-3 whitespace-pre-wrap">{error}</pre>
            ) : result!.columns.length === 0 ? (
              <div className="text-xs text-[hsl(var(--muted-foreground))] p-3">{result!.message || "Запрос выполнен"}</div>
            ) : (
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="sticky top-0 bg-[hsl(var(--table-header))]">
                    {result!.columns.map(c => (
                      <th key={c} className="font-mono-app text-left px-3 py-1.5 border-r border-b border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] font-medium text-[11px] whitespace-nowrap">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result!.rows.map((row, i) => (
                    <tr key={i} className="hover:bg-[hsl(220,13%,15%)] border-b" style={{ borderBottomColor: "hsl(220,13%,18%)" }}>
                      {result!.columns.map(c => (
                        <td key={c} className="font-mono-app px-3 py-1 border-r whitespace-nowrap max-w-[260px] truncate" style={{ borderRightColor: "hsl(220,13%,18%)" }}>
                          {row[c] === null ? <span className="text-[hsl(var(--muted-foreground))] italic">NULL</span> : String(row[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Table Editor ─────────────────────────────────────────────────────────────

function TableEditor({ dsn, schema, tableName }: { dsn: string; schema: string; tableName: string }) {
  const [columns, setColumns] = useState<ApiColumn[]>([]);
  const [rows, setRows] = useState<ApiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await dbApi.rows(dsn, schema, tableName, 200, 0);
      setColumns(res.columns);
      setRows(res.rows);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [dsn, schema, tableName]);

  useEffect(() => { load(); }, [load]);

  const pkCol = columns.find(c => c.pk);

  const filteredRows = filter
    ? rows.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(filter.toLowerCase())))
    : rows;

  const startEdit = (rowIdx: number, col: string, val: ApiCell) => {
    setEditingCell({ row: rowIdx, col });
    setEditValue(val === null ? "" : String(val));
  };

  const commitEdit = async () => {
    if (!editingCell) return;
    const { row: rowIdx, col } = editingCell;
    const oldVal = rows[rowIdx][col];
    setEditingCell(null);
    if (String(oldVal ?? "") === editValue) return;

    if (!pkCol) {
      setError("Нет первичного ключа — редактирование недоступно");
      return;
    }
    setSaving(true);
    try {
      await dbApi.update(dsn, schema, tableName, pkCol.name, rows[rowIdx][pkCol.name], col, editValue);
      setRows(prev => prev.map((r, i) => i === rowIdx ? { ...r, [col]: editValue } : r));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-[hsl(var(--muted-foreground))] text-sm">
        <Icon name="Loader2" size={16} className="animate-spin" />Загрузка...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ userSelect: "text" }}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--table-header))] shrink-0">
        <div className="flex items-center gap-1.5 bg-[hsl(var(--input))] border border-[hsl(var(--border))] rounded px-2 py-1">
          <Icon name="Search" size={12} className="text-[hsl(var(--muted-foreground))]" />
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Фильтр..."
            className="bg-transparent text-xs outline-none w-32 text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))]"
          />
        </div>
        <span className="font-mono-app text-[10px] text-[hsl(var(--muted-foreground))]">{schema}.{tableName}</span>
        <div className="flex-1" />
        {saving && (
          <span className="text-yellow-400 text-[10px] flex items-center gap-1">
            <Icon name="Loader2" size={11} className="animate-spin" />Сохранение
          </span>
        )}
        {error && (
          <span className="text-red-400 text-[10px] flex items-center gap-1 max-w-[200px] truncate" title={error}>
            <Icon name="AlertCircle" size={11} />{error}
          </span>
        )}
        <button onClick={load} className="flex items-center gap-1 px-2 py-1 text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))] rounded transition-colors">
          <Icon name="RefreshCw" size={11} />
        </button>
      </div>

      {/* Table */}
      <div className="overflow-auto flex-1">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="sticky top-0 z-10 bg-[hsl(var(--table-header))]">
              <th className="w-8 px-2 py-2 border-r border-b text-[hsl(var(--muted-foreground))] text-[10px]" style={{ borderColor: "hsl(220,13%,18%)" }}>#</th>
              {columns.map(col => (
                <th key={col.name} className="text-left px-3 py-2 border-r border-b font-medium whitespace-nowrap" style={{ borderColor: "hsl(220,13%,18%)", minWidth: 120 }}>
                  <div className="flex items-center gap-1.5">
                    {col.pk && <Icon name="Key" size={10} className="text-yellow-400" />}
                    <span className="font-mono-app text-[11px]">{col.name}</span>
                    <span className="text-[9px] text-[hsl(var(--muted-foreground))] font-normal">{col.type}</span>
                    {!col.nullable && !col.pk && <span className="text-[8px] text-red-400">*</span>}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                onClick={() => setSelectedRow(rowIdx)}
                className={`border-b cursor-pointer transition-colors ${selectedRow === rowIdx ? "bg-[hsl(199,30%,15%)]" : "hover:bg-[hsl(220,13%,15%)]"}`}
                style={{ borderBottomColor: "hsl(220,13%,18%)" }}
              >
                <td className="font-mono-app text-center w-8 px-2 py-1 border-r text-[hsl(var(--muted-foreground))] text-[10px]" style={{ borderRightColor: "hsl(220,13%,18%)" }}>{rowIdx + 1}</td>
                {columns.map(col => {
                  const val = row[col.name];
                  const editing = editingCell?.row === rowIdx && editingCell?.col === col.name;
                  return (
                    <td
                      key={col.name}
                      onDoubleClick={() => !col.pk && startEdit(rowIdx, col.name, val)}
                      className="px-3 py-1 border-r whitespace-nowrap max-w-[240px] truncate"
                      style={{ borderRightColor: "hsl(220,13%,18%)", minWidth: 120 }}
                      title={col.pk ? "Первичный ключ" : "Двойной клик для редактирования"}
                    >
                      {editing ? (
                        <input
                          autoFocus
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={e => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditingCell(null); }}
                          className="font-mono-app text-xs bg-[hsl(var(--input))] border border-[hsl(var(--primary))] rounded px-1 w-full outline-none"
                          onClick={e => e.stopPropagation()}
                        />
                      ) : (
                        <span className="font-mono-app" style={{
                          color: val === null ? "hsl(215,10%,45%)" :
                            typeof val === "boolean" ? (val ? "hsl(142,70%,45%)" : "hsl(0,70%,55%)") :
                            col.pk ? "hsl(35,90%,65%)" :
                            "hsl(210,20%,88%)"
                        }}>
                          {val === null ? "NULL" : typeof val === "boolean" ? (val ? "true" : "false") : String(val)}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {filteredRows.length === 0 && (
          <div className="text-xs text-[hsl(var(--muted-foreground))] p-4 text-center">Нет данных</div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-t border-[hsl(var(--border))] bg-[hsl(var(--table-header))] text-[10px] text-[hsl(var(--muted-foreground))] shrink-0">
        <span className="font-mono-app">{filteredRows.length} строк {rows.length >= 200 ? "(первые 200)" : ""}</span>
        {pkCol ? <span>Двойной клик по ячейке для редактирования</span> : <span className="text-yellow-400">Без PK — только просмотр</span>}
      </div>
    </div>
  );
}

// ─── Add Connection Modal ─────────────────────────────────────────────────────

function parseDsn(dsn: string) {
  try {
    const u = new URL(dsn);
    return {
      host: u.hostname, port: u.port || "5432",
      database: u.pathname.replace(/^\//, ""),
      user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    };
  } catch {
    return { host: "localhost", port: "5432", database: "", user: "postgres", password: "" };
  }
}

function AddConnectionModal({ onClose, onSave, editConn }: { onClose: () => void; onSave: (c: Connection) => void; editConn?: Connection }) {
  const initial = editConn
    ? { name: editConn.name, color: editConn.color, ...parseDsn(editConn.dsn) }
    : { name: "", host: "localhost", port: "5432", database: "", user: "postgres", password: "", color: "#3b82f6" };
  const [form, setForm] = useState(initial);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const colors = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#ec4899"];
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => { setForm(f => ({ ...f, [k]: e.target.value })); setTestResult(null); };

  const buildDsn = () =>
    `postgresql://${encodeURIComponent(form.user)}:${encodeURIComponent(form.password)}@${form.host}:${form.port}/${form.database}`;

  const test = async () => {
    if (!form.host || !form.database) { setTestResult({ ok: false, msg: "Заполните хост и базу" }); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await dbApi.ping(buildDsn());
      setTestResult({ ok: true, msg: res.version.split(",")[0] });
    } catch (e) {
      setTestResult({ ok: false, msg: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const save = () => {
    if (!form.name || !form.host || !form.database) return;
    onSave({
      id: editConn?.id ?? Date.now().toString(), name: form.name, host: form.host, port: Number(form.port),
      database: form.database, user: form.user, color: form.color,
      status: testResult?.ok ? "connected" : "disconnected", dsn: buildDsn(),
    });
    onClose();
  };

  const inputCls = "w-full font-mono-app text-xs bg-[hsl(var(--input))] border border-[hsl(var(--border))] rounded px-2 py-1.5 outline-none focus:border-[hsl(var(--primary))] transition-colors text-[hsl(var(--foreground))]";

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in">
      <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-lg w-[420px] shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <Icon name={editConn ? "Pencil" : "Plus"} size={14} className="text-[hsl(var(--primary))]" />{editConn ? "Редактировать подключение" : "Новое подключение"}
          </h2>
          <button onClick={onClose} className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors">
            <Icon name="X" size={16} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 space-y-1">
              <span className="text-[10px] text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Название</span>
              <input value={form.name} onChange={set("name")} placeholder="My Database" className={inputCls} />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Хост</span>
              <input value={form.host} onChange={set("host")} className={inputCls} />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Порт</span>
              <input value={form.port} onChange={set("port")} className={inputCls} />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] text-[hsl(var(--muted-foreground))] uppercase tracking-wide">База данных</span>
              <input value={form.database} onChange={set("database")} className={inputCls} />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Пользователь</span>
              <input value={form.user} onChange={set("user")} className={inputCls} />
            </label>
            <label className="col-span-2 space-y-1">
              <span className="text-[10px] text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Пароль</span>
              <input type="password" value={form.password} onChange={set("password")} className={inputCls} />
            </label>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Цвет метки</span>
            <div className="flex gap-2">
              {colors.map(c => (
                <button key={c} onClick={() => setForm(f => ({ ...f, color: c }))} className={`w-5 h-5 rounded-full transition-all ${form.color === c ? "ring-2 ring-white ring-offset-1 ring-offset-[hsl(var(--card))] scale-110" : ""}`} style={{ background: c }} />
              ))}
            </div>
          </div>
          {testResult && (
            <div className={`text-[11px] flex items-start gap-1.5 px-2 py-1.5 rounded ${testResult.ok ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
              <Icon name={testResult.ok ? "CheckCircle2" : "XCircle"} size={12} className="mt-0.5 shrink-0" />
              <span className="font-mono-app break-all">{testResult.msg}</span>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-[hsl(var(--border))]">
          <button onClick={test} disabled={testing} className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-[hsl(var(--border))] rounded text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors disabled:opacity-50">
            <Icon name={testing ? "Loader2" : "Zap"} size={12} className={testing ? "animate-spin" : ""} />Проверить
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors">Отмена</button>
            <button onClick={save} className="px-3 py-1.5 text-xs bg-[hsl(var(--primary))] text-[hsl(220,13%,9%)] rounded font-medium hover:opacity-90 transition-opacity">Сохранить</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

type ActiveView = { type: "table"; schema: string; name: string } | { type: "sql" } | null;

export default function Index() {
  const [connections, setConnections] = useState<Connection[]>(loadConnections);
  const [activeConn, setActiveConn] = useState<string>(connections[0]?.id ?? "");
  const [activeView, setActiveView] = useState<ActiveView>({ type: "sql" });
  const [showAddConn, setShowAddConn] = useState(false);
  const [editConn, setEditConn] = useState<Connection | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Connection | null>(null);
  const [tables, setTables] = useState<TableSchema[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [tablesError, setTablesError] = useState<string | null>(null);

  const conn = connections.find(c => c.id === activeConn);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(connections));
  }, [connections]);

  const loadTables = useCallback(async (c: Connection) => {
    setTablesLoading(true);
    setTablesError(null);
    setTables([]);
    try {
      const res = await dbApi.tables(c.dsn);
      setTables(res.tables);
      setConnections(prev => prev.map(x => x.id === c.id ? { ...x, status: "connected" } : x));
    } catch (e) {
      setTablesError((e as Error).message);
      setConnections(prev => prev.map(x => x.id === c.id ? { ...x, status: "error" } : x));
    } finally {
      setTablesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (conn) loadTables(conn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConn]);

  const updateConn = (id: string) => {
    setActiveConn(id);
    setActiveView({ type: "sql" });
  };

  const saveConnection = (c: Connection) => {
    setConnections(prev => {
      const exists = prev.some(x => x.id === c.id);
      return exists ? prev.map(x => x.id === c.id ? c : x) : [...prev, c];
    });
    setActiveConn(c.id);
  };

  const deleteConnection = (c: Connection) => {
    setConnections(prev => {
      const next = prev.filter(x => x.id !== c.id);
      if (activeConn === c.id) setActiveConn(next[0]?.id ?? "");
      return next;
    });
    setConfirmDelete(null);
  };

  return (
    <div className="h-screen flex flex-col bg-[hsl(var(--background))] text-[hsl(var(--foreground))] overflow-hidden" style={{ userSelect: "none" }}>

      {/* Title Bar */}
      <div className="flex items-center h-9 border-b border-[hsl(var(--border))] bg-[hsl(var(--sidebar-background))] px-3 gap-3 shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <div className="w-3 h-3 rounded-full bg-[#28c840]" />
        </div>
        <div className="w-px h-4 bg-[hsl(var(--border))]" />
        <div className="flex items-center gap-1.5">
          <Icon name="Database" size={13} className="text-[hsl(var(--primary))]" />
          <span className="font-semibold text-xs tracking-tight">QueryBase</span>
        </div>
        {conn && (
          <>
            <div className="w-px h-4 bg-[hsl(var(--border))]" />
            <div className="flex items-center gap-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: conn.color }} />
              <span>{conn.name}</span>
              <span className="opacity-30">/</span>
              <span className="font-mono-app">{conn.database}</span>
              <StatusDot status={conn.status} />
            </div>
          </>
        )}
        <div className="flex-1" />
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">

        {/* Connections Panel */}
        <div className="flex flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--sidebar-background))] shrink-0" style={{ width: 210 }}>
          <div className="flex items-center justify-between px-3 py-2 border-b border-[hsl(var(--border))]">
            <span className="text-[10px] uppercase tracking-widest text-[hsl(var(--muted-foreground))] font-medium">Серверы</span>
            <button onClick={() => setShowAddConn(true)} className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))] transition-colors">
              <Icon name="Plus" size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {connections.map(c => (
              <ConnectionItem
                key={c.id}
                conn={c}
                selected={activeConn === c.id}
                onClick={() => updateConn(c.id)}
                onEdit={() => setEditConn(c)}
                onDelete={() => setConfirmDelete(c)}
              />
            ))}
          </div>
        </div>

        {/* Tables Panel */}
        <div className="flex flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--sidebar-background))] shrink-0" style={{ width: 180 }}>
          <div className="flex items-center justify-between px-3 py-2 border-b border-[hsl(var(--border))]">
            <span className="text-[10px] uppercase tracking-widest text-[hsl(var(--muted-foreground))] font-medium">Таблицы</span>
            <span className="font-mono-app text-[10px] text-[hsl(var(--muted-foreground))]">{tables.length}</span>
          </div>

          <div className="px-2 pt-2 pb-1 shrink-0">
            <button
              onClick={() => setActiveView({ type: "sql" })}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs mb-1 transition-colors ${activeView?.type === "sql" ? "bg-[hsl(199,30%,15%)] text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(220,13%,13%)] hover:text-[hsl(var(--foreground))]"}`}
            >
              <Icon name="Code2" size={12} />SQL Редактор
            </button>
          </div>

          <div className="px-3 pb-1 shrink-0">
            <span className="text-[9px] uppercase tracking-widest text-[hsl(var(--muted-foreground))] opacity-60">Таблицы</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {tablesLoading && (
              <div className="flex items-center gap-2 px-3 py-2 text-[10px] text-[hsl(var(--muted-foreground))]">
                <Icon name="Loader2" size={11} className="animate-spin" />Загрузка...
              </div>
            )}
            {tablesError && (
              <div className="px-3 py-2 text-[10px] text-red-400 flex items-start gap-1">
                <Icon name="AlertCircle" size={11} className="mt-0.5 shrink-0" />
                <span className="break-words">{tablesError}</span>
              </div>
            )}
            {!tablesLoading && !tablesError && tables.length === 0 && (
              <div className="px-3 py-2 text-[10px] text-[hsl(var(--muted-foreground))]">Нет таблиц</div>
            )}
            {tables.map(t => (
              <TableItem
                key={`${t.schema}.${t.name}`}
                table={t}
                selected={activeView?.type === "table" && activeView.name === t.name && activeView.schema === t.schema}
                onClick={() => setActiveView({ type: "table", schema: t.schema, name: t.name })}
              />
            ))}
          </div>

          <div className="px-3 py-2 border-t border-[hsl(var(--border))] shrink-0">
            <div className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--muted-foreground))]">
              <StatusDot status={conn?.status ?? "disconnected"} />
              <span className="font-mono-app truncate">{conn?.database}</span>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[hsl(var(--background))]">
          <div className="flex items-center border-b border-[hsl(var(--border))] bg-[hsl(var(--panel-bg))] h-8 shrink-0">
            {activeView && (
              <div className="flex items-center gap-1.5 px-3 h-full border-r border-[hsl(var(--border))] text-xs font-medium bg-[hsl(var(--background))]">
                {activeView.type === "table" ? (
                  <><Icon name="Table2" size={12} className="text-[hsl(var(--primary))]" /><span className="font-mono-app">{activeView.name}</span></>
                ) : (
                  <><Icon name="Code2" size={12} className="text-[hsl(var(--primary))]" /><span>SQL Editor</span></>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-hidden">
            {!conn ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-[hsl(var(--muted-foreground))]">
                <Icon name="Database" size={48} className="opacity-10" />
                <p className="text-sm">Добавьте сервер для начала работы</p>
              </div>
            ) : activeView?.type === "sql" ? (
              <SQLEditor dsn={conn.dsn} key={conn.id} />
            ) : activeView?.type === "table" ? (
              <TableEditor dsn={conn.dsn} schema={activeView.schema} tableName={activeView.name} key={`${conn.id}.${activeView.schema}.${activeView.name}`} />
            ) : null}
          </div>
        </div>
      </div>

      {/* Status Bar */}
      <div className="flex items-center h-5 px-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--sidebar-background))] text-[10px] text-[hsl(var(--muted-foreground))] gap-3 shrink-0">
        <div className="flex items-center gap-1.5">
          <StatusDot status={conn?.status ?? "disconnected"} />
          <span className="font-mono-app">{conn ? `${conn.user}@${conn.host}:${conn.port}` : "нет подключения"}</span>
        </div>
        <div className="w-px h-3 bg-[hsl(var(--border))]" />
        <span>PostgreSQL</span>
        <div className="flex-1" />
        <span>{new Date().toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })}</span>
      </div>

      {(showAddConn || editConn) && (
        <AddConnectionModal
          editConn={editConn ?? undefined}
          onClose={() => { setShowAddConn(false); setEditConn(null); }}
          onSave={saveConnection}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-lg w-[340px] shadow-2xl">
            <div className="px-4 py-3 border-b border-[hsl(var(--border))]">
              <h2 className="font-semibold text-sm flex items-center gap-2">
                <Icon name="AlertTriangle" size={14} className="text-red-400" />Удалить сервер?
              </h2>
            </div>
            <div className="p-4 text-xs text-[hsl(var(--muted-foreground))]">
              Подключение <span className="font-mono-app text-[hsl(var(--foreground))]">{confirmDelete.name}</span> будет удалено из списка. База данных не пострадает.
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[hsl(var(--border))]">
              <button onClick={() => setConfirmDelete(null)} className="px-3 py-1.5 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors">Отмена</button>
              <button onClick={() => deleteConnection(confirmDelete)} className="px-3 py-1.5 text-xs bg-red-500 text-white rounded font-medium hover:opacity-90 transition-opacity">Удалить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}