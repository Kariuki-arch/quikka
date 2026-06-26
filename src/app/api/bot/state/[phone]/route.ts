import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

function verifyBotToken(req: NextRequest) {
  const token = req.headers.get("x-bot-token");
  const expectedToken = process.env.QUIKKA_INTERNAL_API_KEY || "default-dev-secret-key-12345";
  if (!token || token !== expectedToken) {
    return false;
  }
  return true;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ phone: string }> }) {
  if (!verifyBotToken(req)) {
    return NextResponse.json({ detail: "Forbidden: Invalid Bot Token" }, { status: 403 });
  }

  try {
    const { phone } = await params;
    const pool = getDb();
    
    const result = await pool.query("SELECT state, data FROM bot_states WHERE phone_number = $1", [phone]);
    
    if (result.rows.length === 0) {
      return NextResponse.json({ state: "idle", data: "{}" });
    }

    return NextResponse.json({ state: result.rows[0].state, data: result.rows[0].data });
  } catch (error: any) {
    console.error("Bot state fetch error:", error);
    return NextResponse.json({ detail: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ phone: string }> }) {
  if (!verifyBotToken(req)) {
    return NextResponse.json({ detail: "Forbidden: Invalid Bot Token" }, { status: 403 });
  }

  try {
    const { phone } = await params;
    const body = await req.json();
    const { state, data = "{}" } = body;

    if (!state) {
      return NextResponse.json({ detail: "State is required" }, { status: 400 });
    }

    const pool = getDb();
    
    // Upsert the bot state
    // Note: SQLite and Postgres have slightly different upsert syntaxes.
    // We will try standard Postgres ON CONFLICT DO UPDATE.
    // For local sqlite db.ts, it uses plain queries. SQLite supports ON CONFLICT since 3.24.
    const upsertSql = `
      INSERT INTO bot_states (phone_number, state, data)
      VALUES ($1, $2, $3)
      ON CONFLICT (phone_number) 
      DO UPDATE SET state = EXCLUDED.state, data = EXCLUDED.data
    `;

    await pool.query(upsertSql, [phone, state, data]);

    return NextResponse.json({ status: "success" });
  } catch (error: any) {
    console.error("Bot state update error:", error);
    return NextResponse.json({ detail: "Internal Server Error" }, { status: 500 });
  }
}
