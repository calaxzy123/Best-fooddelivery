// script.js
class CartManager {
  // รองรับ Dynamic URL: ทำงานได้ทั้ง localhost และบนระบบคลาวด์จริง
  constructor(baseUrl = `${window.location.origin}/api`) {
    this.baseUrl = baseUrl;
  }

  getCurrentUser() {
    try {
      const user = localStorage.getItem("currentUser");
      return user ? JSON.parse(user) : null;
    } catch (e) {
      console.error("Parse currentUser error:", e);
      return null;
    }
  }

  // 1. ฟังก์ชันเพิ่มสินค้าลงตะกร้า (อนุญาตให้สั่งได้หลายร้านพร้อมกัน)
  async addToCart(name, price, image, restaurantId, foodId) {
    const currentUser = this.getCurrentUser();
    const userId = currentUser ? currentUser.id : localStorage.getItem("userId");

    if (!userId) {
      alert("กรุณาเข้าสู่ระบบก่อนเลือกอาหาร");
      window.location.href = "login.html";
      return;
    }

    try {
      const response = await fetch(`${this.baseUrl}/cart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: Number(userId),
          user_id: Number(userId),
          foodId: Number(foodId),
          food_id: Number(foodId),
          restaurant_id: Number(restaurantId),
          restaurantId: Number(restaurantId),
          quantity: 1
        })
      });

      const result = await response.json();
      if (result.success || response.ok) {
        alert(`เพิ่ม "${name}" ลงตะกร้าเรียบร้อยแล้ว 🛒`);
        await this.updateCartBadge();
      } else {
        alert(result.message || "เพิ่มสินค้าไม่สำเร็จ");
      }
    } catch (error) {
      console.error("Cart Error:", error);
      alert("ไม่สามารถเชื่อมต่อ Server ได้");
    }
  }

  // 2. ฟังก์ชันคำนวณและแสดงจำนวนสินค้าบน Badge ตะกร้า
  async updateCartBadge() {
    const badge = document.getElementById("cart-count");
    if (!badge) return;

    const currentUser = this.getCurrentUser();
    const userId = currentUser ? currentUser.id : localStorage.getItem("userId");

    if (!userId) {
      badge.textContent = "0";
      return;
    }

    try {
      const res = await fetch(`${this.baseUrl}/cart/${userId}?_t=${Date.now()}`, {
        cache: "no-store"
      });

      if (!res.ok) {
        badge.textContent = "0";
        return;
      }

      const json = await res.json();
      let items = [];
      if (Array.isArray(json)) {
        items = json;
      } else if (json && Array.isArray(json.data)) {
        items = json.data;
      } else if (json && Array.isArray(json.items)) {
        items = json.items;
      }

      const totalItems = items.reduce((sum, item) => {
        const qty = Number(item.quantity || item.qty || 0);
        return sum + (isNaN(qty) ? 0 : qty);
      }, 0);

      badge.textContent = String(totalItems);
    } catch (e) {
      console.error("Badge Update Error:", e);
      badge.textContent = "0";
    }
  }

  // 3. แสดงชื่อผู้ใช้และบทบาทบน Navbar
  renderAuthNavbar() {
    const currentUser = this.getCurrentUser();
    const authLink = document.getElementById("authNav");
    if (!authLink || !currentUser) return;

    const role = (currentUser.role || "").toLowerCase();

    if (role === "restaurant" || role === "merchant") {
      authLink.textContent = `🏪 ${currentUser.name} (ร้านค้า)`;
      authLink.href = "merchant.html";
    } else if (role === "rider") {
      authLink.textContent = `🛵 ${currentUser.name} (ไรเดอร์)`;
      authLink.href = "rider.html";
    } else {
      authLink.textContent = `👤 ${currentUser.name} (ออกจากระบบ)`;
      authLink.href = "#";
      authLink.onclick = (e) => {
        e.preventDefault();
        if (confirm("ต้องการออกจากระบบหรือไม่?")) {
          localStorage.clear();
          window.location.reload();
        }
      };
    }
  }
}

// สร้าง Instance และผูกเข้า Global Scope
const cartManager = new CartManager();
window.cartManager = cartManager;

// ฟังก์ชัน Global สำหรับปุ่ม onclick ใน HTML
function addToCart(name, price, image, restaurantId, foodId) {
  cartManager.addToCart(name, price, image, restaurantId, foodId);
}

// ฟังก์ชันค้นหาอาหาร
function searchFood() {
  const input = document.getElementById("searchInput");
  if (!input) return;
  const keyword = input.value.trim().toLowerCase();
  if (!keyword) {
    alert("กรุณากรอกชื่อร้านหรือเมนูที่ต้องการค้นหา");
    return;
  }

  const foodCards = document.querySelectorAll(".popular-food-card, .food-card");
  if (foodCards.length > 0) {
    foodCards.forEach(card => {
      const title = card.querySelector("h3") ? card.querySelector("h3").innerText.toLowerCase() : "";
      if (title.includes(keyword)) {
        card.style.display = "block";
      } else {
        card.style.display = "none";
      }
    });
  } else {
    // ถ้าหน้าปัจจุบันไม่มีการ์ดอาหาร ให้ส่งคำค้นหาไปหน้า restaurants.html
    window.location.href = `restaurants.html?search=${encodeURIComponent(keyword)}`;
  }
}

// สั่งทำงานทันทีที่ DOM พร้อม
document.addEventListener("DOMContentLoaded", () => {
  cartManager.updateCartBadge();
  cartManager.renderAuthNavbar();
});

// ดักซ้ำอีกครั้งเมื่อโหลดรูปภาพและเนื้อหาหน้าจอครบ
window.addEventListener("load", () => {
  cartManager.updateCartBadge();
});