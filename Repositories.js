// Repositories.js
const db = require('./Database');

// 1. คลังข้อมูลผู้ใช้งาน (User)
class UserRepository {
  async findByEmail(email) {
    const [rows] = await db.getPool().query('SELECT * FROM users WHERE email = ?', [email]);
    return rows[0] || null;
  }

  async create(name, email, password) {
    const [result] = await db.getPool().query(
      'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
      [name, email, password]
    );
    return result.insertId;
  }
}

// 2. คลังข้อมูลอาหาร (Food)
class FoodRepository {
  async getByRestaurantId(restaurantId) {
    const [rows] = await db.getPool().query('SELECT * FROM foods WHERE restaurant_id = ?', [restaurantId]);
    return rows;
  }
}

// 3. คลังข้อมูลตะกร้าสินค้า (Cart)
class CartRepository {
  async getCart(userId) {
    const query = `
      SELECT c.id AS cart_id, c.quantity, f.id AS food_id, f.name, f.price, f.image, f.restaurant_id
      FROM cart c
      JOIN foods f ON c.food_id = f.id
      WHERE c.user_id = ?
    `;
    const [rows] = await db.getPool().query(query, [userId]);
    return rows;
  }

  async addOrUpdate(userId, foodId, quantity) {
    const pool = db.getPool();
    const qtyChange = Number(quantity);

    const [existing] = await pool.query(
      'SELECT id, quantity FROM cart WHERE user_id = ? AND food_id = ?',
      [userId, foodId]
    );

    if (existing.length > 0) {
      const currentQty = Number(existing[0].quantity);
      const newQty = currentQty + qtyChange;

      if (newQty <= 0) {
        await pool.query('DELETE FROM cart WHERE id = ?', [existing[0].id]);
      } else {
        await pool.query('UPDATE cart SET quantity = ? WHERE id = ?', [newQty, existing[0].id]);
      }
    } else {
      if (qtyChange > 0) {
        await pool.query(
          'INSERT INTO cart (user_id, food_id, quantity) VALUES (?, ?, ?)',
          [userId, foodId, qtyChange]
        );
      }
    }
  }

  async clearCart(userId) {
    await db.getPool().query('DELETE FROM cart WHERE user_id = ?', [userId]);
  }
}

