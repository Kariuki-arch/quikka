import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ tracking_code: string }> }) {
  try {
    const { tracking_code } = await params;
    const pool = getDb();
    
    // The previous python backend returned: id, merchant_id, tracking_code, item_desc, item_price, delivery_fee, total_quantity, status
    const result = await pool.query("SELECT * FROM orders WHERE tracking_code = $1", [tracking_code]);
    
    if (result.rows.length === 0) {
      return NextResponse.json({ detail: "Order not found" }, { status: 404 });
    }

    const order = result.rows[0];

    // Calculate available_quantity
    const purchasesRes = await pool.query(
      "SELECT SUM(quantity) as sold FROM purchases WHERE order_id = $1 AND status != 'failed' AND status != 'canceled'",
      [order.id]
    );
    const sold = parseInt(purchasesRes.rows[0].sold) || 0;
    
    // total_quantity = 0 means unlimited
    order.available_quantity = order.total_quantity > 0 ? order.total_quantity - sold : 999999;

    return NextResponse.json(order);
  } catch (error: any) {
    console.error("Order fetch error:", error);
    return NextResponse.json({ detail: "Internal Server Error" }, { status: 500 });
  }
}
