const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const bankController = require("../controllers/bankController");

// Public — anyone can read bank list (needed for dropdowns in forms)
router.get("/", bankController.getBanks);
router.get("/:id", bankController.getBankById);

// Admin only — bank master data management
router.post("/", authMiddleware, roleMiddleware("admin"), bankController.createBank);
router.put("/:id", authMiddleware, roleMiddleware("admin"), bankController.updateBank);
router.patch("/:id/status", authMiddleware, roleMiddleware("admin"), bankController.updateBankStatus);
router.delete("/:id", authMiddleware, roleMiddleware("admin"), bankController.deleteBank);

module.exports = router;
