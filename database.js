// Database.js
require('dotenv').config();
const mysql = require('mysql2/promise');

class Database {
  constructor() {
    // ป้องกันไม่ให้สร้าง connection ซ้ำซ้อน (Singleton Pattern)
    if (!Database.instance) {
      // ตรวจสอบว่าระบบมี connection string ก้อนเดียว (เช่น บน Railway / Render) หรือไม่
      const connectionUri = process.env.MYSQL_URL || process.env.DATABASE_URL;

      if (connectionUri) {
        this.pool = mysql.createPool(connectionUri);
      } else {
        this.pool = mysql.createPool({
          // รองรับทั้งชื่อตัวแปรของ Railway (MYSQLHOST...) และตัวแปรมาตรฐาน (DB_HOST...)
          host: process.env.MYSQLHOST || process.env.DB_HOST || 'localhost',
          user: process.env.MYSQLUSER || process.env.DB_USER || 'root',
          password: process.env.MYSQLPASSWORD !== undefined 
            ? process.env.MYSQLPASSWORD 
            : (process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : '0649503651@Best'),
          database: process.env.MYSQLDATABASE || process.env.DB_NAME || 'food_delivery',
          port: Number(process.env.MYSQLPORT || process.env.DB_PORT || 3306),
          waitForConnections: true,
          connectionLimit: 10,
          queueLimit: 0,
          enableKeepAlive: true,
          keepAliveInitialDelay: 10000,
          // รองรับ SSL เมื่อขึ้น Cloud Database
          ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
        });
      }

      Database.instance = this;
    }
    return Database.instance;
  }

  // ฟังก์ชันสำหรับแจกจ่าย Connection Pool ให้ไฟล์อื่นนำไปใช้ query
  getPool() {
    return this.pool;
  }
}

module.exports = new Database();