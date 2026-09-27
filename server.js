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

// สร้าง Object ของ Controller และ Repository
const authController = new AuthController();
const foodController = new FoodController();
const cartController = new CartController();
const orderController = new OrderController();
const orderRepo = new OrderRepository();

// เก็บพิกัด GPS ล่าสุดของไรเดอร์ในหน่วยความจำ
const orderLiveLocations = {};

// ----------------------------------------------------
// ระบบเตรียมตารางฐานข้อมูลอัตโนมัติ (Auto Migration Guard)
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

    // 7. ตารางกระเป๋าเงิน (Wallets)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wallets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL UNIQUE,
        balance DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 8. ตารางประวัติธุรกรรมกระเป๋าเงิน (Wallet Transactions)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wallet_transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        wallet_id INT NOT NULL,
        order_id INT DEFAULT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        type VARCHAR(50) NOT NULL,
        description VARCHAR(255) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE,
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    console.log('✅ [Database] โครงสร้างตารางทั้งหมดพร้อมใช้งานสมบูรณ์');
  } catch (err) {
    console.error('⚠️ [Database Init Notice]:', err.message);
  }
}

// ----------------------------------------------------
// ฟังก์ชันจัดสรรเงินเข้ากระเป๋าร้านค้าและไรเดอร์ (Payout Guard)
// ----------------------------------------------------
async function processOrderPayout(orderId) {
  const pool = db.getPool();
  let conn;

  try {
    conn = await pool.getConnection();

    // 1. ป้องกันการจ่ายเงินซ้ำ (Idempotency Check)
    const [alreadyPaid] = await conn.query(
      'SELECT id FROM wallet_transactions WHERE order_id = ? AND type = "order_earning" LIMIT 1',
      [orderId]
    );

    if (alreadyPaid.length > 0) {
      console.log(`[Payout Skipped] คำสั่งซื้อ #${orderId} เคยผ่านการจัดสรรเงินแล้ว`);
      return;
    }

    // 2. ดึงข้อมูลออเดอร์และเจ้าของร้าน
    const [orders] = await conn.query(
      `SELECT o.id, o.restaurant_id, o.rider_id, o.total_amount, r.owner_id 
       FROM orders o
       JOIN restaurants r ON o.restaurant_id = r.id
       WHERE o.id = ?`,
      [orderId]
    );

    if (orders.length === 0) return;
    const order = orders[0];

    const deliveryFee = 20.00;
    const foodAmount = Math.max(0, Number(order.total_amount) - deliveryFee);
    const gpPercent = 0.15;
    const gpFee = foodAmount * gpPercent;
    const merchantNet = Number((foodAmount - gpFee).toFixed(2));

    await conn.beginTransaction();

    // 3. จัดสรรเงินให้ร้านค้า
    if (order.owner_id) {
      await conn.query('INSERT IGNORE INTO wallets (user_id, balance) VALUES (?, 0.00)', [order.owner_id]);
      await conn.query('UPDATE wallets SET balance = balance + ? WHERE user_id = ?', [merchantNet, order.owner_id]);

      const [w] = await conn.query('SELECT id FROM wallets WHERE user_id = ?', [order.owner_id]);
      if (w.length > 0) {
        await conn.query(
          `INSERT INTO wallet_transactions (wallet_id, order_id, amount, type, description)
           VALUES (?, ?, ?, 'order_earning', ?)`,
          [w[0].id, order.id, merchantNet, `รายได้จากคำสั่งซื้อ #${order.id} (หัก GP 15% เรียบร้อย)`]
        );
      }
    }

    // 4. จัดสรรเงินค่ารอบให้ไรเดอร์
    if (order.rider_id) {
      await conn.query('INSERT IGNORE INTO wallets (user_id, balance) VALUES (?, 0.00)', [order.rider_id]);
      await conn.query('UPDATE wallets SET balance = balance + ? WHERE user_id = ?', [deliveryFee, order.rider_id]);

      const [rw] = await conn.query('SELECT id FROM wallets WHERE user_id = ?', [order.rider_id]);
      if (rw.length > 0) {
        await conn.query(
          `INSERT INTO wallet_transactions (wallet_id, order_id, amount, type, description)
           VALUES (?, ?, ?, 'delivery_fee', ?)`,
          [rw[0].id, order.id, deliveryFee, `ค่ารอบจัดส่งคำสั่งซื้อ #${order.id}`]
        );
      }
    }

    await conn.commit();
    console.log(`[Payout Success] ออเดอร์ #${orderId}: ร้านค้า +${merchantNet} บ., ไรเดอร์ +${deliveryFee} บ.`);
  } catch (error) {
    if (conn) await conn.rollback();
    console.error('Order Payout Processing Error (Non-Fatal):', error.message);
  } finally {
    if (conn) conn.release();
  }
}

