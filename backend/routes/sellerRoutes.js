const express = require("express");
const router = express.Router();
const { otpRateLimiter } = require("../middlewares/otpRateLimiter");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");

const sellerController = require("../controllers/sellerController");
const productController = require("../controllers/productController");
const sellerUserController = require("../controllers/sellerUserController");
const upload = require("../middlewares/upload");

// ── Public Routes ──────────────────────────────────────────────────────────
// Step 1 (register & login): request OTP — max 3 per phone per minute
router.post("/send-otp", otpRateLimiter(60 * 1000, 3), sellerController.sendSellerOtp);
// Step 2 register: verify OTP + create account
router.post("/register", sellerController.registerSeller);
// Step 2 login: verify OTP + issue session
router.post("/login", sellerController.loginSeller);

// ── Protected Routes (sellers only) ───────────────────────────────────────
router.use(authMiddleware);
router.use(roleMiddleware("seller"));

router.post("/logout", sellerController.logoutSeller);
router.get("/profile", sellerController.getProfile);
router.put("/profile", sellerController.updateProfile);
router.get("/dashboard", sellerController.dashboard);
router.put("/deactivate", sellerController.deactivateSeller);
// Internal utility: look up user by email (auth required, seller only)
router.post("/get-user-details", sellerController.getUserDetailsByEmail);

// Products
router.post("/products", upload.array("images", 10), productController.createProduct);
router.get("/products", productController.getMyProducts);
router.get("/products/:id", productController.getProductById);
router.put("/products/:id", upload.array("images", 10), productController.updateProduct);
router.delete("/products/:id", productController.deleteProduct);
router.patch("/products/:id/status", productController.toggleProductStatus);
router.patch("/products/:id/stock", productController.updateStock);

// Customers (seller's view)
router.get("/customers", sellerUserController.getCustomers);
router.get("/customers/dashboard", sellerUserController.getCustomerDashboard);
router.get("/customers/:customerId", sellerUserController.getCustomerDetails);

module.exports = router;
