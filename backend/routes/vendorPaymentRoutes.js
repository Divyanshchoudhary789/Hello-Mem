const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const {
  createVendorPayment,
  getVendorPayments,
  getVendorPaymentById,
  updateVendorPayment,
  updateVendorPaymentStatus,
  deleteVendorPayment,
  getMyPaymentSummary,
  getSellerPaymentSummary,
} = require("../controllers/vendorPaymentController");

router.use(authMiddleware);

// Admin creates vendor payment manually (correction / override)
router.post("/", roleMiddleware("admin"), createVendorPayment);

// Seller: own payment dashboard summary (must be before /:id)
router.get("/my-summary", roleMiddleware("seller"), getMyPaymentSummary);

// Admin or seller lists payments (seller sees only their own)
router.get("/", roleMiddleware("admin", "seller"), getVendorPayments);

// Admin: payment summary for a specific seller (must be before /:id)
router.get("/summary/:sellerId", roleMiddleware("admin"), getSellerPaymentSummary);

// Admin or seller fetches single payment
router.get("/:id", roleMiddleware("admin", "seller"), getVendorPaymentById);

// Admin updates payment details (amounts, mode, etc.)
router.put("/:id", roleMiddleware("admin"), updateVendorPayment);

// Admin marks payment as Processing / Paid / Failed
router.patch("/:id/status", roleMiddleware("admin"), updateVendorPaymentStatus);

// Admin deletes a pending/cancelled payment record
router.delete("/:id", roleMiddleware("admin"), deleteVendorPayment);

module.exports = router;
