// database.js
require('dotenv').config();
const mysql = require('mysql2/promise');

class Database {
  constructor() {
    if (!Database.instance) {
      const rawUri = process.env.MYSQL_URL || process.env.DATABASE_URL;

      if (rawUri) {
        // ล้าง query parameters ที่ mysql2 ไม่รองรับออก เช่น ssl-mode
        let cleanUri = rawUri;
        try {
          const parsed = new URL(rawUri);
          parsed.searchParams.delete('ssl-mode');
          cleanUri = parsed.toString();
        } catch (e) {
          cleanUri = rawUri.replace(/[?&]ssl-mode=[^&]+/gi, '');
        }

        this.pool = mysql.createPool({
          uri: cleanUri,
          waitForConnections: true,
          connectionLimit: 10,
          queueLimit: 0,
          connectTimeout: 20000,
          enableKeepAlive: true,
          keepAliveInitialDelay: 10000,
          ssl: { rejectUnauthorized: false }
        });
      } else {
        this.pool = mysql.createPool({
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
          connectTimeout: 20000,
          enableKeepAlive: true,
          keepAliveInitialDelay: 10000,
          ssl: process.env.DB_SSL === 'true' || process.env.NODE_ENV === 'production' 
            ? { rejectUnauthorized: false } 
            : undefined
        });
      }

      Database.instance = this;
    }
    return Database.instance;
  }

  getPool() {
    return this.pool;
  }
}

module.exports = new Database();