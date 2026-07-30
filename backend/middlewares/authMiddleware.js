const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Customer = require("../models/customers");
const Seller = require("../models/sellersModel");

/**
 * JWT auth middleware.
 *
 * Reads the token from:
 *   1. Authorization: Bearer <token> header
 *   2. accessToken cookie
 *
 * Attaches req.user with:
 *   - _id  : mongoose ObjectId  (use for DB queries and comparisons)
 *   - id   : string version of _id  (use for string comparisons)
 *   - role : "customer" | "seller" | "admin"
 *   + all other fields from the DB document
 *
 * RULE: always use req.user._id for DB queries, req.user.id for string comparisons.
 */
const authMiddleware = async (req, res, next) => {
  try {
    const bearerToken = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.split(" ")[1]
      : null;

    const token = bearerToken || req.cookies?.accessToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required. Please log in.",
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    } catch (err) {
      return res.status(401).json({
        success: false,
        message:
          err.name === "TokenExpiredError"
            ? "Access token expired. Please refresh your session."
            : "Invalid access token.",
      });
    }

    // ── Admin ─────────────────────────────────────────────────────────────────
    if (decoded.role === "admin") {
      req.user = {
        _id: "admin",
        id: "admin",
        role: "admin",
        email: process.env.ADMIN_EMAIL,
        phone: process.env.ADMIN_PHONE,
      };
      return next();
    }

    // Validate ObjectId before hitting DB
    const rawId = decoded.id || decoded._id;
    if (!rawId || !mongoose.Types.ObjectId.isValid(rawId)) {
      return res.status(401).json({ success: false, message: "Invalid token payload." });
    }

    const objectId = new mongoose.Types.ObjectId(rawId);

    // ── Customer ──────────────────────────────────────────────────────────────
    if (decoded.role === "customer") {
      const customer = await Customer.findById(objectId);

      if (!customer) {
        return res.status(401).json({ success: false, message: "Account not found." });
      }

      if (!customer.isActive) {
        return res.status(403).json({
          success: false,
          message: "Your account has been disabled. Please contact support.",
        });
      }

      req.user = {
        ...customer.toObject(),
        _id: customer._id,        // mongoose ObjectId — for DB queries
        id: customer._id.toString(), // string — for comparisons
        role: "customer",
      };
      return next();
    }

    // ── Seller ────────────────────────────────────────────────────────────────
    if (decoded.role === "seller") {
      const seller = await Seller.findById(objectId);

      if (!seller) {
        return res.status(401).json({ success: false, message: "Account not found." });
      }

      if (!seller.isActive) {
        return res.status(403).json({
          success: false,
          message: "Your account has been deactivated. Please contact support.",
        });
      }

      req.user = {
        ...seller.toObject(),
        _id: seller._id,           // mongoose ObjectId — for DB queries
        id: seller._id.toString(),  // string — for comparisons
        role: "seller",
      };
      return next();
    }

    return res.status(401).json({ success: false, message: "Invalid token payload." });
  } catch (error) {
    console.error("Auth Middleware Error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error." });
  }
};

module.exports = authMiddleware;
