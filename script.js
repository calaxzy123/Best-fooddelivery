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

  // 1. ฟังก์ชันเพิ่มสินค้าลงตะกร้า รองรับ Parameter ทั้ง 2 รูปแบบอัตโนมัติ
  async addToCart(arg1, arg2, arg3, arg4, arg5) {
    const currentUser = this.getCurrentUser();
    const userId = currentUser ? (currentUser.id || currentUser.userId) : localStorage.getItem("userId");

    if (!userId) {
      alert("กรุณาเข้าสู่ระบบก่อนเลือกอาหาร");
      window.location.href = "login.html";
      return;
    }

    // จัดการตรวจจับพารามิเตอร์แบบยืดหยุ่น:
    // รูปแบบ A: (name, price, image, restaurantId, foodId)
    // รูปแบบ B: (foodId, name, price, image, restaurantId)
    let foodId, name, price, image, restaurantId;

    if (typeof arg1 === "number" || (!isNaN(Number(arg1)) && typeof arg2 === "string")) {
      foodId = Number(arg1);
      name = String(arg2 || "เมนูอาหาร");
      price = Number(arg3 || 0);
      image = arg4 || "Image/logoweb.png";
      restaurantId = Number(arg5 || 1);
    } else {
      name = String(arg1 || "เมนูอาหาร");
      price = Number(arg2 || 0);
      image = arg3 || "Image/logoweb.png";
      restaurantId = Number(arg4 || 1);
      foodId = Number(arg5 || 0);
    }

    if (!foodId || foodId <= 0) {
      console.error("foodId ไม่ถูกต้อง:", { arg1, arg2, arg3, arg4, arg5 });
      alert("เกิดข้อผิดพลาด: รหัสอาหารไม่ถูกต้อง");
      return;
    }

    // จัดการ Path รูปภาพให้ถูกต้อง
    let formattedImage = String(image).trim();
    if (formattedImage.startsWith("images/")) {
      formattedImage = formattedImage.replace(/^images\//, "Image/");
    } else if (formattedImage.startsWith("image/")) {
      formattedImage = formattedImage.replace(/^image\//, "Image/");
    } else if (!formattedImage.startsWith("Image/") && !formattedImage.startsWith("http")) {
      formattedImage = "Image/" + formattedImage;
    }

    // --- ส่วนที่ 1: บันทึกลง LocalStorage ทันที ---
    let localCart = [];
    try {
      localCart = JSON.parse(localStorage.getItem(`cart_${userId}`) || localStorage.getItem("cart") || "[]");
    } catch (err) {
      localCart = [];
    }

    // ล้างรายการขยะ null ออกก่อนคำนวณ
    localCart = localCart.filter(item => item && (item.food_id || item.foodId || item.id) && Number(item.price) > 0);

    const existingIndex = localCart.findIndex(item => Number(item.food_id || item.foodId || item.id) === foodId);
    if (existingIndex > -1) {
      localCart[existingIndex].quantity = (Number(localCart[existingIndex].quantity) || 1) + 1;
    } else {
      localCart.push({
        id: foodId,
        foodId: foodId,
        food_id: foodId,
        name: name,
        price: price,
        image: formattedImage,
        restaurantId: restaurantId,
        restaurant_id: restaurantId,
        quantity: 1
      });
    }

    localStorage.setItem(`cart_${userId}`, JSON.stringify(localCart));
    localStorage.setItem("cart", JSON.stringify(localCart));

    this.updateCartBadge();
    alert(`เพิ่ม "${name}" ลงตะกร้าเรียบร้อยแล้ว 🛒`);

    // --- ส่วนที่ 2: ส่งข้อมูลไปบันทึกบน Server Database ---
    try {
      await fetch(`${this.baseUrl}/cart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: Number(userId),
          food_id: Number(foodId),
          restaurant_id: Number(restaurantId),
          quantity: 1
        })
      });
    } catch (error) {
      console.warn("Server Cart Sync Notice:", error);
    }
  }

  // 2. คำนวณและแสดงจำนวนสินค้าบน Badge ตะกร้า
  async updateCartBadge() {
    const badges = document.querySelectorAll("#cart-count, .cart-count, #cart-badge, .cart-badge");
    if (!badges || badges.length === 0) return;

    const currentUser = this.getCurrentUser();
    const userId = currentUser ? (currentUser.id || currentUser.userId) : localStorage.getItem("userId");

    if (!userId) {
      badges.forEach(b => {
        b.textContent = "0";
      });
      return;
    }

    // ดึงจาก LocalStorage ก่อน
    let localCart = [];
    try {
      localCart = JSON.parse(localStorage.getItem(`cart_${userId}`) || localStorage.getItem("cart") || "[]");
    } catch (e) {
      localCart = [];
    }

    // กรองค่า null ออก
    localCart = localCart.filter(item => item && (item.food_id || item.foodId || item.id) && Number(item.price) > 0);
    let totalCount = localCart.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);

    badges.forEach(b => {
      b.textContent = String(totalCount);
    });

    // ดึงจำนวนล่าสุดจากเซิร์ฟเวอร์
    try {
      const res = await fetch(`${this.baseUrl}/cart/${userId}?_t=${Date.now()}`, { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        let items = Array.isArray(json) ? json : (json.data || json.items || []);
        
        // กรองเฉพาะรายการที่ถูกต้อง
        items = items.filter(it => it && it.name && it.name !== "null" && Number(it.price) > 0);

        const serverTotal = items.reduce((sum, item) => sum + Number(item.quantity || item.qty || 1), 0);
        badges.forEach(b => {
          b.textContent = String(serverTotal);
        });
      }
    } catch (e) {
      // ใช้ออฟไลน์ fallback จาก LocalStorage
    }
  }

  // 3. แสดงชื่อผู้ใช้และบทบาทบน Navbar
  renderAuthNavbar() {
    const currentUser = this.getCurrentUser();
    const authLink = document.getElementById("authNav");
    if (!authLink) return;

    if (!currentUser) {
      authLink.textContent = "เข้าสู่ระบบ";
      authLink.href = "login.html";
      return;
    }

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
          sessionStorage.clear();
          window.location.href = "login.html";
        }
      };
    }
  }
}

// สร้าง Instance กลาง
const cartManager = new CartManager();
window.cartManager = cartManager;

// ฟังก์ชัน Global รองรับการเรียกจากทุกหน้า
function addToCart(arg1, arg2, arg3, arg4, arg5) {
  cartManager.addToCart(arg1, arg2, arg3, arg4, arg5);
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

// เริ่มต้นทำงานเมื่อหน้าเว็บพร้อม
document.addEventListener("DOMContentLoaded", () => {
  cartManager.updateCartBadge();
  cartManager.renderAuthNavbar();
});

window.addEventListener("load", () => {
  cartManager.updateCartBadge();
});