import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const pool = getDb();
    
    // The previous python backend returned: id, display_name, phone, wallet_id
    const result = await pool.query("SELECT id, display_name, phone FROM merchants WHERE id = $1", [parseInt(id, 10)]);
    
    if (result.rows.length === 0) {
      return NextResponse.json({ detail: "Merchant not found" }, { status: 404 });
    }

    return NextResponse.json(result.rows[0]);
  } catch (error: any) {
    console.error("Merchant fetch error:", error);
    return NextResponse.json({ detail: "Internal Server Error" }, { status: 500 });
  }
}
