const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");

const {
  createOrder,
  getMyOrders,
  getOrderById,
  cancelOrder,
  getSellerOrders,
  getSellerOrderById,
  updateOrderStatus,
  updateTracking,
} = require("../controllers/ordersController");

// ── Customer routes ────────────────────────────────────────────────────────
// IMPORTANT: static paths must come before dynamic /:id
router.post("/", authMiddleware, roleMiddleware("customer"), createOrder);
router.get("/my-orders", authMiddleware, roleMiddleware("customer"), getMyOrders);

// ── Seller routes (static — must be before /:id) ───────────────────────────
router.get("/seller", authMiddleware, roleMiddleware("seller"), getSellerOrders);
router.get("/seller/:id", authMiddleware, roleMiddleware("seller"), getSellerOrderById);
router.patch("/seller/:id/status", authMiddleware, roleMiddleware("seller"), updateOrderStatus);
router.patch("/seller/:id/tracking", authMiddleware, roleMiddleware("seller"), updateTracking);

// ── Customer dynamic routes (after all static paths) ───────────────────────
router.get("/:id", authMiddleware, roleMiddleware("customer"), getOrderById);
router.patch("/:id/cancel", authMiddleware, roleMiddleware("customer"), cancelOrder);

module.exports = router;