// เช็กสถานะเซิร์ฟเวอร์ (Health Check)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// 1. เส้นทางระบบสมาชิก (Auth & User Profile)
app.post('/api/register', (req, res) => authController.register(req, res));
app.post('/api/login', (req, res) => authController.login(req, res));

app.get('/api/users/:id', async (req, res) => {
  try {
    const pool = db.getPool();
    const [users] = await pool.query(
      'SELECT id, name, email, role, phone, address, restaurant_id, vehicle_type, vehicle_plate FROM users WHERE id = ?',
      [req.params.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้งานนี้' });
    }

    res.json({ success: true, user: users[0] });
  } catch (error) {
    console.error('Fetch User Profile Error:', error);
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลผู้ใช้ได้' });
  }
});

// 2. เส้นทางร้านค้าและอาหาร (Restaurants & Foods)
app.get('/api/restaurants', async (req, res) => {
  try {
    const pool = db.getPool();
    const [stores] = await pool.query(
      `SELECT id, name, phone, address, status, owner_id FROM restaurants ORDER BY id ASC`
    );
    res.json({ success: true, data: stores, restaurants: stores });
  } catch (error) {
    console.error('Fetch Restaurants Error:', error);
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลร้านค้าได้' });
  }
});

app.post('/api/restaurants/register', async (req, res) => {
  try {
    const { name, phone, address, owner_id } = req.body;

    if (!name || !address) {
      return res.status(400).json({
        success: false,
        message: 'กรุณากรอกชื่อร้านและที่อยู่ให้ครบถ้วน'
      });
    }

    const pool = db.getPool();
    let validOwnerId = Number(owner_id) || 1;
    const [users] = await pool.query('SELECT id FROM users WHERE id = ?', [validOwnerId]);

    if (users.length === 0) {
      const [firstUser] = await pool.query('SELECT id FROM users ORDER BY id ASC LIMIT 1');
      if (firstUser.length > 0) {
        validOwnerId = firstUser[0].id;
      } else {
        const [newUser] = await pool.query(
          `INSERT INTO users (name, email, password, role) VALUES ('Store Admin', 'admin@store.com', '123456', 'restaurant')`
        );
        validOwnerId = newUser.insertId;
      }
    }

    const [result] = await pool.query(
      `INSERT INTO restaurants (owner_id, name, phone, address, status) VALUES (?, ?, ?, ?, 'open')`,
      [validOwnerId, name.trim(), phone ? phone.trim() : '', address.trim()]
    );

    await pool.query('UPDATE users SET restaurant_id = ? WHERE id = ?', [result.insertId, validOwnerId]);
    console.log(`[Store Registered] เปิดร้านใหม่รหัส #${result.insertId} : ${name}`);

    res.json({
      success: true,
      message: 'สมัครเปิดร้านค้าใหม่สำเร็จ!',
      restaurantId: result.insertId
    });
  } catch (error) {
    console.error('Store Registration Error:', error);
    res.status(500).json({
      success: false,
      message: error.sqlMessage || error.message || 'ไม่สามารถสมัครร้านค้าได้'
    });
  }
});

app.patch('/api/restaurants/:id', async (req, res) => {
  try {
    const restaurantId = req.params.id;
    const { name, phone, address } = req.body;
    const pool = db.getPool();

    await pool.query(
      `UPDATE restaurants SET name = ?, phone = ?, address = ? WHERE id = ?`,
      [name, phone, address, restaurantId]
    );

    res.json({ success: true, message: 'อัปเดตข้อมูลร้านค้าเรียบร้อย' });
  } catch (error) {
    console.error('Update Restaurant Error:', error);
    res.status(500).json({ success: false, message: 'ไม่สามารถอัปเดตข้อมูลร้านค้าได้' });
  }
});

app.get('/api/restaurants/:id/foods', (req, res) => foodController.getFoodsByRestaurant(req, res));

// 3. เส้นทางตะกร้าสินค้า (Cart)
app.get('/api/cart/:userId', async (req, res) => {
  try {
    const pool = db.getPool();
    const userId = req.params.userId;

    const [rows] = await pool.query(`
      SELECT c.*, 
             COALESCE(c.restaurant_id, f.restaurant_id) AS restaurant_id,
             f.name, f.price, f.image
      FROM carts c
      LEFT JOIN foods f ON c.food_id = f.id
      WHERE c.user_id = ?
    `, [userId]);

    res.json({ success: true, data: rows, items: rows });
  } catch (err) {
    if (typeof cartController.getUserCart === 'function') {
      return cartController.getUserCart(req, res);
    }
    console.error('Fetch Cart Error:', err);
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงข้อมูลตะกร้าได้' });
  }
});

app.post('/api/cart', async (req, res) => {
  try {
    const pool = db.getPool();
    const { userId, user_id, foodId, food_id, restaurantId, restaurant_id, quantity } = req.body;
    const uid = Number(userId || user_id);
    const fid = Number(foodId || food_id);
    const rid = Number(restaurantId || restaurant_id || 0);
    const qty = Number(quantity || 1);

    if (!uid || !fid) {
      return res.status(400).json({ success: false, message: 'ข้อมูลตะกร้าไม่ครบถ้วน' });
    }

    const [exists] = await pool.query('SELECT id, quantity FROM carts WHERE user_id = ? AND food_id = ?', [uid, fid]);

    if (exists.length > 0) {
      const newQty = exists[0].quantity + qty;
      if (newQty <= 0) {
        await pool.query('DELETE FROM carts WHERE id = ?', [exists[0].id]);
      } else {
        await pool.query('UPDATE carts SET quantity = ? WHERE id = ?', [newQty, exists[0].id]);
      }
    } else {
      let finalRid = rid;
      if (!finalRid || finalRid === 0) {
        const [foodRows] = await pool.query('SELECT restaurant_id FROM foods WHERE id = ?', [fid]);
        if (foodRows.length > 0) {
          finalRid = foodRows[0].restaurant_id;
        }
      }

      await pool.query(
        'INSERT INTO carts (user_id, food_id, restaurant_id, quantity) VALUES (?, ?, ?, ?)',
        [uid, fid, finalRid || 1, qty]
      );
    }

    res.json({ success: true, message: 'เพิ่มลงในตะกร้าสำเร็จ' });
  } catch (error) {
    console.error('Update Cart Error:', error);
    if (typeof cartController.updateItem === 'function') {
      return cartController.updateItem(req, res);
    }
    res.status(500).json({ success: false, message: 'บันทึกตะกร้าไม่สำเร็จ' });
  }
});

app.delete('/api/cart/:userId', async (req, res) => {
  try {
    const pool = db.getPool();
    await pool.query('DELETE FROM carts WHERE user_id = ?', [req.params.userId]);
    res.json({ success: true, message: 'ล้างตะกร้าเรียบร้อย' });
  } catch (error) {
    if (typeof cartController.clearUserCart === 'function') {
      return cartController.clearUserCart(req, res);
    }
    res.status(500).json({ success: false, message: 'ล้างตะกร้าไม่สำเร็จ' });
  }
});

// 4. เส้นทางคำสั่งซื้อ (Orders)
app.post('/api/orders', async (req, res) => {
  const pool = db.getPool();
  let conn;

  try {
    const payload = { ...req.body };
    const userId = Number(payload.user_id || payload.userId);
    const paymentMethod = payload.payment_method;

    let amount = Number(payload.total_amount);
    if (isNaN(amount) || amount <= 0) {
      const items = Array.isArray(payload.items) ? payload.items : [];
      const subtotal = items.reduce((sum, it) => {
        const p = Number(it.price || it.food_price || 0);
        const q = Number(it.quantity || it.qty || 1);
        return sum + (p * q);
      }, 0);
      amount = subtotal > 0 ? subtotal + 20 : 20;
    }
    payload.total_amount = amount;

    conn = await pool.getConnection();
    await conn.beginTransaction();

    if (paymentMethod === 'wallet') {
      const [wallets] = await conn.query('SELECT * FROM wallets WHERE user_id = ? FOR UPDATE', [userId]);
      if (wallets.length === 0 || Number(wallets[0].balance) < amount) {
        await conn.rollback();
        return res.status(400).json({
          success: false,
          message: 'ยอดเงินคงเหลือในกระเป๋าไม่เพียงพอสำหรับการสั่งซื้อ'
        });
      }

      const wallet = wallets[0];
      await conn.query('UPDATE wallets SET balance = balance - ? WHERE id = ?', [amount, wallet.id]);
    }

    const orderId = await orderRepo.createOrder(payload);

    if (paymentMethod === 'wallet') {
      const [wallets] = await conn.query('SELECT id FROM wallets WHERE user_id = ?', [userId]);
      if (wallets.length > 0) {
        await conn.query(
          `INSERT INTO wallet_transactions (wallet_id, order_id, amount, type, description)
           VALUES (?, ?, ?, 'order_payment', ?)`,
          [wallets[0].id, orderId, -amount, `ชำระค่าอาหารคำสั่งซื้อ #${orderId}`]
        );
      }
    }

    await conn.commit();

    res.json({
      success: true,
      message: 'สร้างคำสั่งซื้อสำเร็จ',
      orderId: orderId
    });
  } catch (error) {
    if (conn) await conn.rollback();
    console.error('Create Order Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'บันทึกคำสั่งซื้อไม่สำเร็จ'
    });
  } finally {
    if (conn) conn.release();
  }
});

