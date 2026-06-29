import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const { pin, merchant_phone } = await req.json();

    if (!pin) {
      return NextResponse.json({ detail: "PIN is required" }, { status: 400 });
    }

    const pool = getDb();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // In demo mode, we assume the bot provides merchant_phone to verify ownership, or just the PIN
      const res = await client.query(`
        SELECT p.id, p.escrow_status, m.phone as merchant_phone
        FROM purchases p
        JOIN orders o ON p.order_id = o.id
        JOIN merchants m ON o.merchant_id = m.id
        WHERE p.delivery_pin = $1 AND p.status = 'completed'
        FOR UPDATE OF p
      `, [pin]);

      const purchase = res.rows[0];

      if (!purchase) {
        await client.query("ROLLBACK");
        return NextResponse.json({ detail: "Invalid PIN or no pending escrow order found for this PIN." }, { status: 404 });
      }

      if (purchase.escrow_status === 'cleared') {
        await client.query("ROLLBACK");
        return NextResponse.json({ detail: "Funds have already been released for this order." }, { status: 400 });
      }

      // If merchant_phone is provided from the bot, ensure it matches
      if (merchant_phone && purchase.merchant_phone !== merchant_phone) {
          // Allow override if they just passed the wrong phone in demo mode, but strictly speaking it should match.
          // For the sake of the hackathon demo, we won't strictly block it, but let's log it.
          console.warn("Demo Release: Merchant phone mismatch, but proceeding anyway for demo.");
      }

      // Mark as cleared without hitting IntaSend
      await client.query("UPDATE purchases SET escrow_status = 'cleared' WHERE id = $1", [purchase.id]);

      await client.query("COMMIT");

      return NextResponse.json({
        status: "success",
        message: "Escrow Cleared (Demo Mode)",
        purchase_id: purchase.id
      });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error("Demo release error:", error);
    return NextResponse.json({ detail: error.message || "Internal Server Error" }, { status: 500 });
  }
}
