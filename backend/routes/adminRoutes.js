const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const upload = require("../middlewares/upload");

const {
  adminLogin,
  adminLogout,
  getAdminProfile,
  getAllCustomers,
  updateCustomerAdmin,
  toggleCustomerStatus,
  deleteCustomer,
  getAllSellers,
  getSellerDetailsAdmin,
  updateSellerAdmin,
  updateSellerStatus,
  deleteSeller,
  getAllProductsAdmin,
  updateProductStatusAdmin,
  updateProductAdmin,
  deleteProductAdmin,
  getAllOrdersAdmin,
  getOrderDetailAdmin,
  updateOrderStatusAdmin,
  getAdminDashboardStats,
  getRevenueAnalytics,
  getOrderAnalytics,
  getCustomerAnalytics,
  getProductAnalytics,
  getSellerAnalytics,
} = require("../controllers/adminController");

// ── Public Routes ──────────────────────────────────────────────────────────────
router.post("/login", adminLogin);

// ── Protected Admin Routes ─────────────────────────────────────────────────────
router.use(authMiddleware);
router.use(roleMiddleware("admin"));

// Auth
router.post("/logout", adminLogout);
router.get("/profile", getAdminProfile);

// Dashboard
router.get("/stats", getAdminDashboardStats);

// Analytics (dedicated chart data endpoints)
// ?period=7d|30d|6m|12m
router.get("/analytics/revenue", getRevenueAnalytics);
// ?period=7d|30d|6m|12m
router.get("/analytics/orders", getOrderAnalytics);
// ?period=6m|12m
router.get("/analytics/customers", getCustomerAnalytics);
// ?limit=10&sortBy=revenue|quantity|orders
router.get("/analytics/products", getProductAnalytics);
// ?limit=10
router.get("/analytics/sellers", getSellerAnalytics);

// Customers
router.get("/customers", getAllCustomers);
router.put("/customers/:id", updateCustomerAdmin);
router.patch("/customers/:id/status", toggleCustomerStatus);
router.delete("/customers/:id", deleteCustomer);

// Sellers
router.get("/sellers", getAllSellers);
router.get("/sellers/:id", getSellerDetailsAdmin);
router.put("/sellers/:id", updateSellerAdmin);
router.patch("/sellers/:id/status", updateSellerStatus);
router.delete("/sellers/:id", deleteSeller);

// Products
router.get("/products", getAllProductsAdmin);
router.patch("/products/:id/status", updateProductStatusAdmin);
router.put("/products/:id", upload.array("images", 10), updateProductAdmin);
router.delete("/products/:id", deleteProductAdmin);

// Orders
router.get("/orders", getAllOrdersAdmin);
router.get("/orders/:id", getOrderDetailAdmin);
router.patch("/orders/:id/status", updateOrderStatusAdmin);

module.exports = router;
