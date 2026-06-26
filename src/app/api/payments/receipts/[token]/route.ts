import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
// @ts-ignore
import IntaSend from "intasend-node";

// @ts-ignore
import africastalking from "africastalking";

const intasend = new IntaSend(
  process.env.INTASEND_PUB_KEY,
  process.env.INTASEND_LIVE_TOKEN || process.env.INTASEND_TEST_TOKEN,
  process.env.INTASEND_TEST_MODE?.toLowerCase() === "true"
);

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const p = await params;
    const receiptToken = p.token;

    const pool = getDb();
    const client = await pool.connect();

    try {
      const res = await client.query(`
        SELECT p.*, o.item_desc, o.item_price, o.delivery_fee, o.tracking_code, m.display_name, m.phone as merchant_phone
        FROM purchases p
        LEFT JOIN orders o ON p.order_id = o.id
        LEFT JOIN merchants m ON o.merchant_id = m.id
        WHERE p.receipt_token = $1
      `, [receiptToken]);

      let purchase = res.rows[0];

      if (!purchase) {
        return NextResponse.json({ detail: "Receipt not found" }, { status: 404 });
      }

      if (purchase.status === "pending" && purchase.invoice_id) {
        try {
          const collection = intasend.collection();
          const statusRes = await collection.status(purchase.invoice_id);
          
          if (statusRes && statusRes.invoice && statusRes.invoice.state) {
            const state = statusRes.invoice.state;
            if (state === "COMPLETE" || state === "COMPLETED") {
              purchase.status = "completed";
              purchase.mpesa_receipt = statusRes.invoice.mpesa_reference;
              purchase.escrow_status = "pending_escrow";
              
              await client.query(
                "UPDATE purchases SET status = 'completed', mpesa_receipt = $1, escrow_status = 'pending_escrow' WHERE id = $2",
                [purchase.mpesa_receipt, purchase.id]
              );

              if (!purchase.sms_sent && purchase.short_code) {
                // Send SMS synchronously to ensure it sends before Vercel kills the function
                const AT_USERNAME = process.env.AT_USERNAME || "sandbox";
                const AT_API_KEY = AT_USERNAME === "sandbox" ? process.env.AT_SANDBOX_API_KEY : process.env.AT_LIVE_API_KEY;
                
                if (AT_USERNAME && AT_API_KEY) {
                  try {
                    const at = africastalking({ apiKey: AT_API_KEY, username: AT_USERNAME });
                    const message = `Payment Confirmed! View your receipt: quikka.me/r/${purchase.short_code}. Give your rider this PIN to release payment: ${purchase.delivery_pin}`;
                    await at.SMS.send({ to: [purchase.buyer_phone], message });
                    await client.query("UPDATE purchases SET sms_sent = true WHERE id = $1", [purchase.id]);
                  } catch (smsError) {
                    console.error("Failed to send SMS:", smsError);
                  }
                }
              }
            } else if (state === "FAILED") {
              purchase.status = "failed";
              await client.query("UPDATE purchases SET status = 'failed' WHERE id = $1", [purchase.id]);
            }
          }
        } catch (apiError) {
          // Silently fail API check and rely on webhook
          console.error("IntaSend API check failed:", apiError);
        }
      }

      return NextResponse.json({
        id: purchase.id,
        receipt_token: purchase.receipt_token,
        status: purchase.status,
        quantity: purchase.quantity,
        order_id: purchase.order_id,
        buyer_phone: purchase.buyer_phone,
        location_lat: purchase.location_lat,
        location_long: purchase.location_long,
        location_text: purchase.location_text,
        delivery_pin: purchase.delivery_pin,
        escrow_status: purchase.escrow_status,
        tracking_code: purchase.tracking_code,
        order: {
          item_desc: purchase.item_desc,
          item_price: purchase.item_price,
          delivery_fee: purchase.delivery_fee
        },
        merchant: {
          display_name: purchase.display_name,
          phone: purchase.merchant_phone
        }
      });
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error("Receipt error:", error);
    return NextResponse.json({ detail: error.message || "Internal Server Error" }, { status: 500 });
  }
}
