const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");

const {
  createRazorpayOrder,
  verifyRazorpayPayment,
  getPaymentDetails,
  handleRazorpayWebhook,
  initiateRefund,
} = require("../controllers/paymentController");

// Webhook — raw body is preserved via server.js express.raw() middleware
// No auth — Razorpay calls this directly with a signature
router.post("/webhook", handleRazorpayWebhook);

// Customer only
router.post("/create-order", authMiddleware, roleMiddleware("customer"), createRazorpayOrder);
router.post("/verify", authMiddleware, roleMiddleware("customer"), verifyRazorpayPayment);
router.get("/:id", authMiddleware, roleMiddleware("customer", "admin"), getPaymentDetails);

// Admin only — initiate a Razorpay refund for an order
router.post("/refund", authMiddleware, roleMiddleware("admin"), initiateRefund);

module.exports = router;
