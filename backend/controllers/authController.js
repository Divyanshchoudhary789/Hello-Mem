const jwt = require("jsonwebtoken");
const Customer = require("../models/customers");
const Seller = require("../models/sellersModel");
const {
  generateAccessToken,
  generateRefreshToken,
  setTokenCookies,
  clearTokenCookies,
} = require("../utils/tokens");
const {
  getAdminRefreshToken,
  setAdminRefreshToken,
} = require("../controllers/adminController");

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/refresh
// Accepts a refresh token from the HttpOnly cookie and rotates both tokens.
// Works for admin, seller, and customer roles.
// ─────────────────────────────────────────────────────────────────────────────
const refreshToken = async (req, res) => {
  try {
    const token = req.cookies?.refreshToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Refresh token not found. Please log in.",
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
    } catch (err) {
      clearTokenCookies(res);
      return res.status(401).json({
        success: false,
        message: "Refresh token expired or invalid. Please log in again.",
      });
    }

    const role = decoded.role;

    // ── Admin ────────────────────────────────────────────────────────────────
    if (role === "admin") {
      const storedToken = getAdminRefreshToken();

      if (!storedToken || storedToken !== token) {
        clearTokenCookies(res);
        return res.status(401).json({
          success: false,
          message: "Invalid admin session. Please log in again.",
        });
      }

      const newAccessToken = generateAccessToken({ id: "admin", _id: "admin", role: "admin" });
      const newRefreshToken = generateRefreshToken({ id: "admin", _id: "admin", role: "admin" });

      setAdminRefreshToken(newRefreshToken);
      setTokenCookies(res, newAccessToken, newRefreshToken);

      return res.status(200).json({
        success: true,
        message: "Token refreshed.",
        accessToken: newAccessToken,
      });
    }

    // ── Customer / Seller ────────────────────────────────────────────────────
    let user = null;

    if (role === "customer") {
      user = await Customer.findById(decoded.id).select("+refreshToken");
    } else if (role === "seller") {
      user = await Seller.findById(decoded.id).select("+refreshToken");
    } else {
      return res.status(401).json({ success: false, message: "Invalid token." });
    }

    if (!user || user.refreshToken !== token) {
      clearTokenCookies(res);
      return res.status(401).json({
        success: false,
        message: "Invalid session. Please log in again.",
      });
    }

    if (!user.isActive) {
      clearTokenCookies(res);
      return res.status(403).json({ success: false, message: "Account is disabled." });
    }

    // Rotate both tokens to prevent refresh token reuse attacks
    const newAccessToken = generateAccessToken({ _id: user._id, role });
    const newRefreshToken = generateRefreshToken({ _id: user._id, role });

    user.refreshToken = newRefreshToken;
    await user.save();

    setTokenCookies(res, newAccessToken, newRefreshToken);

    return res.status(200).json({
      success: true,
      message: "Token refreshed.",
      accessToken: newAccessToken,
    });
  } catch (error) {
    console.error("Refresh Token Error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error." });
  }
};

module.exports = { refreshToken };
