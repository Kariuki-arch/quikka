import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ short_code: string }> }) {
  try {
    const p = await params;
    const shortCode = p.short_code;

    const pool = getDb();
    const client = await pool.connect();

    try {
      const res = await client.query("SELECT receipt_token FROM purchases WHERE short_code = $1", [shortCode]);
      const purchase = res.rows[0];

      if (!purchase) {
        return NextResponse.json({ detail: "Receipt not found" }, { status: 404 });
      }

      const frontendUrl = process.env.FRONTEND_URL || "https://quikka.me";
      return NextResponse.redirect(`${frontendUrl}/receipt?token=${purchase.receipt_token}`);
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error("Redirect error:", error);
    return NextResponse.json({ detail: error.message || "Internal Server Error" }, { status: 500 });
  }
}
