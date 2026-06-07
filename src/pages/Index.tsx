import { useState, useRef, useEffect } from "react";
import Icon from "@/components/ui/icon";

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
}

interface TableSchema {
  name: string;
  schema: string;
  rows: number;
}

interface Column {
  name: string;
  type: string;
  nullable: boolean;
  pk: boolean;
}

type CellValue = string | number | boolean | null;

interface Row {
  [key: string]: CellValue;
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const MOCK_CONNECTIONS: Connection[] = [
  { id: "1", name: "Production DB", host: "prod.example.com", port: 5432, database: "app_prod", user: "admin", color: "#ef4444", status: "connected" },
  { id: "2", name: "Staging", host: "staging.example.com", port: 5432, database: "app_staging", user: "developer", color: "#f59e0b", status: "connected" },
  { id: "3", name: "Local Dev", host: "localhost", port: 5432, database: "myapp_dev", user: "postgres", color: "#22c55e", status: "disconnected" },
];

const MOCK_TABLES: TableSchema[] = [
  { name: "users", schema: "public", rows: 12483 },
  { name: "orders", schema: "public", rows: 84920 },
  { name: "products", schema: "public", rows: 1247 },
  { name: "categories", schema: "public", rows: 48 },
  { name: "sessions", schema: "public", rows: 204831 },
  { name: "audit_log", schema: "public", rows: 1024000 },
  { name: "payments", schema: "public", rows: 76230 },
];

const MOCK_COLUMNS: Column[] = [
  { name: "id", type: "int8", nullable: false, pk: true },
  { name: "email", type: "varchar(255)", nullable: false, pk: false },
  { name: "name", type: "varchar(100)", nullable: true, pk: false },
  { name: "created_at", type: "timestamptz", nullable: false, pk: false },
  { name: "role", type: "varchar(50)", nullable: true, pk: false },
  { name: "is_active", type: "bool", nullable: false, pk: false },
  { name: "metadata", type: "jsonb", nullable: true, pk: false },
];

const MOCK_ROWS: Row[] = Array.from({ length: 25 }, (_, i) => ({
  id: i + 1,
  email: `user${i + 1}@example.com`,
  name: ["Alice Johnson", "Bob Smith", "Carol White", "Dave Brown", "Eve Davis"][i % 5],
  created_at: `2024-0${(i % 9) + 1}-${String((i % 28) + 1).padStart(2, "0")} 14:${String((i * 2) % 60).padStart(2, "0")}:00`,
  role: ["admin", "user", "moderator"][i % 3],
  is_active: i % 4 !== 0,
  metadata: i % 3 === 0 ? '{"plan":"pro"}' : null,
}));

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

function ConnectionItem({ conn, selected, onClick }: { conn: Connection; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 flex items-center gap-2.5 transition-all ${selected ? "bg-[hsl(var(--sidebar-accent))] text-[hsl(var(--sidebar-accent-foreground))]" : "hover:bg-[hsl(220,13%,13%)] text-[hsl(var(--sidebar-foreground))]"}`}
    >
      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: conn.color }} />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-xs truncate">{conn.name}</div>
        <div className="font-mono-app text-[10px] text-[hsl(var(--muted-foreground))] truncate">{conn.host}/{conn.database}</div>
      </div>
      <StatusDot status={conn.status} />
    </button>
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
      <span className="font-mono-app text-[10px] text-[hsl(var(--muted-foreground))]">{table.rows.toLocaleString()}</span>
    </button>
  );
}

// ─── SQL Editor ───────────────────────────────────────────────────────────────

function SQLEditor() {
  const [sql, setSql] = useState(
    `SELECT u.id, u.email, u.name, u.role,\n       COUNT(o.id) AS order_count\nFROM users u\nLEFT JOIN orders o ON o.user_id = u.id\nWHERE u.is_active = true\nGROUP BY u.id\nORDER BY order_count DESC\nLIMIT 100;`
  );
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const sync = () => {
    if (preRef.current && textRef.current) {
      preRef.current.scrollTop = textRef.current.scrollTop;
      preRef.current.scrollLeft = textRef.current.scrollLeft;
    }
  };

  const run = () => {
    setRunning(true);
    setTimeout(() => { setRunning(false); setRan(true); }, 800);
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
        <button className="p-1 hover:text-[hsl(var(--foreground))] text-[hsl(var(--muted-foreground))] transition-colors">
          <Icon name="Save" size={13} />
        </button>
        <button className="p-1 hover:text-[hsl(var(--foreground))] text-[hsl(var(--muted-foreground))] transition-colors">
          <Icon name="FolderOpen" size={13} />
        </button>
        <button onClick={() => setSql("")} className="p-1 hover:text-red-400 text-[hsl(var(--muted-foreground))] transition-colors">
          <Icon name="Trash2" size={13} />
        </button>
      </div>

      <div className="relative overflow-hidden" style={{ minHeight: 180, flex: ran ? "0 0 180px" : "1" }}>
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

      {ran && (
        <div className="border-t border-[hsl(var(--border))] flex flex-col animate-fade-in flex-1 overflow-hidden">
          <div className="flex items-center gap-3 px-3 py-1.5 bg-[hsl(var(--table-header))] border-b border-[hsl(var(--border))] shrink-0">
            <span className="text-green-400 text-xs font-medium">✓ 100 строк</span>
            <span className="text-[hsl(var(--muted-foreground))] text-[10px]">0.042 сек</span>
            <div className="flex-1" />
            <button className="text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] flex items-center gap-1 transition-colors">
              <Icon name="Download" size={11} />Экспорт CSV
            </button>
          </div>
          <div className="overflow-auto flex-1">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="sticky top-0 bg-[hsl(var(--table-header))]">
                  {["id", "email", "name", "role", "order_count"].map(c => (
                    <th key={c} className="font-mono-app text-left px-3 py-1.5 border-r border-b border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] font-medium text-[11px] whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MOCK_ROWS.slice(0, 8).map((row, i) => (
                  <tr key={i} className="row-hover border-b border-[hsl(var(--border))]" style={{ borderBottomColor: "hsl(220,13%,18%)" }}>
                    <td className="font-mono-app px-3 py-1 border-r border-[hsl(var(--border))]" style={{ color: "hsl(35,90%,65%)", borderRightColor: "hsl(220,13%,18%)" }}>{String(row.id)}</td>
                    <td className="font-mono-app px-3 py-1 border-r border-[hsl(var(--border))]" style={{ color: "hsl(120,50%,60%)", borderRightColor: "hsl(220,13%,18%)" }}>{String(row.email)}</td>
                    <td className="px-3 py-1 border-r border-[hsl(var(--border))]" style={{ borderRightColor: "hsl(220,13%,18%)" }}>{String(row.name)}</td>
                    <td className="font-mono-app px-3 py-1 border-r border-[hsl(var(--border))] text-[hsl(var(--primary))]" style={{ borderRightColor: "hsl(220,13%,18%)" }}>{String(row.role)}</td>
                    <td className="font-mono-app px-3 py-1" style={{ color: "hsl(35,90%,65%)" }}>{(i + 1) * 7}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Table Editor ─────────────────────────────────────────────────────────────

function TableEditor({ tableName }: { tableName: string }) {
  const [rows, setRows] = useState<Row[]>(MOCK_ROWS);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editedCells, setEditedCells] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  const filteredRows = filter
    ? rows.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(filter.toLowerCase())))
    : rows;

  const startEdit = (rowIdx: number, col: string, val: CellValue) => {
    setEditingCell({ row: rowIdx, col });
    setEditValue(val === null ? "" : String(val));
  };

  const commitEdit = () => {
    if (!editingCell) return;
    setRows(prev => prev.map((r, i) => i === editingCell.row ? { ...r, [editingCell.col]: editValue } : r));
    setEditedCells(prev => new Set([...prev, `${editingCell.row}-${editingCell.col}`]));
    setEditingCell(null);
  };

  const isEdited = (rowIdx: number, col: string) => editedCells.has(`${rowIdx}-${col}`);

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
        <span className="font-mono-app text-[10px] text-[hsl(var(--muted-foreground))]">public.{tableName}</span>
        <div className="flex-1" />
        {editedCells.size > 0 && (
          <span className="text-yellow-400 text-[10px] flex items-center gap-1">
            <Icon name="AlertCircle" size={11} />
            {editedCells.size} изм.
          </span>
        )}
        <button className="flex items-center gap-1 px-2 py-1 text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))] rounded transition-colors">
          <Icon name="Plus" size={11} />Строка
        </button>
        <button className="flex items-center gap-1 px-2 py-1 text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] border border-[hsl(var(--border))] rounded transition-colors">
          <Icon name="RefreshCw" size={11} />
        </button>
        {editedCells.size > 0 && (
          <button
            onClick={() => setEditedCells(new Set())}
            className="flex items-center gap-1 px-2 py-1 text-[10px] bg-[hsl(var(--primary))] text-[hsl(220,13%,9%)] rounded font-medium transition-opacity hover:opacity-90"
          >
            <Icon name="Save" size={11} />Сохранить
          </button>
        )}
      </div>

      {/* Column headers with types */}
      <div className="flex items-center overflow-x-auto border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))] shrink-0" style={{ minHeight: 28 }}>
        <div className="w-8 px-2 shrink-0" />
        {MOCK_COLUMNS.map(col => (
          <div key={col.name} className="flex items-center gap-1 px-3 py-1 border-r border-[hsl(var(--border))] shrink-0" style={{ minWidth: 120 }}>
            {col.pk && <Icon name="Key" size={10} className="text-yellow-400" />}
            <span className="font-mono-app text-[10px] text-[hsl(var(--foreground))]">{col.name}</span>
            <span className="font-mono-app text-[9px] text-[hsl(var(--muted-foreground))]">{col.type}</span>
            {!col.nullable && !col.pk && <span className="text-[8px] text-red-400 ml-0.5">*</span>}
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-auto flex-1">
        <table className="w-full text-xs border-collapse">
          <tbody>
            {filteredRows.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                onClick={() => setSelectedRow(rowIdx)}
                className={`border-b cursor-pointer transition-colors ${selectedRow === rowIdx ? "bg-[hsl(199,30%,15%)]" : "hover:bg-[hsl(220,13%,15%)]"}`}
                style={{ borderBottomColor: "hsl(220,13%,18%)" }}
              >
                <td className="font-mono-app text-center w-8 px-2 py-1 border-r text-[hsl(var(--muted-foreground))] text-[10px]" style={{ borderRightColor: "hsl(220,13%,18%)" }}>{rowIdx + 1}</td>
                {MOCK_COLUMNS.map(col => {
                  const val = row[col.name];
                  const editing = editingCell?.row === rowIdx && editingCell?.col === col.name;
                  const edited = isEdited(rowIdx, col.name);
                  return (
                    <td
                      key={col.name}
                      onDoubleClick={() => !col.pk && startEdit(rowIdx, col.name, val)}
                      className={`px-3 py-1 border-r whitespace-nowrap max-w-[200px] truncate ${edited ? "bg-[hsl(40,90%,15%)]" : ""}`}
                      style={{ borderRightColor: "hsl(220,13%,18%)", minWidth: 120 }}
                      title={col.pk ? "" : "Двойной клик для редактирования"}
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
                            col.type === "bool" ? (val ? "hsl(142,70%,45%)" : "hsl(0,70%,55%)") :
                            col.pk ? "hsl(35,90%,65%)" :
                            col.name === "email" ? "hsl(120,50%,60%)" :
                            col.name === "role" ? "hsl(199,89%,65%)" :
                            "hsl(210,20%,88%)"
                        }}>
                          {val === null ? "NULL" : col.type === "bool" ? (val ? "true" : "false") : String(val)}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-1 w-8">
                  {selectedRow === rowIdx && (
                    <button className="text-red-400 hover:opacity-80 transition-opacity" onClick={e => e.stopPropagation()}>
                      <Icon name="Trash2" size={11} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-t border-[hsl(var(--border))] bg-[hsl(var(--table-header))] text-[10px] text-[hsl(var(--muted-foreground))] shrink-0">
        <span className="font-mono-app">{filteredRows.length} из {rows.length} строк</span>
        {selectedRow !== null && <span>Двойной клик по ячейке для редактирования</span>}
        <div className="flex-1" />
        <button className="hover:text-[hsl(var(--foreground))] transition-colors px-1">
          <Icon name="ChevronLeft" size={12} />
        </button>
        <span>Стр. 1 / 5</span>
        <button className="hover:text-[hsl(var(--foreground))] transition-colors px-1">
          <Icon name="ChevronRight" size={12} />
        </button>
      </div>
    </div>
  );
}

// ─── Add Connection Modal ─────────────────────────────────────────────────────

function AddConnectionModal({ onClose, onAdd }: { onClose: () => void; onAdd: (c: Connection) => void }) {
  const [form, setForm] = useState({ name: "", host: "localhost", port: "5432", database: "", user: "postgres", password: "", color: "#3b82f6" });
  const colors = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#ec4899"];
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  const save = () => {
    if (!form.name || !form.host || !form.database) return;
    onAdd({ id: Date.now().toString(), name: form.name, host: form.host, port: Number(form.port), database: form.database, user: form.user, color: form.color, status: "disconnected" });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in">
      <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-lg w-[420px] shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <Icon name="Plus" size={14} className="text-[hsl(var(--primary))]" />
            Новое подключение
          </h2>
          <button onClick={onClose} className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors">
            <Icon name="X" size={16} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 space-y-1">
              <span className="text-[10px] text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Название</span>
              <input value={form.name} onChange={set("name")} placeholder="My Database" className="w-full font-mono-app text-xs bg-[hsl(var(--input))] border border-[hsl(var(--border))] rounded px-2 py-1.5 outline-none focus:border-[hsl(var(--primary))] transition-colors text-[hsl(var(--foreground))]" />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Хост</span>
              <input value={form.host} onChange={set("host")} className="w-full font-mono-app text-xs bg-[hsl(var(--input))] border border-[hsl(var(--border))] rounded px-2 py-1.5 outline-none focus:border-[hsl(var(--primary))] transition-colors text-[hsl(var(--foreground))]" />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Порт</span>
              <input value={form.port} onChange={set("port")} className="w-full font-mono-app text-xs bg-[hsl(var(--input))] border border-[hsl(var(--border))] rounded px-2 py-1.5 outline-none focus:border-[hsl(var(--primary))] transition-colors text-[hsl(var(--foreground))]" />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] text-[hsl(var(--muted-foreground))] uppercase tracking-wide">База данных</span>
              <input value={form.database} onChange={set("database")} className="w-full font-mono-app text-xs bg-[hsl(var(--input))] border border-[hsl(var(--border))] rounded px-2 py-1.5 outline-none focus:border-[hsl(var(--primary))] transition-colors text-[hsl(var(--foreground))]" />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Пользователь</span>
              <input value={form.user} onChange={set("user")} className="w-full font-mono-app text-xs bg-[hsl(var(--input))] border border-[hsl(var(--border))] rounded px-2 py-1.5 outline-none focus:border-[hsl(var(--primary))] transition-colors text-[hsl(var(--foreground))]" />
            </label>
            <label className="col-span-2 space-y-1">
              <span className="text-[10px] text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Пароль</span>
              <input type="password" value={form.password} onChange={set("password")} className="w-full font-mono-app text-xs bg-[hsl(var(--input))] border border-[hsl(var(--border))] rounded px-2 py-1.5 outline-none focus:border-[hsl(var(--primary))] transition-colors text-[hsl(var(--foreground))]" />
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
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[hsl(var(--border))]">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors">Отмена</button>
          <button onClick={save} className="px-3 py-1.5 text-xs bg-[hsl(var(--primary))] text-[hsl(220,13%,9%)] rounded font-medium hover:opacity-90 transition-opacity">Сохранить</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

type ActiveView = { type: "table"; name: string } | { type: "sql" } | null;

export default function Index() {
  const [connections, setConnections] = useState<Connection[]>(MOCK_CONNECTIONS);
  const [activeConn, setActiveConn] = useState<string>("1");
  const [activeView, setActiveView] = useState<ActiveView>({ type: "table", name: "users" });
  const [showAddConn, setShowAddConn] = useState(false);

  const conn = connections.find(c => c.id === activeConn);

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
        <button className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors px-2 py-1 hover:bg-[hsl(var(--muted))] rounded">
          <Icon name="Settings" size={12} />Настройки
        </button>
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
              <ConnectionItem key={c.id} conn={c} selected={activeConn === c.id} onClick={() => setActiveConn(c.id)} />
            ))}
          </div>
        </div>

        {/* Tables Panel */}
        <div className="flex flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--sidebar-background))] shrink-0" style={{ width: 180 }}>
          <div className="flex items-center justify-between px-3 py-2 border-b border-[hsl(var(--border))]">
            <span className="text-[10px] uppercase tracking-widest text-[hsl(var(--muted-foreground))] font-medium">Таблицы</span>
            <span className="font-mono-app text-[10px] text-[hsl(var(--muted-foreground))]">{MOCK_TABLES.length}</span>
          </div>

          <div className="px-2 pt-2 pb-1 shrink-0">
            <button
              onClick={() => setActiveView({ type: "sql" })}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs mb-1 transition-colors ${activeView?.type === "sql" ? "bg-[hsl(199,30%,15%)] text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(220,13%,13%)] hover:text-[hsl(var(--foreground))]"}`}
            >
              <Icon name="Code2" size={12} />
              SQL Редактор
            </button>
          </div>

          <div className="px-3 pb-1 shrink-0">
            <span className="text-[9px] uppercase tracking-widest text-[hsl(var(--muted-foreground))] opacity-60">Таблицы</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {MOCK_TABLES.map(t => (
              <TableItem
                key={t.name}
                table={t}
                selected={activeView?.type === "table" && activeView.name === t.name}
                onClick={() => setActiveView({ type: "table", name: t.name })}
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
          {/* Tab bar */}
          <div className="flex items-center border-b border-[hsl(var(--border))] bg-[hsl(var(--panel-bg))] h-8 shrink-0">
            {activeView && (
              <div className={`flex items-center gap-1.5 px-3 h-full border-r border-[hsl(var(--border))] text-xs font-medium ${activeView.type !== null ? "bg-[hsl(var(--background))]" : ""}`}>
                {activeView.type === "table" ? (
                  <><Icon name="Table2" size={12} className="text-[hsl(var(--primary))]" /><span className="font-mono-app">{activeView.name}</span></>
                ) : (
                  <><Icon name="Code2" size={12} className="text-[hsl(var(--primary))]" /><span>SQL Editor</span></>
                )}
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            {!activeView && (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-[hsl(var(--muted-foreground))]">
                <Icon name="Database" size={48} className="opacity-10" />
                <p className="text-sm">Выберите таблицу или откройте SQL редактор</p>
              </div>
            )}
            {activeView?.type === "sql" && <SQLEditor />}
            {activeView?.type === "table" && <TableEditor tableName={activeView.name} key={activeView.name} />}
          </div>
        </div>
      </div>

      {/* Status Bar */}
      <div className="flex items-center h-5 px-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--sidebar-background))] text-[10px] text-[hsl(var(--muted-foreground))] gap-3 shrink-0">
        <div className="flex items-center gap-1.5">
          <StatusDot status={conn?.status ?? "disconnected"} />
          <span className="font-mono-app">{conn?.user}@{conn?.host}:{conn?.port}</span>
        </div>
        <div className="w-px h-3 bg-[hsl(var(--border))]" />
        <span>PostgreSQL 16.2</span>
        <div className="flex-1" />
        <span>{new Date().toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })}</span>
      </div>

      {showAddConn && (
        <AddConnectionModal
          onClose={() => setShowAddConn(false)}
          onAdd={c => setConnections(p => [...p, c])}
        />
      )}
    </div>
  );
}
