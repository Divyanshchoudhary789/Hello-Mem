const express = require("express");
const router = express.Router();

const { refreshToken } = require("../controllers/authController");

// Rotate access + refresh tokens using the HttpOnly refreshToken cookie.
// Works for admin, seller, and customer.
router.post("/refresh", refreshToken);

module.exports = router;
