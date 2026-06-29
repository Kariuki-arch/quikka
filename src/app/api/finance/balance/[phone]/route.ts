import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// @ts-ignore
import IntaSend from "intasend-node";

const intasend = new IntaSend(
  process.env.INTASEND_PUB_KEY,
  process.env.INTASEND_LIVE_TOKEN || process.env.INTASEND_TEST_TOKEN,
  process.env.INTASEND_TEST_MODE?.toLowerCase() === "true"
);

function verifyBotToken(req: NextRequest) {
  const token = req.headers.get("x-bot-token");
  const expectedToken = process.env.QUIKKA_INTERNAL_API_KEY || "default-dev-secret-key-12345";
  return token && token === expectedToken;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ phone: string }> }) {
  if (!verifyBotToken(req)) {
    return NextResponse.json({ detail: "Forbidden: Invalid Bot Token" }, { status: 403 });
  }

  try {
    const { phone } = await params;
    const pool = getDb();
    
    const merchantRes = await pool.query("SELECT id, wallet_id FROM merchants WHERE phone = $1", [phone]);
    const merchant = merchantRes.rows[0];

    if (!merchant) {
      return NextResponse.json({ detail: "Merchant not found" }, { status: 404 });
    }

    let availableBalance = 0.0;

    // Fetch available balance from IntaSend wallet if it exists
    if (merchant.wallet_id) {
      try {
        const wallets = intasend.wallets();
        const walletsData = await wallets.get(merchant.wallet_id);
        availableBalance = parseFloat(walletsData.current_balance || 0);
      } catch (err: any) {
        console.error("Error fetching IntaSend wallet:", err.message);
      }
    }

    // Calculate escrow balance from pending purchases
    const escrowRes = await pool.query(`
      SELECT COALESCE(SUM(o.item_price * p.quantity * 0.97), 0) as escrow_total
      FROM purchases p
      JOIN orders o ON p.order_id = o.id
      WHERE o.merchant_id = $1 AND p.escrow_status = 'pending_escrow'
    `, [merchant.id]);

    const escrowBalance = parseFloat(escrowRes.rows[0].escrow_total || 0);

    return NextResponse.json({
      available_balance: availableBalance,
      escrow_balance: escrowBalance
    });

  } catch (error: any) {
    console.error("Balance Fetch Error:", error);
    return NextResponse.json({ detail: "Internal Server Error" }, { status: 500 });
  }
}