// 4. คลังข้อมูลคำสั่งซื้อ (Order)
class OrderRepository {
  async createOrder({ user_id, restaurant_id, delivery_address, payment_method, total_amount, items }) {
    const conn = await db.getPool().getConnection();
    try {
      await conn.beginTransaction();

      // 1. คำนวณยอดเงินรวมอย่างรัดกุม ป้องกันค่า null, undefined และ NaN
      let calculatedTotal = 0;
      const parsedAmount = Number(total_amount);

      if (!isNaN(parsedAmount) && parsedAmount > 0) {
        calculatedTotal = parsedAmount;
      } else if (Array.isArray(items) && items.length > 0) {
        const subtotal = items.reduce((sum, it) => {
          const price = Number(it.price || it.food_price || 0);
          const qty = Number(it.quantity || it.qty || 1);
          return sum + (price * qty);
        }, 0);
        calculatedTotal = subtotal + 20; // ค่าจัดส่ง 20 บาท
      } else {
        calculatedTotal = 20;
      }

      // ตรวจสอบขั้นสุดท้าย: กำหนดเป็นตัวเลขทศนิยมเสมอ ห้ามเป็น null เด็ดขาด
      const finalTotal = (isNaN(calculatedTotal) || calculatedTotal === null) ? 0.00 : Number(calculatedTotal);

      // 2. บันทึกหัวบิล
      const [orderRes] = await conn.query(
        `INSERT INTO orders (user_id, restaurant_id, delivery_address, payment_method, total_amount, status)
         VALUES (?, ?, ?, ?, COALESCE(?, 0.00), 'pending')`,
        [user_id, restaurant_id, delivery_address, payment_method, finalTotal]
      );
      const orderId = orderRes.insertId;

      // 3. บันทึกรายการอาหาร
      if (Array.isArray(items) && items.length > 0) {
        for (const item of items) {
          const foodId = item.food_id || item.id;
          const foodName = item.food_name || item.name || 'รายการอาหาร';
          const price = Number(item.price || item.food_price || 0);
          const qty = Number(item.quantity || item.qty || 1);

          await conn.query(
            `INSERT INTO order_items (order_id, food_id, food_name, price, quantity)
             VALUES (?, ?, ?, ?, ?)`,
            [orderId, foodId, foodName, price, qty]
          );
        }
      }

      await conn.commit();
      return orderId;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  // อัปเดตสถานะคำสั่งซื้อในฐานข้อมูล
  async updateStatus(orderId, status) {
    await db.getPool().query(
      'UPDATE orders SET status = ? WHERE id = ?',
      [status, orderId]
    );
  }

  async getOrderById(orderId) {
    const [orderRows] = await db.getPool().query(`
      SELECT o.*, u.name AS customer_name, r.name AS restaurant_name
      FROM orders o
      JOIN users u ON o.user_id = u.id
      JOIN restaurants r ON o.restaurant_id = r.id
      WHERE o.id = ?
    `, [orderId]);

    if (orderRows.length === 0) return null;

    const [items] = await db.getPool().query(
      'SELECT food_id, food_name, price, quantity FROM order_items WHERE order_id = ?',
      [orderId]
    );

    return { order: orderRows[0], items };
  }

  // ดึงประวัติคำสั่งซื้อทั้งหมดของลูกค้ารายนั้นๆ
  async getOrdersByUserId(userId) {
    const [rows] = await db.getPool().query(`
      SELECT o.id, o.total_amount, o.status, o.created_at, r.name AS restaurant_name
      FROM orders o
      JOIN restaurants r ON o.restaurant_id = r.id
      WHERE o.user_id = ?
      ORDER BY o.created_at DESC
    `, [userId]);
    return rows;
  }

  // ดึงรายการออเดอร์ของร้านค้าพร้อมรายการอาหาร (สำหรับ Merchant Dashboard)
  async getOrdersByRestaurantId(restaurantId) {
    const pool = db.getPool();

    // ดึงเฉพาะคอลัมน์พื้นฐานที่มีแน่นอนในฐานข้อมูล
    const [orders] = await pool.query(`
      SELECT o.id, o.user_id, o.restaurant_id, o.delivery_address, 
             o.payment_method, o.total_amount, o.status, o.created_at,
             u.name AS customer_name
      FROM orders o
      JOIN users u ON o.user_id = u.id
      WHERE o.restaurant_id = ?
      ORDER BY o.created_at DESC
    `, [Number(restaurantId)]);

    // ดึงรายการอาหารของแต่ละออเดอร์มาประกบ
    for (const order of orders) {
      const [items] = await pool.query(
        'SELECT food_id, food_name, price, quantity FROM order_items WHERE order_id = ?',
        [order.id]
      );
      order.items = items;
    }

    return orders;
  }

  // ยกเลิกคำสั่งซื้อ (อนุญาตเฉพาะสถานะ pending เท่านั้น)
  async cancelOrder(orderId, userId) {
    const pool = db.getPool();

    // 1. ตรวจสอบสถานะและผู้สั่งซื้อก่อน
    const [rows] = await pool.query(
      'SELECT status, user_id FROM orders WHERE id = ?',
      [orderId]
    );

    if (rows.length === 0) {
      throw new Error('ไม่พบคำสั่งซื้อนี้');
    }

    const order = rows[0];

    if (order.user_id !== Number(userId)) {
      throw new Error('ไม่มีสิทธิ์ยกเลิกคำสั่งซื้อนี้');
    }

    if (order.status !== 'pending') {
      throw new Error('ไม่สามารถยกเลิกได้ เนื่องจากร้านค้าเริ่มปรุงอาหารหรือกำลังจัดส่งแล้ว');
    }

    // 2. อัปเดตสถานะเป็น cancelled
    await pool.query(
      'UPDATE orders SET status = "cancelled" WHERE id = ?',
      [orderId]
    );

    return true;
  }
}

module.exports = {
  UserRepository,
  FoodRepository,
  CartRepository,
  OrderRepository
};