import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
// @ts-ignore
import africastalking from "africastalking";

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const expectedChallenge = process.env.INTASEND_LIVE_WEBHOOK_CHALLENGE;
    
    console.log("WEBHOOK RECEIVED:", payload);

    if (expectedChallenge && payload.challenge !== expectedChallenge) {
      return NextResponse.json({ detail: "Invalid webhook challenge" }, { status: 401 });
    }

    const pool = getDb();
    const client = await pool.connect();

    try {
      if ((payload.state === "COMPLETE" || payload.state === "COMPLETED") && payload.api_ref) {
        const purchaseId = parseInt(payload.api_ref, 10);
        
        await client.query("BEGIN");
        
        const res = await client.query("SELECT * FROM purchases WHERE id = $1 FOR UPDATE", [purchaseId]);
        const purchase = res.rows[0];

        if (purchase) {
          const updateRes = await client.query(
            "UPDATE purchases SET status = 'completed', mpesa_receipt = $1, escrow_status = 'pending_escrow' WHERE id = $2 RETURNING *",
            [payload.mpesa_reference, purchaseId]
          );
          
          const updatedPurchase = updateRes.rows[0];

          if (!updatedPurchase.sms_sent && updatedPurchase.short_code) {
             const AT_USERNAME = process.env.AT_USERNAME || "sandbox";
             const AT_API_KEY = AT_USERNAME === "sandbox" ? process.env.AT_SANDBOX_API_KEY : process.env.AT_LIVE_API_KEY;
             
             if (AT_USERNAME && AT_API_KEY) {
               try {
                 const at = africastalking({ apiKey: AT_API_KEY, username: AT_USERNAME });
                 const message = `Payment Confirmed! View your receipt: quikka.me/r/${updatedPurchase.short_code}. Give your rider this PIN to release payment: ${updatedPurchase.delivery_pin}`;
                 await at.SMS.send({ to: [updatedPurchase.buyer_phone], message });
                 await client.query("UPDATE purchases SET sms_sent = true WHERE id = $1", [purchaseId]);
               } catch (smsError) {
                 console.error("Failed to send SMS in webhook:", smsError);
               }
             }
          }
          
          // Note: Vercel serverless functions will terminate as soon as the response is sent.
          // We must complete all fetch requests before returning.
          const botUrl = (process.env.BOT_URL || "http://localhost:8080").replace(/\/$/, "");
          const internalKey = process.env.QUIKKA_INTERNAL_API_KEY;
          
          try {
             const headers: Record<string, string> = { "Content-Type": "application/json" };
             if (internalKey) {
                 headers["X-Bot-Token"] = internalKey;
             }
             // Send notification to bot
             await fetch(`${botUrl}/internal/trigger`, {
                 method: "POST",
                 headers,
                 body: JSON.stringify({ action: "payment_verified", purchase_id: purchaseId }),
                 // No direct timeout in standard fetch, but usually safe for a quick fire
             });
          } catch (botErr) {
             console.error("Failed to notify bot", botErr);
          }
        }
        await client.query("COMMIT");

      } else if (payload.state === "FAILED" && payload.api_ref) {
        const purchaseId = parseInt(payload.api_ref, 10);
        await client.query("UPDATE purchases SET status = 'failed' WHERE id = $1", [purchaseId]);
      }

      return NextResponse.json({ status: "success", message: "Webhook processed" });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error("Webhook error:", error);
    return NextResponse.json({ detail: error.message || "Internal Server Error" }, { status: 500 });
  }
}