app.get('/api/orders/:id', (req, res) => orderController.getOrder(req, res));

app.get('/api/users/:userId/orders', async (req, res) => {
  try {
    const { userId } = req.params;
    const orders = await orderRepo.getOrdersByUserId(userId);
    res.json({ success: true, data: orders });
  } catch (error) {
    console.error('Fetch User Orders Error:', error);
    res.status(500).json({ success: false, message: 'ไม่สามารถดึงประวัติคำสั่งซื้อได้' });
  }
});

app.post('/api/orders/:id/cancel', async (req, res) => {
  const pool = db.getPool();
  let conn;

  try {
    const orderId = req.params.id;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสผู้ใช้งาน' });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [orders] = await conn.query('SELECT total_amount, payment_method, status FROM orders WHERE id = ?', [orderId]);
    if (orders.length > 0 && orders[0].payment_method === 'wallet' && orders[0].status !== 'cancelled') {
      const refundAmount = Number(orders[0].total_amount);
      await conn.query('INSERT IGNORE INTO wallets (user_id, balance) VALUES (?, 0.00)', [userId]);
      await conn.query('UPDATE wallets SET balance = balance + ? WHERE user_id = ?', [refundAmount, userId]);

      const [w] = await conn.query('SELECT id FROM wallets WHERE user_id = ?', [userId]);
      if (w.length > 0) {
        await conn.query(
          `INSERT INTO wallet_transactions (wallet_id, order_id, amount, type, description)
           VALUES (?, ?, ?, 'refund', ?)`,
          [w[0].id, orderId, refundAmount, `คืนเงินจากการยกเลิกคำสั่งซื้อ #${orderId}`]
        );
      }
    }

    await orderRepo.cancelOrder(orderId, userId);
    await conn.commit();

    res.json({ success: true, message: 'ยกเลิกคำสั่งซื้อและคืนเงินเข้ากระเป๋าเรียบร้อยแล้ว' });
  } catch (error) {
    if (conn) await conn.rollback();
    console.error('Cancel Order Error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'ไม่สามารถยกเลิกคำสั่งซื้อได้'
    });
  } finally {
    if (conn) conn.release();
  }
});

