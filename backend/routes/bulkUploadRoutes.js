const express = require("express");
const multer = require("multer");

const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const uploadExcel = require("../middlewares/uploadExcel");
const bulkUploadController = require("../controllers/bulkUploadController");

// All bulk-upload routes are seller-only
router.use(authMiddleware, roleMiddleware("seller"));

// Download sample Excel template
router.get("/sample", bulkUploadController.downloadSampleFile);

// Upload history (paginated) — ?page=1&limit=10
router.get("/history", bulkUploadController.getUploadHistory);

// Bulk product upload
router.post(
  "/",
  (req, res, next) => {
    uploadExcel.single("file")(req, res, (err) => {
      if (!err) return next();

      // Multer-specific errors (file type, size, etc.)
      if (err instanceof multer.MulterError) {
        const message =
          err.code === "LIMIT_FILE_SIZE"
            ? "File too large. Maximum allowed size is 5 MB."
            : err.message;
        return res.status(400).json({ success: false, message });
      }

      // Custom fileFilter errors
      return res.status(400).json({ success: false, message: err.message });
    });
  },
  bulkUploadController.bulkUploadProducts
);

module.exports = router;
