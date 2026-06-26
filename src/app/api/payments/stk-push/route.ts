import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
// @ts-ignore
import IntaSend from "intasend-node";

const intasend = new IntaSend(
  process.env.INTASEND_PUB_KEY,
  process.env.INTASEND_LIVE_TOKEN || process.env.INTASEND_TEST_TOKEN,
  process.env.INTASEND_TEST_MODE?.toLowerCase() === "true"
);

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
      const available = order.total_quantity - sold;

      if (quantity > available) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { detail: `Sorry, only ${available} items remain! Someone just bought the rest.` },
          { status: 400 }
        );
      }

      const receiptToken = uuidv4().replace(/-/g, "");
      const deliveryPin = Math.floor(1000 + Math.random() * 9000).toString();
      const shortCode = crypto.randomBytes(4).toString("base64url").substring(0, 8);

      // Insert purchase
      const insertRes = await client.query(
        `INSERT INTO purchases (order_id, receipt_token, buyer_phone, quantity, status, location_lat, location_long, location_text, delivery_pin, short_code) 
         VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, $9) RETURNING id`,
        [order_id, receiptToken, phone_number, quantity, location_lat, location_long, location_text, deliveryPin, shortCode]
      );

      const purchaseId = insertRes.rows[0].id;

      // STK Push
      const amount = (order.item_price * quantity) + (order.delivery_fee || 0);
      
      const collection = intasend.collection();
      const response = await collection.mpesaStkPush({
        first_name: "Customer",
        last_name: "Buyer",
        email: "solomon.partnerships@gmail.com",
        host: "https://quikka.me",
        amount: amount,
        phone_number: phone_number,
        api_ref: purchaseId.toString()
      });

      if (response && response.invoice && response.invoice.invoice_id) {
        await client.query("UPDATE purchases SET invoice_id = $1 WHERE id = $2", [response.invoice.invoice_id, purchaseId]);
      }

      await client.query("COMMIT");

      return NextResponse.json({
        status: "success",
        message: "STK Push sent",
        data: response,
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
    console.error("STK Push error:", error);
    return NextResponse.json({ detail: error.message || "Internal Server Error" }, { status: 500 });
  }
}