// 5. เส้นทางสำหรับร้านอาหาร (Merchant Dashboard)
app.get('/api/restaurant/orders', async (req, res) => {
  try {
    const restaurantId = req.query.restaurant_id;
    if (!restaurantId) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสร้านค้า (restaurant_id)' });
    }

    const orders = await orderRepo.getOrdersByRestaurantId(restaurantId);
    res.json({ success: true, orders: orders });
  } catch (error) {
    console.error('Fetch Restaurant Orders Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'ไม่สามารถดึงข้อมูลคำสั่งซื้อของร้านได้'
    });
  }
});

// 6. เส้นทางสำหรับไรเดอร์ (Rider Dashboard)
app.get('/api/rider/orders', async (req, res) => {
  try {
    const pool = db.getPool();
    const [orders] = await pool.query(`
      SELECT o.id, o.restaurant_id, o.delivery_address, o.payment_method, 
             o.total_amount, o.status, o.created_at,
             u.name AS customer_name,
             u.phone AS customer_phone,
             r.name AS restaurant_name
      FROM orders o
      JOIN users u ON o.user_id = u.id
      JOIN restaurants r ON o.restaurant_id = r.id
      WHERE o.status IN ('ready', 'delivering', 'completed')
      ORDER BY o.created_at DESC
      LIMIT 30
    `);

    for (let order of orders) {
      const [items] = await pool.query(`
        SELECT COALESCE(oi.food_name, f.name, CONCAT('อาหารรหัส #', oi.food_id)) AS food_name,
               oi.price, 
               oi.quantity 
        FROM order_items oi
        LEFT JOIN foods f ON oi.food_id = f.id
        WHERE oi.order_id = ?
      `, [order.id]);
      order.items = items;
    }

    res.json({ success: true, orders: orders });
  } catch (error) {
    console.error('Fetch Rider Orders Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'ไม่สามารถดึงข้อมูลคำสั่งซื้อสำหรับไรเดอร์ได้'
    });
  }
});

