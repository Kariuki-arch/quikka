import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

function verifyBotToken(req: NextRequest) {
  const token = req.headers.get("x-bot-token");
  const expectedToken = process.env.QUIKKA_INTERNAL_API_KEY || "default-dev-secret-key-12345";
  return token && token === expectedToken;
}

export async function POST(req: NextRequest) {
  if (!verifyBotToken(req)) {
    return NextResponse.json({ detail: "Forbidden: Invalid Bot Token" }, { status: 403 });
  }

  try {
    const { phone, display_name, preferred_payment_number } = await req.json();

    if (!phone || !display_name) {
      return NextResponse.json({ detail: "phone and display_name are required" }, { status: 400 });
    }

    const pool = getDb();
    
    // Insert into merchants
    const insertSql = `
      INSERT INTO merchants (phone, display_name, preferred_payment_number)
      VALUES ($1, $2, $3)
      RETURNING id, phone, display_name, preferred_payment_number
    `;
    
    // We don't have a unique constraint on phone in the schema right now (we probably should),
    // but the db-setup doesn't have it. If there is, it will throw an error, which is fine.
    try {
      const result = await pool.query(insertSql, [phone, display_name, preferred_payment_number || null]);
      return NextResponse.json(result.rows[0]);
    } catch (dbErr: any) {
      // If there's a unique constraint violation or something
      console.error("DB Insert Error:", dbErr);
      return NextResponse.json({ detail: "Could not create merchant, possibly already exists." }, { status: 400 });
    }
  } catch (error: any) {
    console.error("Merchant Create Error:", error);
    return NextResponse.json({ detail: error.message || "Internal Server Error" }, { status: 500 });
  }
}
