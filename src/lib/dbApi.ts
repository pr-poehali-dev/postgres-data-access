const API_URL = "https://functions.poehali.dev/c08eb5a5-5f18-436f-8b3c-658f82619499";

export interface ApiColumn {
  name: string;
  type: string;
  nullable: boolean;
  pk: boolean;
}

export interface ApiTable {
  schema: string;
  name: string;
  rows: number;
}

export type ApiCell = string | number | boolean | null;
export type ApiRow = Record<string, ApiCell>;

async function call<T>(payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data as T;
}

export const dbApi = {
  ping: (dsn: string) =>
    call<{ status: string; version: string }>({ action: "ping", dsn }),

  tables: (dsn: string) =>
    call<{ tables: ApiTable[] }>({ action: "tables", dsn }),

  rows: (dsn: string, schema: string, table: string, limit = 100, offset = 0) =>
    call<{ columns: ApiColumn[]; rows: ApiRow[] }>({
      action: "rows", dsn, schema, table, limit, offset,
    }),

  query: (dsn: string, sql: string) =>
    call<{ columns: string[]; rows: ApiRow[]; rowCount: number; message?: string }>({
      action: "query", dsn, sql,
    }),

  update: (dsn: string, schema: string, table: string, pkColumn: string, pkValue: ApiCell, column: string, value: ApiCell) =>
    call<{ affected: number }>({
      action: "update", dsn, schema, table, pkColumn, pkValue, column, value,
    }),
};
