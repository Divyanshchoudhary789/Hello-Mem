const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const userBankController = require("../controllers/userBankController");

// Admin only — must come before /:id to avoid route conflict
router.get("/all", authMiddleware, roleMiddleware("admin"), userBankController.getAllUserBanks);

// Seller or Admin — view a customer's bank details
router.get(
  "/customer/:customerId",
  authMiddleware,
  roleMiddleware("seller", "admin"),
  userBankController.getCustomerBankDetails
);

// Seller only — hide a bank from their dashboard
router.delete(
  "/seller/:id",
  authMiddleware,
  roleMiddleware("seller"),
  userBankController.removeCustomerBankFromSeller
);

// Customer routes (own bank accounts)
router.post("/", authMiddleware, roleMiddleware("customer"), userBankController.createUserBank);
router.get("/", authMiddleware, roleMiddleware("customer"), userBankController.getUserBanks);
router.get("/:id", authMiddleware, roleMiddleware("customer"), userBankController.getUserBankById);
router.put("/:id", authMiddleware, roleMiddleware("customer"), userBankController.updateUserBank);
router.patch("/:id/status", authMiddleware, roleMiddleware("customer"), userBankController.updateUserBankStatus);
router.patch("/:id/primary", authMiddleware, roleMiddleware("customer"), userBankController.makePrimaryBank);
router.delete("/:id", authMiddleware, roleMiddleware("customer"), userBankController.deleteUserBank);

module.exports = router;
