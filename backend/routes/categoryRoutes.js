const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");

const {
  createCategory,
  getAllCategories,
  getCategoryById,
  updateCategory,
} = require("../controllers/categoryController");

// Public
router.get("/", getAllCategories);
router.get("/:id", getCategoryById);

// Admin only
router.post("/", authMiddleware, roleMiddleware("admin"), createCategory);
router.put("/:id", authMiddleware, roleMiddleware("admin"), updateCategory);

module.exports = router;
