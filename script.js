// script.js
class CartManager {
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

  // 1. ฟังก์ชันเพิ่มสินค้าลงตะกร้า (เก็บทั้งใน LocalStorage ทันที และส่งไป Server)
  async addToCart(name, price, image, restaurantId, foodId) {
    const currentUser = this.getCurrentUser();
    const userId = currentUser ? (currentUser.id || currentUser.userId) : localStorage.getItem("userId");

    if (!userId) {
      alert("กรุณาเข้าสู่ระบบก่อนเลือกอาหาร");
      window.location.href = "Login.html";
      return;
    }

    // จัดการ Path รูปภาพให้ถูกต้อง (ขึ้นต้นด้วย Image/ เสมอ)
    let formattedImage = image || "Image/logoweb.png";
    if (formattedImage.startsWith("images/")) {
      formattedImage = formattedImage.replace("images/", "Image/");
    }

    // --- ส่วนที่ 1: บันทึกลง LocalStorage ทันที เพื่อให้ตะกร้าและตัวเลขหน้าเว็บทำงานทันที ---
    let localCart = [];
    try {
      localCart = JSON.parse(localStorage.getItem(`cart_${userId}`) || localStorage.getItem("cart") || "[]");
    } catch (err) {
      localCart = [];
    }

    const existingIndex = localCart.findIndex(item => Number(item.foodId || item.id) === Number(foodId));
    if (existingIndex > -1) {
      localCart[existingIndex].quantity = (Number(localCart[existingIndex].quantity) || 1) + 1;
    } else {
      localCart.push({
        id: Number(foodId),
        foodId: Number(foodId),
        food_id: Number(foodId),
        name: name,
        price: Number(price),
        image: formattedImage,
        restaurantId: Number(restaurantId),
        restaurant_id: Number(restaurantId),
        quantity: 1
      });
    }

    localStorage.setItem(`cart_${userId}`, JSON.stringify(localCart));
    localStorage.setItem("cart", JSON.stringify(localCart));

    // อัปเดตตัวเลขหน้าแรกทันที ไม่ต้องรอ API
    this.updateCartBadge();
    alert(`เพิ่ม "${name}" ลงตะกร้าเรียบร้อยแล้ว 🛒`);

    // --- ส่วนที่ 2: ส่งข้อมูลไปบันทึกบน Server / Database (Background Sync) ---
    try {
      await fetch(`${this.baseUrl}/cart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: Number(userId),
          user_id: Number(userId),
          foodId: Number(foodId),
          food_id: Number(foodId),
          name: name,
          price: Number(price),
          image: formattedImage,
          restaurantId: Number(restaurantId),
          restaurant_id: Number(restaurantId),
          quantity: 1
        })
      });
    } catch (error) {
      console.warn("Server Cart Sync Warning (Offline/Fallback to LocalStorage):", error);
    }
  }

  // 2. ฟังก์ชันคำนวณและแสดงจำนวนสินค้าบน Badge ตะกร้า
  async updateCartBadge() {
    // ดักจับ Element ตัวเลขตะกร้าทุกรูปแบบที่มักใช้ใน HTML
    const badges = document.querySelectorAll("#cart-count, .cart-count, #cart-badge, .cart-badge");
    if (!badges || badges.length === 0) return;

    const currentUser = this.getCurrentUser();
    const userId = currentUser ? (currentUser.id || currentUser.userId) : localStorage.getItem("userId");

    if (!userId) {
      badges.forEach(b => b.textContent = "0");
      return;
    }

    // ดึงจำนวนจาก LocalStorage ก่อนเป็นอันดับแรก เพื่อให้แสดงผลทันทีแบบไม่หน่วง
    let localCart = [];
    try {
      localCart = JSON.parse(localStorage.getItem(`cart_${userId}`) || localStorage.getItem("cart") || "[]");
    } catch (e) {
      localCart = [];
    }

    let totalCount = localCart.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
    badges.forEach(b => {
      b.textContent = String(totalCount);
      b.style.display = totalCount > 0 ? "inline-block" : "none";
    });

    // พยายาม Sync จำนวนล่าสุดจาก Server ต่อ (ถ้ามี API รองรับ)
    try {
      const res = await fetch(`${this.baseUrl}/cart/${userId}?_t=${Date.now()}`, { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        let items = Array.isArray(json) ? json : (json.data || json.items || []);
        if (items.length > 0) {
          const serverTotal = items.reduce((sum, item) => sum + Number(item.quantity || item.qty || 1), 0);
          badges.forEach(b => {
            b.textContent = String(serverTotal);
            b.style.display = serverTotal > 0 ? "inline-block" : "none";
          });
        }
      }
    } catch (e) {
      // หากติดต่อ Server ไม่ได้ ก็ยังคงใช้ตัวเลขจาก LocalStorage ที่แสดงไปแล้ว
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
      authLink.href = "restaurant.html";
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

// สร้าง Instance และผูกเข้า Window
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
      card.style.display = title.includes(keyword) ? "block" : "none";
    });
  } else {
    window.location.href = `restaurants.html?search=${encodeURIComponent(keyword)}`;
  }
}

// สั่งทำงานทันทีเมื่อหน้าเว็บโหลด
document.addEventListener("DOMContentLoaded", () => {
  cartManager.updateCartBadge();
  cartManager.renderAuthNavbar();
});

window.addEventListener("load", () => {
  cartManager.updateCartBadge();
});