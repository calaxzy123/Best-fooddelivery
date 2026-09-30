// script.js
const GLOBAL_MENU_CATALOG = {
  1: { name: "ข้าวกะเพราหมูสับ", price: 50, image: "Image/kapao-moosub.jpg", restaurant_id: 1 },
  2: { name: "ข้าวกะเพราไก่", price: 50, image: "Image/kapao-kai.jpg", restaurant_id: 1 },
  3: { name: "ข้าวกะเพราเนื้อ", price: 70, image: "Image/kapao-nae.jpg", restaurant_id: 1 },
  4: { name: "ไข่ดาว", price: 10, image: "Image/dao.jpg", restaurant_id: 1 },
  5: { name: "Pizza Margherita", price: 199, image: "Image/pizzamargherita.jpg", restaurant_id: 2 },
  6: { name: "Pizza Hawaiian", price: 229, image: "Image/pizzahawaiian.jpg", restaurant_id: 2 },
  7: { name: "Pepperoni Pizza", price: 249, image: "Image/pepperoni pizza.jpg", restaurant_id: 2 },
  8: { name: "Classic Burger", price: 129, image: "Image/classic burger.jpg", restaurant_id: 3 },
  9: { name: "Cheese Burger", price: 149, image: "Image/burgercheese.jpg", restaurant_id: 3 },
  10: { name: "Chicken Burger", price: 139, image: "Image/chicken burger.jpg", restaurant_id: 3 },
  11: { name: "ก๋วยเตี๋ยวต้มยำ", price: 50, image: "Image/noodle-tomyum.jpg", restaurant_id: 4 },
  12: { name: "ก๋วยเตี๋ยวหมู", price: 45, image: "Image/noodle-pork.jpg", restaurant_id: 4 },
  13: { name: "ก๋วยเตี๋ยวเนื้อ", price: 60, image: "Image/noodle-beef.jpg", restaurant_id: 4 }
};

class CartManager {
  constructor(baseUrl = `${window.location.origin}/api`) {
    this.baseUrl = baseUrl;
  }

  getCurrentUser() {
    try {
      const user = localStorage.getItem("currentUser") || localStorage.getItem("user");
      return user ? JSON.parse(user) : null;
    } catch (e) {
      console.error("Parse currentUser error:", e);
      return null;
    }
  }

  resolveStoreId(foodId, defaultRid) {
    const fid = Number(foodId);
    if (GLOBAL_MENU_CATALOG[fid]) {
      return GLOBAL_MENU_CATALOG[fid].restaurant_id;
    }
    if (fid >= 1 && fid <= 4) return 1;
    if (fid >= 5 && fid <= 7) return 2;
    if (fid >= 8 && fid <= 10) return 3;
    if (fid >= 11 && fid <= 13) return 4;
    return Number(defaultRid || 1);
  }

  async addToCart(arg1, arg2, arg3, arg4, arg5) {
    const currentUser = this.getCurrentUser();
    const userId = currentUser ? (currentUser.id || currentUser.userId) : localStorage.getItem("userId");

    if (!userId) {
      alert("กรุณาเข้าสู่ระบบก่อนเลือกอาหาร");
      window.location.href = "login.html";
      return;
    }

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

    // ซิงค์ข้อมูลจากแค็ตตาล็อกกลาง
    const catalogItem = GLOBAL_MENU_CATALOG[foodId];
    if (catalogItem) {
      name = catalogItem.name;
      price = catalogItem.price;
      image = catalogItem.image;
      restaurantId = catalogItem.restaurant_id;
    } else {
      restaurantId = this.resolveStoreId(foodId, restaurantId);
    }

    let formattedImage = String(image).trim();
    if (formattedImage.startsWith("images/")) {
      formattedImage = formattedImage.replace(/^images\//, "Image/");
    } else if (formattedImage.startsWith("image/")) {
      formattedImage = formattedImage.replace(/^image\//, "Image/");
    } else if (!formattedImage.startsWith("Image/") && !formattedImage.startsWith("http")) {
      formattedImage = "Image/" + formattedImage;
    }

    // 1. บันทึกลง LocalStorage
    let localCart = [];
    try {
      localCart = JSON.parse(localStorage.getItem(`cart_${userId}`) || localStorage.getItem("cart") || "[]");
    } catch (err) {
      localCart = [];
    }

    localCart = localCart.filter(item => item && (item.food_id || item.foodId || item.id) && Number(item.price) > 0);

    const existingIndex = localCart.findIndex(item => Number(item.food_id || item.foodId || item.id) === foodId);
    if (existingIndex > -1) {
      localCart[existingIndex].quantity = (Number(localCart[existingIndex].quantity) || 1) + 1;
      localCart[existingIndex].restaurant_id = restaurantId;
      localCart[existingIndex].restaurantId = restaurantId;
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

    // 2. ส่งข้อมูลบันทึกไปยังเซิร์ฟเวอร์
    try {
      await fetch(`${this.baseUrl}/cart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: Number(userId),
          user_id: Number(userId),
          foodId: Number(foodId),
          food_id: Number(foodId),
          restaurantId: Number(restaurantId),
          restaurant_id: Number(restaurantId),
          quantity: 1
        })
      });
      await this.updateCartBadge();
    } catch (error) {
      console.warn("Server Cart Sync Notice:", error);
    }
  }

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

    // อัปเดตจาก LocalStorage เบื้องต้น
    let localCart = [];
    try {
      localCart = JSON.parse(localStorage.getItem(`cart_${userId}`) || localStorage.getItem("cart") || "[]");
    } catch (e) {
      localCart = [];
    }

    localCart = localCart.filter(item => item && (item.food_id || item.foodId || item.id) && Number(item.price) > 0);
    let totalCount = localCart.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);

    badges.forEach(b => {
      b.textContent = String(totalCount);
    });

    // ดึงข้อมูลจริงจากฐานข้อมูล
    try {
      const res = await fetch(`${this.baseUrl}/cart/${userId}?_t=${Date.now()}`, { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        let items = Array.isArray(json) ? json : (json.data || json.items || []);
        items = items.filter(it => it && (it.food_id || it.foodId || it.id) && Number(it.price) > 0);
        const serverTotal = items.reduce((sum, item) => sum + Number(item.quantity || item.qty || 1), 0);
        badges.forEach(b => {
          b.textContent = String(serverTotal);
        });
      }
    } catch (e) {}
  }

  renderAuthNavbar() {
    const currentUser = this.getCurrentUser();
    const authLink = document.getElementById("authNav");
    if (!authLink) return;

    if (!currentUser || !currentUser.id) {
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

const cartManager = new CartManager();
window.cartManager = cartManager;

function addToCart(arg1, arg2, arg3, arg4, arg5) {
  cartManager.addToCart(arg1, arg2, arg3, arg4, arg5);
}

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

document.addEventListener("DOMContentLoaded", () => {
  cartManager.updateCartBadge();
  cartManager.renderAuthNavbar();
});

window.addEventListener("load", () => {
  cartManager.updateCartBadge();
});