import json
import os
import psycopg2
from psycopg2.extras import RealDictCursor


def cors_headers():
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json',
    }


def resolve_dsn(dsn: str) -> str:
    '''Разрешает строку подключения. Спец-значение "project" использует БД проекта.'''
    if not dsn or dsn == 'project':
        return os.environ.get('DATABASE_URL', '')
    return dsn


def get_tables(conn):
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute('''
            SELECT n.nspname AS table_schema,
                   c.relname AS table_name,
                   c.reltuples::bigint AS est_rows
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind = 'r'
              AND n.nspname NOT IN ('pg_catalog', 'information_schema')
            ORDER BY n.nspname, c.relname
        ''')
        rows = cur.fetchall()
    return [
        {'schema': r['table_schema'], 'name': r['table_name'],
         'rows': max(int(r['est_rows'] or 0), 0)}
        for r in rows
    ]


def get_columns(conn, schema: str, table: str):
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(f'''
            SELECT c.column_name, c.data_type, c.is_nullable,
                   CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_pk
            FROM information_schema.columns c
            LEFT JOIN (
                SELECT kcu.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                WHERE tc.constraint_type = 'PRIMARY KEY'
                  AND tc.table_schema = '{schema}' AND tc.table_name = '{table}'
            ) pk ON pk.column_name = c.column_name
            WHERE c.table_schema = '{schema}' AND c.table_name = '{table}'
            ORDER BY c.ordinal_position
        ''')
        rows = cur.fetchall()
    return [
        {'name': r['column_name'], 'type': r['data_type'],
         'nullable': r['is_nullable'] == 'YES', 'pk': r['is_pk']}
        for r in rows
    ]


def get_rows(conn, schema: str, table: str, limit: int, offset: int):
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(f'SELECT * FROM "{schema}"."{table}" LIMIT {int(limit)} OFFSET {int(offset)}')
        rows = cur.fetchall()
    return [{k: _serialize(v) for k, v in r.items()} for r in rows]


def _serialize(v):
    if v is None:
        return None
    if isinstance(v, (int, float, bool, str)):
        return v
    return str(v)


def run_query(conn, sql: str):
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(sql)
        if cur.description:
            cols = [d[0] for d in cur.description]
            rows = cur.fetchall()
            data = [{k: _serialize(v) for k, v in r.items()} for r in rows]
            return {'columns': cols, 'rows': data, 'rowCount': len(data)}
        conn.commit()
        return {'columns': [], 'rows': [], 'rowCount': cur.rowcount, 'message': 'OK'}


def update_cell(conn, schema, table, pk_col, pk_val, column, value):
    with conn.cursor() as cur:
        safe_val = str(value).replace("'", "''")
        safe_pk = str(pk_val).replace("'", "''")
        cur.execute(
            f'UPDATE "{schema}"."{table}" SET "{column}" = \'{safe_val}\' WHERE "{pk_col}" = \'{safe_pk}\''
        )
        conn.commit()
        return cur.rowcount


def handler(event: dict, context) -> dict:
    '''Универсальный клиент PostgreSQL: список таблиц, колонки, данные, SQL-запросы, редактирование ячеек.'''
    method = event.get('httpMethod', 'GET')

    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': cors_headers(), 'body': ''}

    body = json.loads(event.get('body') or '{}')
    action = body.get('action', '')
    dsn = resolve_dsn(body.get('dsn', 'project'))

    if not dsn:
        return {'statusCode': 400, 'headers': cors_headers(),
                'body': json.dumps({'error': 'Не указана строка подключения'})}

    conn = None
    try:
        conn = psycopg2.connect(dsn, connect_timeout=8)

        if action == 'ping':
            with conn.cursor() as cur:
                cur.execute('SELECT version()')
                ver = cur.fetchone()[0]
            result = {'status': 'connected', 'version': ver}

        elif action == 'tables':
            result = {'tables': get_tables(conn)}

        elif action == 'columns':
            result = {'columns': get_columns(conn, body['schema'], body['table'])}

        elif action == 'rows':
            schema = body['schema']
            table = body['table']
            limit = min(int(body.get('limit', 100)), 1000)
            offset = int(body.get('offset', 0))
            result = {
                'columns': get_columns(conn, schema, table),
                'rows': get_rows(conn, schema, table, limit, offset),
            }

        elif action == 'query':
            result = run_query(conn, body['sql'])

        elif action == 'update':
            affected = update_cell(
                conn, body['schema'], body['table'],
                body['pkColumn'], body['pkValue'], body['column'], body['value']
            )
            result = {'affected': affected}

        else:
            return {'statusCode': 400, 'headers': cors_headers(),
                    'body': json.dumps({'error': f'Неизвестное действие: {action}'})}

        return {'statusCode': 200, 'headers': cors_headers(),
                'body': json.dumps(result, ensure_ascii=False, default=str)}

    except Exception as e:
        return {'statusCode': 200, 'headers': cors_headers(),
                'body': json.dumps({'error': str(e)}, ensure_ascii=False)}
    finally:
        if conn:
            conn.close()