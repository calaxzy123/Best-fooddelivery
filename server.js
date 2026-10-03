// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');
const { AuthController, FoodController, CartController, OrderController } = require('./Controllers');
const { OrderRepository } = require('./Repositories');

const app = express();

app.use(cors());
app.use(express.json());

const authController = new AuthController();
const foodController = new FoodController();
const cartController = new CartController();
const orderController = new OrderController();
const orderRepo = new OrderRepository();

const orderLiveLocations = {};

// ----------------------------------------------------
// ระบบเตรียมตารางฐานข้อมูลอัตโนมัติ (แยกตารางเด็ดขาด + ปลดล็อก Foreign Key)
// ----------------------------------------------------
async function initializeDatabaseTables() {
  try {
    const pool = db.getPool();

    // 1. ตารางผู้ใช้งาน (Users)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'customer',
        phone VARCHAR(20) DEFAULT '',
        address TEXT DEFAULT NULL,
        restaurant_id INT DEFAULT NULL,
        vehicle_type VARCHAR(50) DEFAULT 'Honda Wave 110i',
        vehicle_plate VARCHAR(50) DEFAULT '1กข-8888 กทม.',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 2. ตารางร้านค้า (Restaurants)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS restaurants (
        id INT AUTO_INCREMENT PRIMARY KEY,
        owner_id INT DEFAULT 1,
        name VARCHAR(150) NOT NULL,
        phone VARCHAR(20) DEFAULT '',
        address TEXT DEFAULT NULL,
        status VARCHAR(20) DEFAULT 'open',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 3. ตารางอาหาร (Foods)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS foods (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        name VARCHAR(150) NOT NULL,
        price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        image VARCHAR(255) DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 4. ตารางตะกร้าสินค้า (Carts)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS carts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        food_id INT NOT NULL,
        restaurant_id INT DEFAULT 1,
        quantity INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 5. ตารางคำสั่งซื้อ (Orders)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        restaurant_id INT NOT NULL,
        rider_id INT DEFAULT NULL,
        delivery_address TEXT,
        payment_method VARCHAR(50) DEFAULT 'cash',
        total_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        status VARCHAR(30) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 6. ตารางรายการสินค้าในคำสั่งซื้อ (Order Items)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id INT NOT NULL,
        food_id INT NOT NULL,
        food_name VARCHAR(150),
        price DECIMAL(10, 2) NOT NULL,
        quantity INT NOT NULL DEFAULT 1
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 7. ตารางกระเป๋าเงินลูกค้าและไรเดอร์ (Wallets)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wallets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL UNIQUE,
        balance DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 8. ตารางประวัติธุรกรรม
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wallet_transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        wallet_id INT NOT NULL,
        order_id INT DEFAULT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        type VARCHAR(50) NOT NULL,
        description VARCHAR(255) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // ปลดล็อก Foreign Key Constraint เก่าที่ค้างอยู่ (ถ้ามี)
    try {
      await pool.query(`ALTER TABLE wallet_transactions DROP FOREIGN KEY wallet_transactions_ibfk_1`);
    } catch (e) {}
    try {
      await pool.query(`ALTER TABLE wallet_transactions DROP FOREIGN KEY fk_wallet_ref`);
    } catch (e) {}

    // 9. ตารางกระเป๋าเงินร้านค้าแยกต่างหากเด็ดขาด (Merchant Wallets)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS merchant_wallets (
        restaurant_id INT PRIMARY KEY,
        balance DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // สร้างกระเป๋าของร้านค้า 1-4 ให้พร้อมใช้งาน
    for (let sId = 1; sId <= 4; sId++) {
      await pool.query('INSERT IGNORE INTO merchant_wallets (restaurant_id, balance) VALUES (?, 0.00)', [sId]);
      await pool.query('INSERT IGNORE INTO wallets (user_id, balance) VALUES (?, 0.00)', [sId]);
    }
    await pool.query('INSERT IGNORE INTO wallets (user_id, balance) VALUES (?, 0.00)', [5]);

    // --- AUTO-SEED ร้านค้าหลัก 4 ร้าน ---
    await pool.query(`
      INSERT INTO restaurants (id, owner_id, name, phone, address, status) VALUES
      (1, 1, 'ร้านกะเพราอร่อย', '081-111-1111', 'ซอยสุขุมวิท 101/1 กทม.', 'open'),
      (2, 2, 'Pizza House', '082-222-2222', 'สีลมซอย 3 กทม.', 'open'),
      (3, 3, 'Burger Station', '083-333-3333', 'ลาดพร้าว 71 กทม.', 'open'),
      (4, 4, 'ก๋วยเตี๋ยวเรือเจ้าอร่อย', '084-444-4444', 'พหลโยธิน 32 กทม.', 'open')
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        phone = VALUES(phone),
        address = VALUES(address);
    `);

    // --- AUTO-SEED เมนูอาหาร 13 รายการ ผูก restaurant_id ตายตัว 100% ---
    await pool.query(`
      INSERT INTO foods (id, restaurant_id, name, price, image) VALUES 
      (1, 1, 'ข้าวกะเพราหมูสับ', 50.00, 'Image/kapao-moosub.jpg'),
      (2, 1, 'ข้าวกะเพราไก่', 50.00, 'Image/kapao-kai.jpg'),
      (3, 1, 'ข้าวกะเพราเนื้อ', 70.00, 'Image/kapao-nae.jpg'),
      (4, 1, 'ไข่ดาว', 10.00, 'Image/dao.jpg'),
      (5, 2, 'Pizza Margherita', 199.00, 'Image/pizzamargherita.jpg'),
      (6, 2, 'Pizza Hawaiian', 229.00, 'Image/pizzahawaiian.jpg'),
      (7, 2, 'Pepperoni Pizza', 249.00, 'Image/pepperoni pizza.jpg'),
      (8, 3, 'Classic Burger', 129.00, 'Image/classic burger.jpg'),
      (9, 3, 'Cheese Burger', 149.00, 'Image/burgercheese.jpg'),
      (10, 3, 'Chicken Burger', 139.00, 'Image/chicken burger.jpg'),
      (11, 4, 'ก๋วยเตี๋ยวต้มยำ', 50.00, 'Image/noodle-tomyum.jpg'),
      (12, 4, 'ก๋วยเตี๋ยวหมู', 45.00, 'Image/noodle-pork.jpg'),
      (13, 4, 'ก๋วยเตี๋ยวเนื้อ', 60.00, 'Image/noodle-beef.jpg')
      ON DUPLICATE KEY UPDATE 
        restaurant_id = VALUES(restaurant_id),
        name = VALUES(name),
        price = VALUES(price),
        image = VALUES(image);
    `);

    console.log('✅ [Database] ปลดล็อก Constraint และแยกกระเป๋าเงินเด็ดขาด 100%');
  } catch (err) {
    console.error('⚠ [Database Init Notice]:', err.message);
  }
}

// ----------------------------------------------------
// จัดสรรเงินคำสั่งซื้อเมื่อส่งสำเร็จ (ร้านใครร้านมัน 100%)
// ----------------------------------------------------
async function processOrderPayout(orderId, explicitRiderId = null) {
  const pool = db.getPool();

  try {
    const oId = Number(orderId);
    if (!oId) return;

    const [orders] = await pool.query(
      `SELECT id, restaurant_id, rider_id, total_amount FROM orders WHERE id = ?`,
      [oId]
    );
    if (orders.length === 0) return;
    const order = orders[0];
    const restId = Number(order.restaurant_id || 1);

    // ดึงอาหารในบิลนี้
    const [items] = await pool.query(
      `SELECT food_id, price, quantity FROM order_items WHERE order_id = ?`,
      [oId]
    );

    let foodSubtotal = 0;
    if (items.length > 0) {
      foodSubtotal = items.reduce((sum, it) => sum + (Number(it.price || 0) * Number(it.quantity || 1)), 0);
    } else {
      foodSubtotal = Math.max(0, Number(order.total_amount || 0) - 20.00);
    }

    const merchantNet = Number((foodSubtotal * 0.85).toFixed(2)); // หัก GP 15%
    const deliveryFee = 20.00;

    // 1. โอนเงินให้ร้านค้านั้นๆ เข้า merchant_wallets ร้านใครร้านมัน
    const [existingShop] = await pool.query(
      `SELECT id FROM wallet_transactions WHERE order_id = ? AND wallet_id = ? AND type = 'merchant_payout' LIMIT 1`,
      [oId, restId]
    );

    if (!existingShop.length && merchantNet > 0) {
      await pool.query(
        `INSERT INTO merchant_wallets (restaurant_id, balance) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE balance = balance + ?`,
        [restId, merchantNet, merchantNet]
      );

      await pool.query(
        `INSERT INTO wallet_transactions (wallet_id, order_id, amount, type, description)
         VALUES (?, ?, ?, 'merchant_payout', ?)`,
        [restId, oId, merchantNet, `รายได้คำสั่งซื้อ #${oId} (ร้าน #${restId} ค่าอาหาร ฿${foodSubtotal.toFixed(2)} หัก GP 15%)`]
      );

      console.log(`💰 [Shop Paid] คำสั่งซื้อ #${oId}: ร้าน #${restId} ได้รับ ฿${merchantNet}`);
    }

    // 2. โอนเงินให้ไรเดอร์ (20 บาท) เข้าตาราง wallets ปกติ
    let riderUid = explicitRiderId || order.rider_id;
    if (!riderUid || Number(riderUid) <= 4) {
      const [rUser] = await pool.query('SELECT id FROM users WHERE role = "rider" ORDER BY id ASC LIMIT 1');
      riderUid = rUser.length > 0 ? rUser[0].id : 5;
    }

    const [existingRider] = await pool.query(
      `SELECT id FROM wallet_transactions WHERE order_id = ? AND wallet_id = ? AND type = 'delivery_fee' LIMIT 1`,
      [oId, riderUid]
    );

    if (!existingRider.length && riderUid) {
      await pool.query('UPDATE orders SET rider_id = ? WHERE id = ?', [riderUid, oId]);
      await pool.query(
        `INSERT INTO wallets (user_id, balance) VALUES (?, 20.00)
         ON DUPLICATE KEY UPDATE balance = balance + 20.00`,
        [riderUid]
      );

      await pool.query(
        `INSERT INTO wallet_transactions (wallet_id, order_id, amount, type, description)
         VALUES (?, ?, 20.00, 'delivery_fee', ?)`,
        [riderUid, oId, `ค่ารอบจัดส่งคำสั่งซื้อ #${oId}`]
      );

      console.log(`🛵 [Rider Paid] คำสั่งซื้อ #${oId}: ไรเดอร์ User ID #${riderUid} ได้รับ ฿20.00`);
    }

  } catch (error) {
    console.error('Order Payout Error:', error);
  }
}

// เช็กสถานะเซิร์ฟเวอร์
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// ล้างคำสั่งซื้อทั้งหมดให้เริ่มระบบใหม่ สะอาด 100%
app.get('/api/admin/reset-orders', async (req, res) => {
  try {
    const pool = db.getPool();
    await pool.query('DELETE FROM order_items');
    await pool.query('DELETE FROM orders');
    await pool.query('DELETE FROM carts');
    await pool.query('DELETE FROM wallet_transactions');
    await pool.query('UPDATE wallets SET balance = 0.00');
    await pool.query('UPDATE merchant_wallets SET balance = 0.00');

    res.send(`
      <div style="font-family: sans-serif; text-align: center; padding: 50px;">
        <h1 style="color: #10b981;">✅ ล้างข้อมูลทั้งหมดสะอาดหมดจด 100% แล้ว!</h1>
        <p>ยอดเงินทุกร้านเป็น 0.00 และออเดอร์เก่าถูกลบหมดแล้ว</p>
        <a href="/order.html" style="display: inline-block; padding: 10px 20px; background: #2563eb; color: white; border-radius: 6px; text-decoration: none; font-weight: bold;">ไปสั่งอาหารใหม่</a>
      </div>
    `);
  } catch (err) {
    res.status(500).send(`เกิดข้อผิดพลาด: ${err.message}`);
  }
});

// คำนวณยอดเงินสะสมจริงของร้านจากคำสั่งซื้อ completed
app.get('/api/admin/reset-wallets-audit', async (req, res) => {
  try {
    const pool = db.getPool();
    await pool.query('UPDATE merchant_wallets SET balance = 0.00');
    await pool.query('UPDATE wallets SET balance = 0.00');
    await pool.query("DELETE FROM wallet_transactions");

    const [doneOrders] = await pool.query(`
      SELECT id FROM orders 
      WHERE status IN ('completed', 'delivered', 'done', 'จัดส่งสำเร็จ')
      ORDER BY id ASC
    `);

    for (const ord of doneOrders) {
      await processOrderPayout(ord.id);
    }

    const [merchants] = await pool.query(`
      SELECT r.id, r.name, COALESCE(mw.balance, 0) AS balance
      FROM restaurants r
      LEFT JOIN merchant_wallets mw ON r.id = mw.restaurant_id
      ORDER BY r.id ASC
    `);

    res.send(`
      <div style="font-family: sans-serif; max-width: 650px; margin: 40px auto; padding: 25px; border-radius: 12px; background: white; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
        <h2 style="color: #10b981; margin-top:0;">✅ ตรวจสอบและแยกกระเป๋าเงินเด็ดขาดแล้ว</h2>
        <table style="width:100%; border-collapse: collapse; margin-top: 15px;">
          <tr style="background:#f1f5f9; text-align:left;">
            <th style="padding:10px; border:1px solid #cbd5e1;">รหัสร้าน</th>
            <th style="padding:10px; border:1px solid #cbd5e1;">ชื่อร้าน</th>
            <th style="padding:10px; border:1px solid #cbd5e1;">ยอดเงินคงเหลือจริง</th>
          </tr>
          ${merchants.map(m => `
            <tr>
              <td style="padding:10px; border:1px solid #cbd5e1;">ID: ${m.id}</td>
              <td style="padding:10px; border:1px solid #cbd5e1;">${m.name}</td>
              <td style="padding:10px; border:1px solid #cbd5e1; font-weight:bold; color:#059669;">฿${Number(m.balance).toLocaleString('th-TH', {minimumFractionDigits: 2})}</td>
            </tr>
          `).join('')}
        </table>
        <div style="margin-top:20px; text-align:center;">
          <a href="/merchant.html" style="background:#2563eb; color:white; padding:10px 20px; border-radius:6px; text-decoration:none; font-weight:bold;">กลับไปหน้า Merchant Dashboard</a>
        </div>
      </div>
    `);
  } catch (err) {
    res.status(500).send('เกิดข้อผิดพลาด: ' + err.message);
  }
});

// 1. ระบบสมาชิก
app.post('/api/register', (req, res) => authController.register(req, res));
app.post('/api/login', (req, res) => authController.login(req, res));

app.get('/api/users/:id', async (req, res) => {
  try {
    const pool = db.getPool();
    const [users] = await pool.query(
      'SELECT id, name, email, role, phone, address, restaurant_id, vehicle_type, vehicle_plate FROM users WHERE id = ?',
      [req.params.id]
    );
    if (users.length === 0) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้งานนี้' });
    res.json({ success: true, user: users[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลผู้ใช้ได้' });
  }
});

// 2. ร้านค้าและอาหาร
app.get('/api/restaurants', async (req, res) => {
  try {
    const pool = db.getPool();
    const [stores] = await pool.query(`SELECT id, name, phone, address, status, owner_id FROM restaurants ORDER BY id ASC`);
    res.json({ success: true, data: stores, restaurants: stores });
  } catch (error) {
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลร้านค้าได้' });
  }
});

app.post('/api/restaurants/register', async (req, res) => {
  try {
    const { name, phone, address, owner_id } = req.body;
    if (!name || !address) return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อร้านและที่อยู่ให้ครบถ้วน' });

    const pool = db.getPool();
    const [result] = await pool.query(
      `INSERT INTO restaurants (owner_id, name, phone, address, status) VALUES (?, ?, ?, ?, 'open')`,
      [Number(owner_id) || 1, name.trim(), phone ? phone.trim() : '', address.trim()]
    );
    await pool.query(`INSERT IGNORE INTO merchant_wallets (restaurant_id, balance) VALUES (?, 0.00)`, [result.insertId]);

    res.json({ success: true, message: 'สมัครเปิดร้านค้าใหม่สำเร็จ!', restaurantId: result.insertId });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.patch('/api/restaurants/:id', async (req, res) => {
  try {
    const pool = db.getPool();
    await pool.query(`UPDATE restaurants SET name = ?, phone = ?, address = ? WHERE id = ?`, 
      [req.body.name, req.body.phone, req.body.address, req.params.id]);
    res.json({ success: true, message: 'อัปเดตข้อมูลร้านค้าเรียบร้อย' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'ไม่สามารถอัปเดตข้อมูลได้' });
  }
});

app.get('/api/restaurants/:id/foods', (req, res) => foodController.getFoodsByRestaurant(req, res));

// 3. ตะกร้าสินค้า
app.get('/api/cart/:userId', async (req, res) => {
  try {
    const pool = db.getPool();
    const userId = Number(req.params.userId);

    const [rows] = await pool.query(`
      SELECT 
        c.id AS cart_id, c.id, c.user_id, c.food_id, c.quantity,
        CASE 
          WHEN c.food_id BETWEEN 1 AND 4 THEN 1
          WHEN c.food_id BETWEEN 5 AND 7 THEN 2
          WHEN c.food_id BETWEEN 8 AND 10 THEN 3
          WHEN c.food_id BETWEEN 11 AND 13 THEN 4
          ELSE 1
        END AS restaurant_id,
        COALESCE(NULLIF(f.name, ''), CONCAT('อาหารรหัส #', c.food_id)) AS name, 
        COALESCE(NULLIF(f.price, 0), 50.00) AS price, 
        COALESCE(NULLIF(f.image, ''), 'Image/logoweb.png') AS image
      FROM carts c
      LEFT JOIN foods f ON c.food_id = f.id
      WHERE c.user_id = ?
      ORDER BY c.id ASC
    `, [userId]);

    res.json({ success: true, data: rows, items: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลตะกร้าได้' });
  }
});

app.post('/api/cart', async (req, res) => {
  try {
    const pool = db.getPool();
    const { userId, user_id, foodId, food_id, quantity } = req.body;
    const uid = Number(userId || user_id);
    const fid = Number(foodId || food_id);
    const qty = Number(quantity || 1);

    if (!uid || !fid) return res.status(400).json({ success: false, message: 'ข้อมูลตะกร้าไม่ครบถ้วน' });

    let resolvedRid = 1;
    if (fid >= 1 && fid <= 4) resolvedRid = 1;
    else if (fid >= 5 && fid <= 7) resolvedRid = 2;
    else if (fid >= 8 && fid <= 10) resolvedRid = 3;
    else if (fid >= 11 && fid <= 13) resolvedRid = 4;

    const [exists] = await pool.query('SELECT id, quantity FROM carts WHERE user_id = ? AND food_id = ?', [uid, fid]);
    if (exists.length > 0) {
      const newQty = exists[0].quantity + qty;
      if (newQty <= 0) await pool.query('DELETE FROM carts WHERE id = ?', [exists[0].id]);
      else await pool.query('UPDATE carts SET quantity = ? WHERE id = ?', [newQty, exists[0].id]);
    } else {
      await pool.query('INSERT INTO carts (user_id, food_id, restaurant_id, quantity) VALUES (?, ?, ?, ?)', [uid, fid, resolvedRid, qty]);
    }
    res.json({ success: true, message: 'เพิ่มลงในตะกร้าสำเร็จ' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'บันทึกตะกร้าไม่สำเร็จ' });
  }
});

app.delete('/api/cart/:userId', async (req, res) => {
  try {
    const pool = db.getPool();
    await pool.query('DELETE FROM carts WHERE user_id = ?', [req.params.userId]);
    res.json({ success: true, message: 'ล้างตะกร้าเรียบร้อย' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'ล้างตะกร้าไม่สำเร็จ' });
  }
});

// 4. สั่งซื้อ
app.post('/api/orders', async (req, res) => {
  const pool = db.getPool();

  try {
    const payload = { ...req.body };
    const userId = Number(payload.user_id || payload.userId);
    const paymentMethod = String(payload.payment_method || 'cash').toLowerCase();
    const items = Array.isArray(payload.items) ? payload.items : [];

    if (!userId) return res.status(400).json({ success: false, message: 'กรุณาล็อกอินใหม่' });

    // กำหนด restaurant_id ให้ตรงกับเมนูอาหารจริง 100%
    if (items.length > 0) {
      const firstFoodId = Number(items[0].food_id || items[0].id);
      if (firstFoodId >= 1 && firstFoodId <= 4) payload.restaurant_id = 1;
      else if (firstFoodId >= 5 && firstFoodId <= 7) payload.restaurant_id = 2;
      else if (firstFoodId >= 8 && firstFoodId <= 10) payload.restaurant_id = 3;
      else if (firstFoodId >= 11 && firstFoodId <= 13) payload.restaurant_id = 4;
      else payload.restaurant_id = 1;
    }

    let amount = Number(payload.total_amount);
    if (isNaN(amount) || amount <= 0) {
      const subtotal = items.reduce((sum, it) => sum + (Number(it.price || 0) * Number(it.quantity || 1)), 0);
      amount = subtotal > 0 ? subtotal + 20 : 20;
    }
    payload.total_amount = amount;

    // ชำระด้วย Wallet ของลูกค้า (ตัดจากตาราง wallets)
    if (paymentMethod === 'wallet') {
      await pool.query('INSERT IGNORE INTO wallets (user_id, balance) VALUES (?, 0.00)', [userId]);
      const [wallets] = await pool.query('SELECT balance FROM wallets WHERE user_id = ?', [userId]);
      const currentBal = wallets.length > 0 ? Number(wallets[0].balance || 0) : 0;

      if (currentBal < amount) {
        return res.status(400).json({ success: false, message: 'ยอดเงินคงเหลือในกระเป๋าไม่เพียงพอสำหรับการสั่งซื้อ' });
      }

      await pool.query('UPDATE wallets SET balance = balance - ? WHERE user_id = ?', [amount, userId]);
    }

    const orderId = await orderRepo.createOrder(payload);

    if (paymentMethod === 'wallet') {
      await pool.query(
        `INSERT INTO wallet_transactions (wallet_id, order_id, amount, type, description)
         VALUES (?, ?, ?, 'order_payment', ?)`,
        [userId, orderId, -amount, `ชำระค่าอาหารคำสั่งซื้อ #${orderId}`]
      );
    }

    await pool.query('DELETE FROM carts WHERE user_id = ?', [userId]);

    res.json({ success: true, message: 'สร้างคำสั่งซื้อสำเร็จ', orderId: orderId });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'บันทึกคำสั่งซื้อไม่สำเร็จ' });
  }
});

app.get('/api/orders/:id', (req, res) => orderController.getOrder(req, res));

app.get('/api/users/:userId/orders', async (req, res) => {
  try {
    const orders = await orderRepo.getOrdersByUserId(req.params.userId);
    res.json({ success: true, data: orders });
  } catch (error) {
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงประวัติได้' });
  }
});

app.post('/api/orders/:id/cancel', async (req, res) => {
  const pool = db.getPool();
  try {
    const orderId = req.params.id;
    const { userId } = req.body;

    const [orders] = await pool.query('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (orders.length === 0) return res.status(404).json({ success: false, message: 'ไม่พบออเดอร์นี้' });

    const order = orders[0];
    if (['preparing', 'ready', 'delivering', 'completed', 'delivered'].includes(order.status)) {
      return res.status(400).json({ success: false, message: 'ไม่สามารถยกเลิกได้ เนื่องจากเริ่มจัดส่งแล้ว' });
    }

    await pool.query('UPDATE orders SET status = "cancelled" WHERE id = ?', [orderId]);

    if (order.payment_method === 'wallet') {
      const refundAmount = Number(order.total_amount) || 0;
      const targetUid = userId || order.user_id;

      await pool.query(
        `INSERT INTO wallets (user_id, balance) VALUES (?, ?) ON DUPLICATE KEY UPDATE balance = balance + ?`,
        [targetUid, refundAmount, refundAmount]
      );

      await pool.query(
        `INSERT INTO wallet_transactions (wallet_id, order_id, amount, type, description)
         VALUES (?, ?, ?, 'refund', ?)`,
        [targetUid, orderId, refundAmount, `คืนเงินจากการยกเลิกคำสั่งซื้อ #${orderId}`]
      );
    }

    delete orderLiveLocations[orderId];
    res.json({ success: true, message: 'ยกเลิกคำสั่งซื้อและคืนเงินเรียบร้อยแล้ว' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 5. แดชบอร์ดร้านค้า
app.get('/api/restaurant/orders', async (req, res) => {
  try {
    const restaurantId = req.query.restaurant_id;
    if (!restaurantId) return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสร้านค้า' });
    const orders = await orderRepo.getOrdersByRestaurantId(restaurantId);
    res.json({ success: true, orders: orders });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 6. ไรเดอร์
app.get('/api/rider/orders', async (req, res) => {
  try {
    const pool = db.getPool();
    const [orders] = await pool.query(`
      SELECT o.id, o.restaurant_id, o.rider_id, o.delivery_address, o.payment_method, 
             o.total_amount, o.status, o.created_at,
             COALESCE(u.name, 'ลูกค้า') AS customer_name,
             COALESCE(u.phone, '-') AS customer_phone,
             COALESCE(r.name, '') AS restaurant_name
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN restaurants r ON o.restaurant_id = r.id
      ORDER BY o.created_at DESC LIMIT 30
    `);

    for (let order of orders) {
      const [items] = await pool.query(`
        SELECT COALESCE(oi.food_name, f.name, CONCAT('อาหารรหัส #', oi.food_id)) AS food_name,
               oi.price, oi.quantity 
        FROM order_items oi
        LEFT JOIN foods f ON oi.food_id = f.id
        WHERE oi.order_id = ?
      `, [order.id]);
      order.items = items;
    }
    res.json({ success: true, orders: orders });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 7. พิกัด GPS
app.post('/api/orders/:id/location', (req, res) => {
  const { id } = req.params;
  const { lat, lng, rider_name, rider_phone, vehicle_plate } = req.body;
  orderLiveLocations[id] = {
    lat: Number(lat), lng: Number(lng),
    rider_name: rider_name || 'ไรเดอร์', rider_phone: rider_phone || '', vehicle_plate: vehicle_plate || '',
    updatedAt: new Date()
  };
  res.json({ success: true, message: 'บันทึกพิกัดเรียบร้อย' });
});

app.get('/api/orders/:id/location', (req, res) => {
  res.json({ success: true, location: orderLiveLocations[req.params.id] || { lat: 13.7437, lng: 100.4889, rider_name: 'ไรเดอร์นำส่ง', isDefault: true } });
});

// 8. ปรับสถานะคำสั่งซื้อ
app.patch('/api/orders/:id/status', async (req, res) => {
  try {
    const orderId = req.params.id;
    const { status, rider_id, riderId } = req.body;
    if (!status) return res.status(400).json({ success: false, message: 'กรุณาระบุสถานะ' });

    const cleanStatus = String(status).trim().toLowerCase();
    const finalRiderId = Number(rider_id || riderId) || null;
    const pool = db.getPool();

    if (finalRiderId) {
      await pool.query('UPDATE orders SET rider_id = ?, status = ? WHERE id = ?', [finalRiderId, cleanStatus, orderId]);
    } else {
      await pool.query('UPDATE orders SET status = ? WHERE id = ?', [cleanStatus, orderId]);
    }

    const isCompleted = ['completed', 'delivered', 'success', 'done', 'จัดส่งสำเร็จ', 'ส่งถึงมือลูกค้าแล้ว'].includes(cleanStatus);
    if (isCompleted || cleanStatus === 'cancelled') delete orderLiveLocations[orderId];

    if (isCompleted) {
      await processOrderPayout(orderId, finalRiderId);
    }

    res.json({ success: true, message: `อัปเดตสถานะเป็น ${cleanStatus} เรียบร้อยแล้ว` });
  } catch (error) {
    res.status(500).json({ success: false, message: 'ไม่สามารถอัปเดตสถานะได้' });
  }
});

// ----------------------------------------------------
// 9. ระบบกระเป๋าเงิน (แยกขาดร้านค้า 1-4 vs ลูกค้า 100%)
// ----------------------------------------------------
const handleWalletFetch = async (req, res) => {
  try {
    const pool = db.getPool();
    const targetId = Number(req.params.userId);

    // ถ้ารหัส 1-4 คือร้านค้า (ดึงจาก merchant_wallets ร้านใครร้านมัน ไม่ปนกับใครเด็ดขาด!)
    if (targetId >= 1 && targetId <= 4) {
      await pool.query(`INSERT IGNORE INTO merchant_wallets (restaurant_id, balance) VALUES (?, 0.00)`, [targetId]);
      const [mw] = await pool.query(`SELECT balance FROM merchant_wallets WHERE restaurant_id = ?`, [targetId]);
      const currentBalance = mw.length > 0 ? Number(mw[0].balance || 0).toFixed(2) : "0.00";

      const [txs] = await pool.query(
        `SELECT * FROM wallet_transactions WHERE wallet_id = ? ORDER BY created_at DESC LIMIT 20`,
        [targetId]
      );

      return res.json({ success: true, balance: currentBalance, transactions: txs });
    }

    // ถ้าไม่ใช่ร้านค้า (ลูกค้า / ไรเดอร์) ดึงจากตาราง wallets
    await pool.query(`INSERT IGNORE INTO wallets (user_id, balance) VALUES (?, 0.00)`, [targetId]);
    const [w] = await pool.query(`SELECT balance FROM wallets WHERE user_id = ?`, [targetId]);
    const currentBalance = w.length > 0 ? Number(w[0].balance || 0).toFixed(2) : "0.00";

    const [txs] = await pool.query(
      `SELECT * FROM wallet_transactions WHERE wallet_id = ? ORDER BY created_at DESC LIMIT 20`,
      [targetId]
    );

    res.json({ success: true, balance: currentBalance, transactions: txs });
  } catch (err) {
    console.error('Fetch Wallet Error:', err.message);
    res.json({ success: true, balance: "0.00", transactions: [] });
  }
};

app.get('/api/wallet/:userId', handleWalletFetch);
app.get('/wallet/:userId', handleWalletFetch);

// เติมเงินเข้ากระเป๋าลูกค้า (เข้าตาราง wallets ตรงๆ 100% ไม่ติด Foreign Key)
const handleWalletTopup = async (req, res) => {
  const pool = db.getPool();
  try {
    const { userId, amount } = req.body;
    const topupAmount = Number(amount);
    const uid = Number(userId);

    if (!uid || isNaN(topupAmount) || topupAmount <= 0) {
      return res.status(400).json({ success: false, message: 'จำนวนเงินเติมไม่ถูกต้อง' });
    }

    // เพิ่มเงินเข้าตาราง wallets ของลูกค้า
    await pool.query(
      `INSERT INTO wallets (user_id, balance) VALUES (?, ?) ON DUPLICATE KEY UPDATE balance = balance + ?`,
      [uid, topupAmount, topupAmount]
    );

    // บันทึกประวัติ
    await pool.query(
      `INSERT INTO wallet_transactions (wallet_id, amount, type, description)
       VALUES (?, ?, 'topup', ?)`,
      [uid, topupAmount, `เติมเงินเข้ากระเป๋าสำเร็จ จำนวน ${topupAmount.toFixed(2)} บาท`]
    );

    console.log(`💳 [Topup Success] User #${uid} เติมเงินสำเร็จ ฿${topupAmount}`);
    res.json({ success: true, message: `เติมเงินสำเร็จ ฿${topupAmount.toFixed(2)}` });
  } catch (err) {
    console.error('Topup Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการเติมเงิน: ' + err.message });
  }
};

app.post('/api/wallet/topup', handleWalletTopup);
app.post('/wallet/topup', handleWalletTopup);

// ถอนเงินออกจากกระเป๋า (ร้านค้าตัดจาก merchant_wallets ของตัวเองร้านเดียว!)
const handleWalletWithdraw = async (req, res) => {
  const pool = db.getPool();

  try {
    const { userId, amount, bank_name, account_no } = req.body;
    const withdrawAmount = Number(amount);
    let targetId = Number(userId);

    if (!targetId || isNaN(withdrawAmount) || withdrawAmount <= 0) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุจำนวนเงินที่ถูกต้อง' });
    }

    // กรณีร้านค้า 1-4 (ตัดจาก merchant_wallets ร้านตัวเองเท่านั้น ไม่แตะร้านอื่นเด็ดขาด!)
    if (targetId >= 1 && targetId <= 4) {
      const [mw] = await pool.query(`SELECT balance FROM merchant_wallets WHERE restaurant_id = ?`, [targetId]);
      const currentBal = mw.length > 0 ? Number(mw[0].balance || 0) : 0;

      if (currentBal < withdrawAmount) {
        return res.status(400).json({
          success: false,
          message: `ยอดเงินคงเหลือไม่เพียงพอสำหรับการถอน (คงเหลือ: ฿${currentBal.toFixed(2)})`
        });
      }

      // ตัดเงินเฉพาะร้านนี้ร้านเดียว 100%
      await pool.query(`UPDATE merchant_wallets SET balance = balance - ? WHERE restaurant_id = ?`, [withdrawAmount, targetId]);

      const bankDesc = bank_name && account_no 
        ? `ถอนเงินเข้าบัญชี ${bank_name} (${account_no}) จำนวน ฿${withdrawAmount.toFixed(2)}`
        : `ถอนเงินเข้าบัญชีธนาคาร จำนวน ฿${withdrawAmount.toFixed(2)}`;

      await pool.query(
        `INSERT INTO wallet_transactions (wallet_id, amount, type, description)
         VALUES (?, ?, 'merchant_withdraw', ?)`,
        [targetId, -withdrawAmount, bankDesc]
      );

      console.log(`💸 [Merchant Withdraw] ร้าน #${targetId} ถอนเงินสำเร็จ: ฿${withdrawAmount}`);

      return res.json({ 
        success: true, 
        message: `ถอนเงินสำเร็จ ฿${withdrawAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} โอนเข้าบัญชีเรียบร้อยแล้ว` 
      });
    }

    // กรณี User ทั่วไป หรือไรเดอร์
    const [wallets] = await pool.query(`SELECT balance FROM wallets WHERE user_id = ?`, [targetId]);
    const currentBal = wallets.length > 0 ? Number(wallets[0].balance || 0) : 0;

    if (currentBal < withdrawAmount) {
      return res.status(400).json({ 
        success: false, 
        message: `ยอดเงินคงเหลือไม่เพียงพอสำหรับการถอน (คงเหลือ: ฿${currentBal.toFixed(2)})` 
      });
    }

    await pool.query('UPDATE wallets SET balance = balance - ? WHERE user_id = ?', [withdrawAmount, targetId]);

    const bankDesc = bank_name && account_no 
      ? `ถอนเงินเข้าบัญชี ${bank_name} (${account_no}) จำนวน ฿${withdrawAmount.toFixed(2)}`
      : `ถอนเงินเข้าบัญชีธนาคาร จำนวน ฿${withdrawAmount.toFixed(2)}`;

    await pool.query(
      `INSERT INTO wallet_transactions (wallet_id, amount, type, description)
       VALUES (?, ?, 'withdraw', ?)`,
      [targetId, -withdrawAmount, bankDesc]
    );

    return res.json({ 
      success: true, 
      message: `ถอนเงินสำเร็จ ฿${withdrawAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} โอนเข้าบัญชีเรียบร้อยแล้ว` 
    });

  } catch (error) {
    console.error('Withdraw Error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด: ' + error.message });
  }
};

app.post('/api/wallet/withdraw', handleWalletWithdraw);
app.post('/wallet/withdraw', handleWalletWithdraw);

// ชี้ตำแหน่งไฟล์ Static
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, '../')));
app.use('/Image', express.static(path.join(__dirname, '../Image')));
app.use('/image', express.static(path.join(__dirname, '../Image')));
app.use('/images', express.static(path.join(__dirname, '../Image')));

function sendHtmlFile(res, fileName1, fileName2) {
  res.sendFile(path.join(__dirname, fileName1), (err) => {
    if (err && fileName2) {
      res.sendFile(path.join(__dirname, fileName2), (err2) => {
        if (err2) {
          const parentFile = path.join(__dirname, '../', fileName1);
          res.sendFile(parentFile, (err3) => {
            if (err3) res.status(404).send(`ไม่พบไฟล์ ${fileName1}`);
          });
        }
      });
    } else if (err) {
      const parentFile = path.join(__dirname, '../', fileName1);
      res.sendFile(parentFile, (err3) => {
        if (err3) res.status(404).send(`ไม่พบไฟล์ ${fileName1}`);
      });
    }
  });
}

// หน้าเว็บทั้งหมด
app.get('/', (req, res) => sendHtmlFile(res, 'index.html'));
app.get('/index.html', (req, res) => sendHtmlFile(res, 'index.html'));
app.get('/login.html', (req, res) => sendHtmlFile(res, 'Login.html', 'login.html'));
app.get('/Login.html', (req, res) => sendHtmlFile(res, 'Login.html', 'login.html'));
app.get('/register.html', (req, res) => sendHtmlFile(res, 'Register.html', 'register.html'));
app.get('/Register.html', (req, res) => sendHtmlFile(res, 'Register.html', 'register.html'));
app.get('/cart.html', (req, res) => sendHtmlFile(res, 'cart.html'));
app.get('/checkout.html', (req, res) => sendHtmlFile(res, 'checkout.html'));
app.get('/order.html', (req, res) => sendHtmlFile(res, 'order.html'));
app.get('/menu.html', (req, res) => sendHtmlFile(res, 'menu.html'));
app.get('/merchant.html', (req, res) => sendHtmlFile(res, 'merchant.html'));
app.get('/rider.html', (req, res) => sendHtmlFile(res, 'rider.html'));
app.get('/restaurants.html', (req, res) => sendHtmlFile(res, 'restaurants.html'));
app.get('/restaurant.html', (req, res) => sendHtmlFile(res, 'restaurants.html', 'restaurant.html'));
app.get('/burger.html', (req, res) => sendHtmlFile(res, 'burger.html'));
app.get('/pizza.html', (req, res) => sendHtmlFile(res, 'pizza.html'));
app.get('/noodles.html', (req, res) => sendHtmlFile(res, 'noodles.html'));

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, async () => {
  console.log('----------------------------------------------------');
  console.log(`🚀 Platform พร้อมทำงานแล้วที่ Port ${PORT}`);
  console.log(`🌐 เข้าใช้งานได้ที่: http://localhost:${PORT}`);
  console.log('----------------------------------------------------');
  await initializeDatabaseTables();
});