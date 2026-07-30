const mongoose = require("mongoose");

/**
 * Generic OTP storage model.
 * `identifier` can be a phone number, email, or any unique key (e.g. "admin").
 * `purpose` scopes the OTP so the same phone can have independent OTPs for
 *   different flows (register, login, verify) without collision.
 * TTL index on `expiresAt` lets MongoDB auto-delete expired documents.
 */
const otpSchema = new mongoose.Schema(
  {
    identifier: {
      type: String,
      required: true,
    },
    purpose: {
      type: String,
      required: true,
      enum: ["customer_register", "customer_login", "seller_register", "seller_login"],
    },
    otp: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 }, // TTL: MongoDB removes the doc when expiresAt is reached
    },
  },
  { timestamps: true }
);

// Compound unique index: one active OTP per (identifier, purpose) pair
otpSchema.index({ identifier: 1, purpose: 1 }, { unique: true });

module.exports = mongoose.model("Otp", otpSchema);
