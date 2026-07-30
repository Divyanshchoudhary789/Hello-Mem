const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const vendorCommissionController = require("../controllers/vendorCommissionController");

// Admin only — commission rules are set by admin
router.use(authMiddleware, roleMiddleware("admin"));

router.post("/", vendorCommissionController.createVendorCommission);
router.get("/", vendorCommissionController.getVendorCommissions);
router.get("/:id", vendorCommissionController.getVendorCommissionById);
router.put("/:id", vendorCommissionController.updateVendorCommission);
router.patch("/:id/status", vendorCommissionController.updateVendorCommissionStatus);
router.delete("/:id", vendorCommissionController.deleteVendorCommission);

module.exports = router;
