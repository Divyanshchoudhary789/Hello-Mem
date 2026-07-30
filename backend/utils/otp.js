const Otp = require("../models/otpModel");

const crypto = require("crypto");

/**
 * Generate a cryptographically secure OTP of configurable length.
 * Length is controlled by MSG91_OTP_LENGTH env var (default: 4 digits).
 */
const generateOtp = () => {
  const length = parseInt(process.env.MSG91_OTP_LENGTH || "4", 10);
  const min = Math.pow(10, length - 1);   // e.g. 1000 for 4 digits
  const max = Math.pow(10, length) - 1;   // e.g. 9999 for 4 digits
  return String(crypto.randomInt(min, max + 1));
};

/**
 * Save (upsert) an OTP for a given identifier + purpose.
 * OTP expires in `ttlMinutes` minutes (default 10).
 *
 * @param {string} identifier  - phone number or any unique key
 * @param {string} purpose     - one of the purpose enum values in otpModel
 * @param {number} ttlMinutes  - how long before the OTP expires
 * @returns {string} the generated OTP
 */
const saveOtp = async (identifier, purpose, ttlMinutes = 10) => {
  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  await Otp.findOneAndUpdate(
    { identifier, purpose },
    { otp, expiresAt },
    { upsert: true, new: true }
  );

  return otp;
};

/**
 * Verify an OTP for a given identifier + purpose.
 * Deletes the record on success.
 *
 * @returns {{ success: boolean, message: string }}
 */
const verifyOtp = async (identifier, purpose, otp) => {
  const record = await Otp.findOne({ identifier, purpose });

  if (!record) {
    return { success: false, message: "OTP not found or already used." };
  }

  if (record.otp !== String(otp)) {
    return { success: false, message: "Invalid OTP." };
  }

  if (record.expiresAt < new Date()) {
    await Otp.deleteOne({ identifier, purpose });
    return { success: false, message: "OTP has expired." };
  }

  await Otp.deleteOne({ identifier, purpose });
  return { success: true, message: "OTP verified successfully." };
};

module.exports = { saveOtp, verifyOtp };
