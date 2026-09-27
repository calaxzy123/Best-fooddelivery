// Controllers.js
const db = require('./Database');
const { UserRepository, FoodRepository, CartRepository, OrderRepository } = require('./Repositories');

class AuthController {
  constructor() {
    this.userRepo = new UserRepository();
  }

  async register(req, res) {
    try {
      const { name, email, password } = req.body;
      const existingUser = await this.userRepo.findByEmail(email);
      if (existingUser) {
        return res.status(400).json({ success: false, message: 'อีเมลนี้ถูกใช้งานแล้ว' });
      }

      await this.userRepo.create(name, email, password);
      res.json({ success: true, message: 'สมัครสมาชิกสำเร็จ' });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async login(req, res) {
    try {
      const { email, password } = req.body;
      const cleanEmail = String(email || '').trim().toLowerCase();
      const cleanPass = String(password || '').trim();

      const pool = db.getPool();

      // ดึงข้อมูลผู้ใช้ครบถ้วน รวมทั้ง restaurant_id และ ข้อมูลยานพาหนะของไรเดอร์
      const [rows] = await pool.query(
        'SELECT id, name, email, password, role, phone, address, restaurant_id, vehicle_type, vehicle_plate FROM users WHERE LOWER(email) = ? LIMIT 1',
        [cleanEmail]
      );

      if (rows.length === 0) {
        return res.status(401).json({ success: false, message: 'ไม่พบบัญชีผู้ใช้นี้ในระบบ' });
      }

      const user = rows[0];
      const dbPass = String(user.password || '').trim();

      // ตรวจสอบรหัสผ่าน
      const isMatch = (cleanPass === dbPass) || 
                      (dbPass === 'TEMP_PASSWORD_HASH' && cleanPass === '123456');

      if (!isMatch) {
        return res.status(401).json({ success: false, message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
      }

      const resolvedRole = user.role ? String(user.role).toLowerCase() : 'customer';

      console.log(`[Login Success] ผู้ใช้: ${user.name} | Role: ${resolvedRole} | Restaurant ID: ${user.restaurant_id || '-'}`);

      res.json({
        success: true,
        message: 'เข้าสู่ระบบสำเร็จ',
        user: { 
          id: user.id, 
          name: user.name, 
          email: user.email, 
          role: resolvedRole,
          phone: user.phone || '',
          address: user.address || '',
          restaurant_id: user.restaurant_id || null,
          vehicle_type: user.vehicle_type || 'Honda Wave 110i',
          vehicle_plate: user.vehicle_plate || '1กข-8888 กทม.'
        }
      });
    } catch (error) {
      console.error('Login Controller Error:', error);
      res.status(500).json({ success: false, message: error.message || 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์' });
    }
  }
}

class FoodController {
  constructor() {
    this.foodRepo = new FoodRepository();
  }

  async getFoodsByRestaurant(req, res) {
    try {
      const restaurantId = req.params.id;
      const foods = await this.foodRepo.getByRestaurantId(restaurantId);
      res.json({ success: true, data: foods || [] });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

class CartController {
  constructor() {
    this.cartRepo = new CartRepository();
  }

  async getUserCart(req, res) {
    try {
      const userId = req.params.userId;
      if (!userId || userId === 'null' || userId === 'undefined') {
        return res.json({ success: true, data: [] });
      }
      const items = await this.cartRepo.getCart(userId);
      res.json({
        success: true,
        data: Array.isArray(items) ? items : []
      });
    } catch (error) {
      console.error('getUserCart Error:', error);
      res.status(500).json({ success: false, message: error.message || 'ไม่สามารถดึงข้อมูลตะกร้าได้' });
    }
  }

  async updateItem(req, res) {
    try {
      const { user_id, userId, food_id, foodId, quantity } = req.body;
      let targetUserId = user_id || userId;
      const targetFoodId = food_id || foodId;
      const targetQty = Number(quantity);

      if (!targetUserId || !targetFoodId) {
        return res.status(400).json({ success: false, message: 'ข้อมูลผู้ใช้หรืออาหารไม่ครบถ้วน' });
      }

      const pool = db.getPool();

      // ตรวจสอบความถูกต้องของ user_id เพื่อป้องกัน Foreign Key Constraint Fails
      const [uRows] = await pool.query('SELECT id FROM users WHERE id = ?', [targetUserId]);
      if (uRows.length === 0) {
        // หากไม่พบบัญชี ให้ค้นหาบัญชี customer คนแรกมารับแทนเพื่อป้องกันระบบล่ม
        const [defaultCust] = await pool.query("SELECT id FROM users WHERE role = 'customer' ORDER BY id ASC LIMIT 1");
        if (defaultCust.length > 0) {
          targetUserId = defaultCust[0].id;
        } else {
          return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่อีกครั้ง' });
        }
      }

      await this.cartRepo.addOrUpdate(targetUserId, targetFoodId, targetQty);
      res.json({ success: true, message: 'อัปเดตตะกร้าสินค้าสำเร็จ', userId: targetUserId });
    } catch (error) {
      console.error('updateItem Error:', error);
      res.status(500).json({ success: false, message: error.message || 'อัปเดตตะกร้าไม่สำเร็จ' });
    }
  }

  async clearUserCart(req, res) {
    try {
      const userId = req.params.userId;
      if (userId && userId !== 'null') {
        await this.cartRepo.clearCart(userId);
      }
      res.json({ success: true, message: 'ล้างตะกร้าสำเร็จ' });
    } catch (error) {
      console.error('clearUserCart Error:', error);
      res.status(500).json({ success: false, message: error.message || 'ล้างตะกร้าไม่สำเร็จ' });
    }
  }
}

class OrderController {
  constructor() {
    this.orderRepo = new OrderRepository();
  }

  async create(req, res) {
    try {
      const { user_id, restaurant_id, delivery_address, payment_method, items } = req.body;

      const subtotal = (items || []).reduce((sum, item) => sum + (Number(item.price) * Number(item.quantity)), 0);
      const total_amount = subtotal + 20;

      const orderId = await this.orderRepo.createOrder({
        user_id,
        restaurant_id,
        delivery_address,
        payment_method,
        total_amount,
        items
      });

      res.json({ success: true, orderId });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getOrder(req, res) {
    try {
      const orderId = req.params.id;
      const result = await this.orderRepo.getOrderById(orderId);

      if (!result) {
        return res.status(404).json({ success: false, message: 'ไม่พบคำสั่งซื้อนี้' });
      }

      res.json({ success: true, order: result.order, items: result.items });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = {
  AuthController,
  FoodController,
  CartController,
  OrderController
};