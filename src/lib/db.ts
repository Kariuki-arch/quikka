import { Signer } from "@aws-sdk/rds-signer";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { Pool } from "pg";
import path from "path";

// ---------------------------------------------------------------------------
// SQLite wrapper that mimics the pg Pool/Client interface
// Used for LOCAL TESTING so we avoid Supabase enum issues entirely
// better-sqlite3 is loaded DYNAMICALLY to avoid crashing Vercel's serverless
// ---------------------------------------------------------------------------

let sqliteDb: any;

function getSqliteDb(): any {
  if (sqliteDb) return sqliteDb;
  // Dynamic require — only runs locally when USE_SQLITE=true
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3");
  const dbPath = path.join(process.cwd(), "local.db");
  sqliteDb = new Database(dbPath);
  sqliteDb.pragma("journal_mode = WAL");
  sqliteDb.pragma("foreign_keys = ON");

  // Create tables
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS merchants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      display_name TEXT NOT NULL,
      phone TEXT,
      wallet_id TEXT
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merchant_id INTEGER NOT NULL REFERENCES merchants(id),
      tracking_code TEXT UNIQUE NOT NULL,
      item_desc TEXT NOT NULL,
      item_price INTEGER NOT NULL,
      delivery_fee INTEGER DEFAULT 0,
      total_quantity INTEGER DEFAULT 1,
      status TEXT DEFAULT 'pending_buyer'
    );
    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      receipt_token TEXT UNIQUE NOT NULL,
      buyer_phone TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      status TEXT DEFAULT 'pending',
      location_lat REAL,
      location_long REAL,
      location_text TEXT,
      delivery_pin TEXT,
      short_code TEXT UNIQUE,
      invoice_id TEXT,
      mpesa_receipt TEXT,
      escrow_status TEXT DEFAULT 'pending_escrow',
      sms_sent INTEGER DEFAULT 0
    );
  `);

  // Seed a dummy merchant + order if empty
  const count = sqliteDb.prepare("SELECT COUNT(*) as c FROM merchants").get() as any;
  if (count.c === 0) {
    sqliteDb.exec(`
      INSERT INTO merchants (display_name, phone, wallet_id) VALUES ('Quikka Test Merchant', '+254712345678', 'DEFAULT_WALLET');
      INSERT INTO orders (merchant_id, tracking_code, item_desc, item_price, delivery_fee, total_quantity, status)
        VALUES (1, 'DUMMY-1234', 'Hackathon Demo Product', 10, 5, 100, 'pending_buyer');
    `);
  }

  return sqliteDb;
}

/** Convert pg-style $1, $2 ... placeholders to SQLite ? placeholders */
function convertQuery(sql: string): string {
  // Strip FOR UPDATE (SQLite doesn't support it, but has implicit locking)
  let s = sql.replace(/\s+FOR\s+UPDATE/gi, "");
  // Replace $N with ?
  s = s.replace(/\$\d+/g, "?");
  return s;
}

/** Thin wrapper around better-sqlite3 that exposes the pg client interface */
function makeSqliteClient() {
  const db = getSqliteDb();
  return {
    query(sql: string, params?: any[]) {
      const q = convertQuery(sql).trim();
      const upper = q.toUpperCase();

      // Transaction control
      if (upper === "BEGIN") { db.exec("BEGIN"); return { rows: [] }; }
      if (upper === "COMMIT") { db.exec("COMMIT"); return { rows: [] }; }
      if (upper === "ROLLBACK") { db.exec("ROLLBACK"); return { rows: [] }; }

      // SELECT or RETURNING
      const isSelect = upper.startsWith("SELECT");
      const hasReturning = /RETURNING\s+/i.test(q);

      if (isSelect) {
        const stmt = db.prepare(q);
        const rows = stmt.all(...(params || []));
        return { rows };
      }

      if (hasReturning) {
        // SQLite >= 3.35 supports RETURNING
        try {
          const stmt = db.prepare(q);
          const rows = stmt.all(...(params || []));
          return { rows };
        } catch {
          // Fallback: run without RETURNING, then fetch last insert
          const noRet = q.replace(/\s+RETURNING\s+.*/i, "");
          const stmt = db.prepare(noRet);
          const info = stmt.run(...(params || []));
          const lastRow = db.prepare("SELECT * FROM purchases WHERE id = ?").get(info.lastInsertRowid);
          return { rows: lastRow ? [lastRow] : [] };
        }
      }

      // Plain INSERT / UPDATE / DELETE
      const stmt = db.prepare(q);
      const info = stmt.run(...(params || []));
      return { rows: [], rowCount: info.changes };
    },
    release() { /* no-op for SQLite */ },
  };
}

/** Pool-like wrapper that returns our SQLite client */
function makeSqlitePool() {
  return {
    connect() {
      return Promise.resolve(makeSqliteClient());
    },
    query(sql: string, params?: any[]) {
      return Promise.resolve(makeSqliteClient().query(sql, params));
    },
  };
}

// ---------------------------------------------------------------------------
// PostgreSQL pool (production / Vercel)
// ---------------------------------------------------------------------------

let pgPool: Pool | undefined;

function getPgPool(): Pool {
  if (pgPool) return pgPool;

  if (process.env.DATABASE_URL || process.env.POSTGRES_URL) {
    console.log("Using standard DATABASE_URL connection");
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
      ssl: { rejectUnauthorized: false },
    });
    return pgPool;
  }

  console.log("Using Vercel AWS OIDC connection");
  const signer = new Signer({
    hostname: process.env.PGHOST!,
    port: Number(process.env.PGPORT),
    username: process.env.PGUSER!,
    region: process.env.AWS_REGION!,
    credentials: awsCredentialsProvider({
      roleArn: process.env.AWS_ROLE_ARN!,
      clientConfig: { region: process.env.AWS_REGION! },
    }),
  });

  pgPool = new Pool({
    host: process.env.PGHOST,
    user: process.env.PGUSER,
    database: process.env.PGDATABASE || "postgres",
    password: () => signer.getAuthToken(),
    port: Number(process.env.PGPORT),
    ssl: { rejectUnauthorized: false },
  });

  return pgPool;
}

// ---------------------------------------------------------------------------
// Public API — getDb()
// Set USE_SQLITE=true in .env.local to use the local SQLite database
// ---------------------------------------------------------------------------

export function getDb(): any {
  if (process.env.USE_SQLITE === "true") {
    console.log("Using local SQLite database");
    return makeSqlitePool();
  }
  return getPgPool();
}
