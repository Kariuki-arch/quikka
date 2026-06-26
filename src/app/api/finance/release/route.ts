import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import crypto from "crypto";

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
    throw new Error(`IntaSend API Error: ${response.status}`);
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
    const { merchant_phone, pin } = await req.json();
    const pool = getDb();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Find Merchant
      const merchantRes = await client.query("SELECT * FROM merchants WHERE phone = $1 FOR UPDATE", [merchant_phone]);
      const merchant = merchantRes.rows[0];

      if (!merchant) {
        await client.query("ROLLBACK");
        return NextResponse.json({ detail: "Merchant not found. Please register first." }, { status: 404 });
      }

      // Check / Create Wallet
      if (!merchant.wallet_id) {
        const short_uuid = crypto.randomBytes(4).toString("hex");
        const label = `Quikka-Merchant-${merchant.id}-${short_uuid}`;
        try {
          const walletRes = await intasendFetch("/wallets/", "POST", {
            currency: "KES",
            label: label,
            can_disburse: true
          });
          merchant.wallet_id = walletRes.wallet_id;
          await client.query("UPDATE merchants SET wallet_id = $1 WHERE id = $2", [merchant.wallet_id, merchant.id]);
        } catch (walletErr: any) {
          await client.query("ROLLBACK");
          return NextResponse.json({ detail: `Failed to create wallet for merchant: ${walletErr.message}` }, { status: 500 });
        }
      }

      // Find Pending Escrow Purchase
      const purchaseRes = await client.query(`
        SELECT p.*, o.item_price FROM purchases p 
        JOIN orders o ON p.order_id = o.id
        WHERE o.merchant_id = $1 AND p.delivery_pin = $2 AND p.escrow_status = 'pending_escrow'
        FOR UPDATE
      `, [merchant.id, pin]);

      const purchase = purchaseRes.rows[0];

      if (!purchase) {
        await client.query("ROLLBACK");
        return NextResponse.json({ detail: "Invalid PIN or no pending escrow order found for this PIN" }, { status: 404 });
      }

      // Quikka takes 3% fee
      const transferAmount = (purchase.item_price * purchase.quantity) * 0.97;
      const settlementWallet = process.env.INTASEND_SETTLEMENT_WALLET_ID || "DEFAULT_SETTLEMENT_WALLET";

      // Transfer funds from Settlement Wallet to Merchant Working Wallet
      try {
        await intasendFetch("/wallets/intra-transfer/", "POST", {
          wallet_id: settlementWallet,
          destination: merchant.wallet_id,
          amount: transferAmount,
          narrative: `Escrow Release for Purchase ${purchase.id}`
        });

        // Update purchase status
        await client.query("UPDATE purchases SET escrow_status = 'cleared' WHERE id = $1", [purchase.id]);
        await client.query("COMMIT");

        return NextResponse.json({ status: "success", message: "Funds released successfully" });
      } catch (transferErr: any) {
        await client.query("ROLLBACK");
        return NextResponse.json({ detail: transferErr.message }, { status: 500 });
      }
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error("Escrow Release Error:", error);
    return NextResponse.json({ detail: error.message || "Internal Server Error" }, { status: 500 });
  }
}
