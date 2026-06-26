import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// Basic auth fetch for IntaSend API
async function intasendFetch(endpoint: string, method: string, body: any) {
  const token = process.env.INTASEND_LIVE_TOKEN || process.env.INTASEND_TEST_TOKEN;
  const baseUrl = process.env.INTASEND_TEST_MODE?.toLowerCase() === "true" 
    ? "https://sandbox.intasend.com/api/v1" 
    : "https://payment.intasend.com/api/v1";

  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const errorData = await response.text();
    console.error("IntaSend API Error:", response.status, errorData);
    throw new Error(`IntaSend API Error: ${response.status} - ${errorData}`);
  }
  return response.json();
}

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
      const payoutRes = await intasendFetch("/send-money/initiate/", "POST", {
        provider: "M-PESA-B2C",
        currency: "KES",
        transactions: [
          {
            name: merchant.display_name,
            account: merchant.preferred_payment_number || merchant.phone,
            amount: amount
          }
        ],
        wallet_id: merchant.wallet_id,
        device_id: "quikka-backend",
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
