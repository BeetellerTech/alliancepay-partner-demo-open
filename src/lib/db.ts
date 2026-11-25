import { Pool, type PoolClient } from "pg";
const globalDb = globalThis as unknown as { demoPool?: Pool; demoSchema?: Promise<void> };
export const pool = globalDb.demoPool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 8, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 });
export async function initDb() {
  globalDb.demoSchema ??= pool.query(`
    CREATE TABLE IF NOT EXISTS demo_sessions (id uuid PRIMARY KEY, expires_at timestamptz NOT NULL);
    CREATE TABLE IF NOT EXISTS demo_orders (
      id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES demo_sessions(id), description text NOT NULL,
      amount numeric(14,2) NOT NULL, billing_type text NOT NULL, state text NOT NULL,
      link_id text, public_token text, link jsonb, checkout jsonb, create_payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS demo_orders_owner ON demo_orders(session_id,created_at DESC);
    ALTER TABLE demo_orders ADD COLUMN IF NOT EXISTS last_error jsonb;
    ALTER TABLE demo_orders ADD COLUMN IF NOT EXISTS context_id uuid;
    ALTER TABLE demo_orders ADD COLUMN IF NOT EXISTS environment text;
    CREATE TABLE IF NOT EXISTS demo_operations (
      id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES demo_orders(id), kind text NOT NULL,
      idempotency_key uuid NOT NULL UNIQUE, upstream_id text, state text NOT NULL,
      payload_hash text NOT NULL, target_id text, response jsonb, http_status integer, request_id text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS demo_operations_order ON demo_operations(order_id,created_at);
    CREATE TABLE IF NOT EXISTS demo_events (id bigserial PRIMARY KEY, order_id uuid NOT NULL REFERENCES demo_orders(id), kind text NOT NULL, status integer, request_id text, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS demo_rate_limits (bucket text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL);
  `).then(() => undefined).catch(error => { globalDb.demoSchema = undefined; throw error; });
  return globalDb.demoSchema;
}
export async function query<T = any>(sql: string, args: unknown[] = []): Promise<T[]> { await initDb(); return (await pool.query(sql, args)).rows as T[]; }
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>) {
  await initDb(); const client = await pool.connect();
  try { await client.query("BEGIN"); const result = await fn(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