// 7. พิกัด GPS ไรเดอร์ Real-time
app.post('/api/orders/:id/location', (req, res) => {
  const { id } = req.params;
  const { lat, lng, rider_name, rider_phone, vehicle_plate } = req.body;

  orderLiveLocations[id] = {
    lat: Number(lat),
    lng: Number(lng),
    rider_name: rider_name || 'ไรเดอร์',
    rider_phone: rider_phone || '',
    vehicle_plate: vehicle_plate || '',
    updatedAt: new Date()
  };

  res.json({ success: true, message: 'บันทึกพิกัดเรียบร้อย' });
});

app.get('/api/orders/:id/location', (req, res) => {
  const { id } = req.params;
  const loc = orderLiveLocations[id] || {
    lat: 13.7437,
    lng: 100.4889,
    rider_name: 'ไรเดอร์นำส่ง',
    isDefault: true
  };
  res.json({ success: true, location: loc });
});

// 8. ปรับสถานะคำสั่งซื้อ & Payout Trigger
app.patch('/api/orders/:id/status', async (req, res) => {
  try {
    const orderId = req.params.id;
    const { status, rider_id } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุสถานะใหม่' });
    }

    await orderRepo.updateStatus(orderId, status);

    if (rider_id) {
      const pool = db.getPool();
      try {
        await pool.query('UPDATE orders SET rider_id = ? WHERE id = ?', [Number(rider_id), orderId]);
      } catch (err) {}
    }

    if (status === 'completed' || status === 'cancelled') {
      delete orderLiveLocations[orderId];
    }

    if (status === 'completed') {
      await processOrderPayout(orderId);
    }

    res.json({
      success: true,
      message: `อัปเดตสถานะเป็น ${status} เรียบร้อยแล้ว`
    });
  } catch (error) {
    console.error('Update Status Error:', error);
    res.status(500).json({
      success: false,
      message: 'ไม่สามารถอัปเดตสถานะได้'
    });
  }
});

// 9. ระบบกระเป๋าเงิน (Wallet, Top-up & Withdrawal)
const handleWalletFetch = async (req, res) => {
  try {
    const pool = db.getPool();
    const uid = Number(req.params.userId);

    const [wallets] = await pool.query('SELECT * FROM wallets WHERE user_id = ?', [uid]);

    if (wallets.length === 0) {
      return res.json({ success: true, balance: "0.00", transactions: [] });
    }

    const wallet = wallets[0];
    const [txs] = await pool.query(
      'SELECT * FROM wallet_transactions WHERE wallet_id = ? ORDER BY created_at DESC LIMIT 20',
      [wallet.id]
    );

    res.json({
      success: true,
      balance: wallet.balance,
      transactions: txs
    });
  } catch (err) {
    console.error('Fetch Wallet Error:', err.message);
    res.json({ success: true, balance: "0.00", transactions: [] });
  }
};

