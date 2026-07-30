const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");

const {
  addReview,
  getProductReviews,
  updateReview,
  deleteReview,
  getSellerReviews,
  getReviewById,
} = require("../controllers/reviewController");

// ── Static routes FIRST (before /:productId) ─────────────────────────────────
// Seller
router.get("/seller", authMiddleware, roleMiddleware("seller"), getSellerReviews);
router.get("/seller/:id", authMiddleware, roleMiddleware("seller"), getReviewById);

// Customer write
router.post("/", authMiddleware, roleMiddleware("customer"), addReview);
router.put("/:id", authMiddleware, roleMiddleware("customer"), updateReview);
router.delete("/:id", authMiddleware, roleMiddleware("customer"), deleteReview);

// ── Dynamic routes LAST ───────────────────────────────────────────────────────
// Public — get reviews for a product
router.get("/:productId", getProductReviews);

module.exports = router;
