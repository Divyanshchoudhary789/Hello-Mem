const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");

const {
  addToCart,
  getCart,
  updateCartItem,
  removeCartItem,
  clearCart,
} = require("../controllers/cartController");

// All cart operations are customer-only
router.use(authMiddleware, roleMiddleware("customer"));

router.post("/add", addToCart);
router.get("/", getCart);
router.patch("/update/:productId", updateCartItem);
router.delete("/remove/:productId", removeCartItem);
router.delete("/clear", clearCart);

module.exports = router;
