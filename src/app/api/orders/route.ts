import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { merchant_id, item_desc, item_price, delivery_fee = 0, total_quantity = 1 } = body;

    if (!merchant_id || !item_desc || item_price === undefined) {
      return NextResponse.json({ detail: "Missing required fields" }, { status: 400 });
    }

    const pool = getDb();
    
    // Generate a unique 8-character alphanumeric tracking code
    const trackingCode = crypto.randomBytes(4).toString('hex').toUpperCase();

    const insertSql = `
      INSERT INTO orders (merchant_id, tracking_code, item_desc, item_price, delivery_fee, total_quantity, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'pending_buyer')
      RETURNING id, merchant_id, tracking_code, item_desc, item_price, delivery_fee, total_quantity, status
    `;

    const result = await pool.query(insertSql, [
      merchant_id,
      trackingCode,
      item_desc,
      item_price,
      delivery_fee,
      total_quantity
    ]);

    return NextResponse.json(result.rows[0]);
  } catch (error: any) {
    console.error("Order creation error:", error);
    return NextResponse.json({ detail: "Internal Server Error" }, { status: 500 });
  }
}
