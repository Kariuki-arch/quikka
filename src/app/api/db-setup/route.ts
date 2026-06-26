import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  try {
    const pool = getDb();
    const client = await pool.connect();
    
    try {
      await client.query("BEGIN");
      
      // Create Merchants Table
      await client.query(`
        CREATE TABLE IF NOT EXISTS merchants (
          id SERIAL PRIMARY KEY,
          display_name VARCHAR(100) NOT NULL,
          phone VARCHAR(20),
          wallet_id VARCHAR(50)
        )
      `);

      // Create Orders Table
      await client.query(`
        CREATE TABLE IF NOT EXISTS orders (
          id SERIAL PRIMARY KEY,
          merchant_id INTEGER NOT NULL REFERENCES merchants(id),
          tracking_code VARCHAR(50) UNIQUE NOT NULL,
          item_desc VARCHAR(200) NOT NULL,
          item_price INTEGER NOT NULL,
          delivery_fee INTEGER DEFAULT 0,
          total_quantity INTEGER DEFAULT 1,
          status VARCHAR(50) DEFAULT 'pending_buyer'
        )
      `);

      // Create Purchases Table
      await client.query(`
        CREATE TABLE IF NOT EXISTS purchases (
          id SERIAL PRIMARY KEY,
          order_id INTEGER NOT NULL REFERENCES orders(id),
          receipt_token VARCHAR(50) UNIQUE NOT NULL,
          buyer_phone VARCHAR(20) NOT NULL,
          quantity INTEGER DEFAULT 1,
          status VARCHAR(50) DEFAULT 'pending',
          location_lat DECIMAL(10,8),
          location_long DECIMAL(11,8),
          location_text TEXT,
          delivery_pin VARCHAR(10),
          short_code VARCHAR(20) UNIQUE,
          invoice_id VARCHAR(100),
          mpesa_receipt VARCHAR(50),
          escrow_status VARCHAR(50) DEFAULT 'pending_escrow',
          sms_sent BOOLEAN DEFAULT false
        )
      `);

      // Seed dummy data for testing if tables are empty
      const checkMerchant = await client.query("SELECT * FROM merchants LIMIT 1");
      if (checkMerchant.rows.length === 0) {
        await client.query(`
          INSERT INTO merchants (display_name, phone, wallet_id) 
          VALUES ('Quikka Test Merchant', '+254712345678', 'DEFAULT_WALLET')
        `);
        
        await client.query(`
          INSERT INTO orders (merchant_id, tracking_code, item_desc, item_price, delivery_fee, total_quantity)
          VALUES (1, 'TRACK123', 'Sony Headphones', 1000, 150, 10)
        `);
      }

      await client.query("COMMIT");
      return NextResponse.json({ status: "success", message: "Aurora Database Schema Initialized Successfully!" });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error("DB Setup Error:", error);
    return NextResponse.json({ detail: error.message || "Internal Server Error" }, { status: 500 });
  }
}
