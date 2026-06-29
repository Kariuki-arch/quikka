import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  try {
    const { order_id, phone_number, location_lat, location_long, location_text, quantity = 1 } = await req.json();

    const pool = getDb();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Lock order
      const orderRes = await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [order_id]);
      const order = orderRes.rows[0];

      if (!order) {
        await client.query("ROLLBACK");
        return NextResponse.json({ detail: "Order not found" }, { status: 404 });
      }

      // Calculate available quantity
      const purchasesRes = await client.query(
        "SELECT SUM(quantity) as sold FROM purchases WHERE order_id = $1 AND status != 'failed' AND status != 'canceled'",
        [order_id]
      );
      const sold = parseInt(purchasesRes.rows[0].sold) || 0;
      const available = order.total_quantity > 0 ? order.total_quantity - sold : 999999;

      if (order.total_quantity > 0 && quantity > available) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { detail: `Sorry, only ${available} items remain! Someone just bought the rest.` },
          { status: 400 }
        );
      }

      const receiptToken = uuidv4().replace(/-/g, "");
      const deliveryPin = Math.floor(1000 + Math.random() * 9000).toString();
      const shortCode = crypto.randomBytes(4).toString("base64url").substring(0, 8);

      // Insert purchase as 'pending' initially just like STK push
      const insertRes = await client.query(
        `INSERT INTO purchases (order_id, receipt_token, buyer_phone, quantity, status, location_lat, location_long, location_text, delivery_pin, short_code) 
         VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, $9) RETURNING id`,
        [order_id, receiptToken, phone_number, quantity, location_lat, location_long, location_text, deliveryPin, shortCode]
      );

      const purchaseId = insertRes.rows[0].id;
      
      await client.query("COMMIT");

      // Now instantly trigger the webhook as if IntaSend sent it
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      try {
        await fetch(`${frontendUrl}/api/payments/webhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
             state: "COMPLETED",
             api_ref: purchaseId.toString(),
             challenge: process.env.INTASEND_LIVE_WEBHOOK_CHALLENGE || process.env.INTASEND_WEBHOOK_CHALLENGE,
             mpesa_reference: "DEMO_" + crypto.randomBytes(4).toString("hex").toUpperCase()
          })
        });
      } catch (err) {
        console.error("Failed to ping webhook internally in demo mode", err);
      }

      return NextResponse.json({
        status: "success",
        message: "Demo Payment Processed",
        purchase_id: purchaseId,
        receipt_token: receiptToken
      });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error("Demo checkout error:", error);
    return NextResponse.json({ detail: error.message || "Internal Server Error" }, { status: 500 });
  }
}
