const express = require("express");

const {
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  toggleProductStatus,
  getFeaturedProducts,
  getRelatedProducts,
  getMyProducts,
  updateStock,
} = require("../controllers/productController");

const authMiddleware   = require("../middlewares/authMiddleware");
const roleMiddleware   = require("../middlewares/roleMiddleware");
const upload           = require("../middlewares/upload");

const router = express.Router();

// ── Multer error handler (file type / size violations) ────────────────────────
const handleMulterError = (err, req, res, next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ success: false, message: "File too large. Max 5 MB per image." });
  }
  if (err && err.code === "LIMIT_FILE_COUNT") {
    return res.status(400).json({ success: false, message: "Too many files. Max 5 images allowed." });
  }
  if (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
  next();
};

// ── Public Routes ─────────────────────────────────────────────────────────────
router.get("/featured",      getFeaturedProducts);
router.get("/related/:id",   getRelatedProducts);
router.get("/",              getProducts);

// ── Seller Protected Routes ───────────────────────────────────────────────────
// NOTE: Static paths MUST come before /:id to avoid Express treating them as an id param
router.get(
  "/seller/my-products",
  authMiddleware,
  roleMiddleware("seller"),
  getMyProducts
);

router.get("/:id",           getProductById);

router.post(
  "/",
  authMiddleware,
  roleMiddleware("seller"),
  upload.array("images", 5),
  handleMulterError,
  createProduct
);

router.put(
  "/:id",
  authMiddleware,
  roleMiddleware("seller"),
  upload.array("images", 5),
  handleMulterError,
  updateProduct
);

router.patch(
  "/:id/status",
  authMiddleware,
  roleMiddleware("seller"),
  toggleProductStatus
);

router.patch(
  "/:id/stock",
  authMiddleware,
  roleMiddleware("seller"),
  updateStock
);

router.delete(
  "/:id",
  authMiddleware,
  roleMiddleware("seller"),
  deleteProduct
);

module.exports = router;
