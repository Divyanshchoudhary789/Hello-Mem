const express = require("express");
const router = express.Router();
const { otpRateLimiter } = require("../middlewares/otpRateLimiter");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");

const {
  sendCustomerOtp,
  registerCustomer,
  customerLogin,
  customerLogout,
  getCustomerProfile,
  updateCustomerProfile,
  updateCustomerAddress,
  deleteCustomer,
} = require("../controllers/customerController");

// ── Public Routes ──────────────────────────────────────────────────────────
router.post("/send-otp", otpRateLimiter(60 * 1000, 3), sendCustomerOtp);
router.post("/register", registerCustomer);
router.post("/login", customerLogin);

// ── Protected Routes (customer only) ──────────────────────────────────────
router.use(authMiddleware);
router.use(roleMiddleware("customer"));

router.post("/logout", customerLogout);

// Profile
router.get("/profile", getCustomerProfile);
router.put("/profile", updateCustomerProfile);
router.put("/profile/address", updateCustomerAddress);
router.delete("/profile", deleteCustomer);

module.exports = router;