app.get('/api/wallet/:userId', handleWalletFetch);
app.get('/wallet/:userId', handleWalletFetch);

// เติมเงินเข้ากระเป๋าลูกค้า (Customer Top-up)
const handleWalletTopup = async (req, res) => {
  const pool = db.getPool();
  try {
    const { userId, amount } = req.body;
    const topupAmount = Number(amount);
    const uid = Number(userId);

    if (!uid || isNaN(topupAmount) || topupAmount <= 0) {
      return res.status(400).json({ success: false, message: 'จำนวนเงินเติมไม่ถูกต้อง' });
    }

    await pool.query('INSERT IGNORE INTO wallets (user_id, balance) VALUES (?, 0.00)', [uid]);
    await pool.query('UPDATE wallets SET balance = balance + ? WHERE user_id = ?', [topupAmount, uid]);

    const [w] = await pool.query('SELECT id FROM wallets WHERE user_id = ?', [uid]);
    if (w.length > 0) {
      await pool.query(
        `INSERT INTO wallet_transactions (wallet_id, amount, type, description)
         VALUES (?, ?, 'topup', ?)`,
        [w[0].id, topupAmount, `เติมเงินเข้ากระเป๋าสำเร็จ จำนวน ${topupAmount.toFixed(2)} บาท`]
      );
    }

    res.json({ success: true, message: `เติมเงินสำเร็จ ฿${topupAmount.toFixed(2)}` });
  } catch (err) {
    console.error('Topup Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการเติมเงิน' });
  }
};

app.post('/api/wallet/topup', handleWalletTopup);
app.post('/wallet/topup', handleWalletTopup);

// ถอนเงินออกจากกระเป๋า
const handleWalletWithdraw = async (req, res) => {
  const pool = db.getPool();
  let conn;

  try {
    const { userId, amount } = req.body;
    const withdrawAmount = Number(amount);
    const uid = Number(userId);

    if (!uid || isNaN(withdrawAmount) || withdrawAmount <= 0) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุจำนวนเงินที่ถูกต้อง' });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [wallets] = await conn.query('SELECT * FROM wallets WHERE user_id = ? FOR UPDATE', [uid]);
    if (wallets.length === 0 || Number(wallets[0].balance) < withdrawAmount) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'ยอดเงินคงเหลือไม่เพียงพอสำหรับการถอน' });
    }

    const wallet = wallets[0];
    await conn.query('UPDATE wallets SET balance = balance - ? WHERE id = ?', [withdrawAmount, wallet.id]);
    await conn.query(
      `INSERT INTO wallet_transactions (wallet_id, amount, type, description)
       VALUES (?, ?, 'withdraw', ?)`,
      [wallet.id, -withdrawAmount, `ถอนเงินเข้าบัญชีธนาคาร จำนวน ${withdrawAmount.toFixed(2)} บาท`]
    );

    await conn.commit();
    res.json({ success: true, message: 'แจ้งถอนเงินสำเร็จ ยอดเงินจะโอนเข้าบัญชีภายใน 24 ชม.' });
  } catch (error) {
    if (conn) await conn.rollback();
    console.error('Withdraw Error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการถอนเงิน' });
  } finally {
    if (conn) conn.release();
  }
};

app.post('/api/wallet/withdraw', handleWalletWithdraw);
app.post('/wallet/withdraw', handleWalletWithdraw);

// ชี้ตำแหน่งไฟล์หน้าเว็บ Static
app.use(express.static(path.join(__dirname, '../')));
app.use(express.static(path.join(__dirname, './')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../index.html'), (err) => {
    if (err) {
      res.sendFile(path.join(__dirname, 'index.html'), (innerErr) => {
        if (innerErr) {
          res.json({ status: 'API is running', message: 'BestFood Delivery Backend is live!' });
        }
      });
    }
  });
});

// Dynamic Port Binding
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, async () => {
  console.log('----------------------------------------------------');
  console.log(`🚀 Platform พร้อมทำงานแล้วที่ Port ${PORT}`);
  console.log(`🌐 เข้าใช้งานได้ที่: http://localhost:${PORT}`);
  console.log('----------------------------------------------------');
  await initializeDatabaseTables();
});