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
  // COD
  confirmCODCollection,
  initiateCODRefund,
  completeCODRefund,
  getCODPendingRefunds,
} = require("../controllers/paymentController");

// ── Razorpay Webhook ─────────────────────────────────────────────────────────
// Raw body is preserved via server.js express.raw() middleware.
// No auth — Razorpay calls this directly with a signature.
router.post("/webhook", handleRazorpayWebhook);

// ── Razorpay (Online Payments) ───────────────────────────────────────────────
router.post("/create-order", authMiddleware, roleMiddleware("customer"), createRazorpayOrder);
router.post("/verify", authMiddleware, roleMiddleware("customer"), verifyRazorpayPayment);

// ── COD (Cash on Delivery) ───────────────────────────────────────────────────
// Confirm cash collected at delivery — Admin or Seller (after order is DELIVERED)
router.patch(
  "/cod/collect",
  authMiddleware,
  roleMiddleware("admin", "seller"),
  confirmCODCollection
);

// Initiate COD refund — Admin only (when COD order is cancelled/returned)
router.post(
  "/cod/refund",
  authMiddleware,
  roleMiddleware("admin"),
  initiateCODRefund
);

// Complete / mark COD refund as done — Admin only
router.patch(
  "/cod/refund/:paymentId/complete",
  authMiddleware,
  roleMiddleware("admin"),
  completeCODRefund
);

// Get list of all pending COD refunds — Admin only
router.get(
  "/cod/pending-refunds",
  authMiddleware,
  roleMiddleware("admin"),
  getCODPendingRefunds
);

// ── Payment Details ──────────────────────────────────────────────────────────
// NOTE: dynamic :id routes must come AFTER all static paths above
router.get("/:id", authMiddleware, roleMiddleware("customer", "admin"), getPaymentDetails);

// ── Admin: Razorpay Refund ───────────────────────────────────────────────────
router.post("/refund", authMiddleware, roleMiddleware("admin"), initiateRefund);

module.exports = router;
