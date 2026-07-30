const axios = require("axios");

// ─────────────────────────────────────────────────────────────────────────────
// MSG91 OTP API — using /api/v5/otp (GET with query params) as per client config
// Docs: https://world.msg91.com/apidoc/otp/otp.php
// ─────────────────────────────────────────────────────────────────────────────

const MSG91_SEND_OTP_URL   = "https://control.msg91.com/api/v5/otp";
const MSG91_VERIFY_OTP_URL = "https://control.msg91.com/api/v5/otp/verify";
const MSG91_RETRY_OTP_URL  = "https://control.msg91.com/api/v5/otp/retry";

/**
 * Validates that all required ENV vars are present.
 * Throws early so errors are obvious at call-time, not buried in axios failures.
 */
const validateCredentials = () => {
  if (!process.env.MSG91_TOKEN)   throw new Error("MSG91_TOKEN is missing from environment variables.");
  if (!process.env.MSG91_TEMPLATE_ID) throw new Error("MSG91_TEMPLATE_ID is missing from environment variables.");
  if (!process.env.MSG91_SENDER)  throw new Error("MSG91_SENDER is missing from environment variables.");
};

/**
 * Normalise any Indian mobile number to the 12-digit format MSG91 expects (91XXXXXXXXXX).
 * Throws on obviously invalid input.
 */
const formatPhoneNumber = (phone) => {
  const cleaned = String(phone).replace(/\D/g, "");
  if (cleaned.startsWith("91") && cleaned.length === 12) return cleaned;
  if (cleaned.length === 10) return `91${cleaned}`;
  throw new Error(
    `Invalid phone number "${phone}". Provide a 10-digit number or a 91-prefixed 12-digit number.`
  );
};

/**
 * Send an OTP via MSG91 OTP API (GET with query params).
 *
 * MSG91 inserts the `otp` value into your template's ##OTP## placeholder.
 * If you omit `otp`, MSG91 generates one — but then you can't verify it
 * against your own DB, so always pass the value you stored.
 *
 * @param {string|number} phone  - 10-digit or 91-prefixed number
 * @param {string|number} otp    - the OTP you already saved to DB
 * @returns {object} MSG91 response body
 */
const sendOtp = async (phone, otp) => {
  validateCredentials();

  const mobile = formatPhoneNumber(phone);

  const params = {
    authkey:     process.env.MSG91_TOKEN,
    mobile,
    otp:         String(otp),
    sender:      process.env.MSG91_SENDER,       // e.g. HELMEM
    template_id: process.env.MSG91_TEMPLATE_ID,  // e.g. 694f714d80cf5170ca3ee9b2
    otp_length:  process.env.MSG91_OTP_LENGTH  || "4",
    otp_expiry:  process.env.MSG91_OTP_EXPIRY  || "10",
  };

  const response = await axios.get(MSG91_SEND_OTP_URL, { params });

  // MSG91 returns { type: "success" | "error", message: "..." }
  if (response.data?.type === "error") {
    throw new Error(`MSG91 sendOtp failed: ${response.data.message}`);
  }

  return response.data;
};

/**
 * Verify an OTP via MSG91 OTP API.
 * Note: Our primary verification is done in-DB (utils/otp.js → verifyOtp).
 * This helper exists for cases where you want to delegate verification to MSG91.
 *
 * @param {string|number} phone
 * @param {string|number} otp
 * @returns {{ success: boolean, message: string }}
 */
const verifyOtpViaMSG91 = async (phone, otp) => {
  validateCredentials();

  const mobile = formatPhoneNumber(phone);

  const response = await axios.get(MSG91_VERIFY_OTP_URL, {
    params: {
      authkey: process.env.MSG91_TOKEN,
      mobile,
      otp: String(otp),
    },
  });

  const isVerified =
    response.data?.type === "success" ||
    response.data?.message?.toLowerCase().includes("success");

  return {
    success: isVerified,
    message: response.data?.message || "OTP verification response received.",
  };
};

/**
 * Retry / resend an OTP via MSG91.
 * MSG91 will resend the last generated OTP for that mobile via text.
 *
 * @param {string|number} phone
 * @returns {object} MSG91 response body
 */
const retryOtp = async (phone) => {
  validateCredentials();

  const mobile = formatPhoneNumber(phone);

  const response = await axios.get(MSG91_RETRY_OTP_URL, {
    params: {
      authkey: process.env.MSG91_TOKEN,
      mobile,
      retrytype: "text", // "text" | "voice"
    },
  });

  if (response.data?.type === "error") {
    throw new Error(`MSG91 retryOtp failed: ${response.data.message}`);
  }

  return response.data;
};

module.exports = { sendOtp, verifyOtpViaMSG91, retryOtp };
