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

export async function POST(req: NextRequest) {
  if (!verifyBotToken(req)) {
    return NextResponse.json({ detail: "Forbidden: Invalid Bot Token" }, { status: 403 });
  }

  try {
    const url = new URL(req.url);
    const amountStr = url.searchParams.get("amount");
    const merchant_id = url.searchParams.get("merchant_id");

    const amount = amountStr ? parseFloat(amountStr) : 0;
    
    if (!merchant_id || !amount || amount < 10) {
      return NextResponse.json({ detail: "Valid merchant_id and amount >= 10 are required" }, { status: 400 });
    }

    const pool = getDb();
    
    // Find Merchant
    const merchantRes = await pool.query("SELECT * FROM merchants WHERE id = $1", [merchant_id]);
    const merchant = merchantRes.rows[0];

    if (!merchant || !merchant.wallet_id) {
      return NextResponse.json({ detail: "Merchant wallet not found. Please ensure escrow has been released at least once." }, { status: 404 });
    }

    // Initiate M-Pesa B2C Payout
    try {
      const payouts = intasend.payouts();
      const payoutRes = await payouts.mpesa({
        currency: "KES",
        transactions: [
          {
            name: merchant.display_name,
            account: merchant.preferred_payment_number || merchant.phone,
            amount: amount.toString()
          }
        ],
        wallet_id: merchant.wallet_id
      });

      return NextResponse.json({ 
        status: "success", 
        message: "Payout initiated successfully",
        data: payoutRes 
      });
    } catch (payoutErr: any) {
      return NextResponse.json({ detail: payoutErr.message }, { status: 500 });
    }
  } catch (error: any) {
    console.error("Payout Request Error:", error);
    return NextResponse.json({ detail: error.message || "Internal Server Error" }, { status: 500 });
  }
}
