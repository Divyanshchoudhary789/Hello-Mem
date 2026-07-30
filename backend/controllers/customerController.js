const Customer = require("../models/customers");
const Seller = require("../models/sellersModel");
const Cart = require("../models/cart");
const { saveOtp, verifyOtp } = require("../utils/otp");
const { sendOtp: sendSmSOtp } = require("../config/msg.config");
const {
  generateAccessToken,
  generateRefreshToken,
  setTokenCookies,
  clearTokenCookies,
} = require("../utils/tokens");

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper — issue tokens, save refresh token, set cookies
// ─────────────────────────────────────────────────────────────────────────────
const issueTokens = async (res, customer) => {
  const payload = { _id: customer._id, role: "customer" };
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  customer.refreshToken = refreshToken;
  await customer.save();

  setTokenCookies(res, accessToken, refreshToken);

  return { accessToken, refreshToken };
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper — shape a safe customer object for API responses.
// Never exposes refreshToken, __v, or internal fields.
// ─────────────────────────────────────────────────────────────────────────────
const formatCustomer = (customer) => ({
  id: customer._id,
  firstName: customer.firstName,
  lastName: customer.lastName,
  email: customer.email,
  mobileNumber: customer.mobileNumber,
  address: {
    shippingAddress: customer.address?.shippingAddress || null,
    state: customer.address?.state || null,
    cityId: customer.address?.cityId || null,
    postalCode: customer.address?.postalCode || null,
  },
  isActive: customer.isActive,
  createdAt: customer.createdAt,
  updatedAt: customer.updatedAt,
});

// ─────────────────────────────────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────────────────────────────────
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_REGEX = /^[a-zA-Z\s'-]+$/;
const PINCODE_REGEX = /^\d{6}$/;

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/customer/send-otp
// Sends OTP to the given phone number.
// Used for registration, login, and phone-change flows.
// ─────────────────────────────────────────────────────────────────────────────
const sendCustomerOtp = async (req, res) => {
  try {
    const { phone, purpose } = req.body;

    if (!phone || !purpose) {
      return res.status(400).json({
        success: false,
        message: "Phone number and purpose are required.",
      });
    }

    if (!["register", "login"].includes(purpose)) {
      return res.status(400).json({
        success: false,
        message: "Invalid purpose. Must be 'register' or 'login'.",
      });
    }

    const mobileNumber = phone.trim();
    const otpPurpose = purpose === "register" ? "customer_register" : "customer_login";

    if (purpose === "login") {
      const customer = await Customer.findOne({ mobileNumber });
      if (!customer) {
        return res.status(404).json({
          success: false,
          message: "No account found with this phone number. Please register first.",
        });
      }

      if (!customer.isActive) {
        return res.status(403).json({
          success: false,
          message: "Your account has been disabled. Please contact support.",
        });
      }
    }

    if (purpose === "register") {
      const exists = await Customer.findOne({ mobileNumber });
      if (exists) {
        return res.status(409).json({
          success: false,
          message: "Phone number is already registered. Please log in instead.",
        });
      }
    }

    const otp = await saveOtp(mobileNumber, otpPurpose, 10);

    try {
      await sendSmSOtp(mobileNumber, otp);
    } catch (smsErr) {
      console.error("SMS send failed:", smsErr.message);
    }

    const responsePayload = {
      success: true,
      message: `OTP sent successfully to ${mobileNumber}.`,
    };

    if (process.env.NODE_ENV !== "production") {
      responsePayload.otp = otp;
    }

    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error("Send Customer OTP Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to send OTP. Please try again.",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/customer/register
// Step 2 of registration: verify OTP + create account + issue tokens.
// ─────────────────────────────────────────────────────────────────────────────
const registerCustomer = async (req, res) => {
  try {
    const { firstName, lastName, phone, email, otp } = req.body;

    if (!firstName || !lastName || !phone || !otp) {
      return res.status(400).json({
        success: false,
        message: "First name, last name, phone, and OTP are required.",
      });
    }

    const mobileNumber = phone.trim();
    const normalizedEmail = email?.trim().toLowerCase() || null;

    const otpResult = await verifyOtp(mobileNumber, "customer_register", otp);
    if (!otpResult.success) {
      return res.status(400).json({ success: false, message: otpResult.message });
    }

    const existingByPhone = await Customer.findOne({ mobileNumber });
    if (existingByPhone) {
      return res.status(409).json({
        success: false,
        message: "Phone number is already registered.",
      });
    }

    if (normalizedEmail) {
      const [emailCustomer, emailSeller] = await Promise.all([
        Customer.findOne({ email: normalizedEmail }),
        Seller.findOne({ email: normalizedEmail }),
      ]);

      if (emailCustomer || emailSeller) {
        return res.status(409).json({
          success: false,
          message: "Email address is already registered.",
        });
      }
    }

    const customer = await Customer.create({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      mobileNumber,
      email: normalizedEmail,
    });

    const { accessToken } = await issueTokens(res, customer);

    return res.status(201).json({
      success: true,
      message: "Account created successfully.",
      customer: formatCustomer(customer),
      accessToken,
    });
  } catch (error) {
    console.error("Register Customer Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error.",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/customer/login
// Step 2 of login: verify OTP + issue tokens.
// ─────────────────────────────────────────────────────────────────────────────
const customerLogin = async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({
        success: false,
        message: "Phone number and OTP are required.",
      });
    }

    const mobileNumber = phone.trim();

    const otpResult = await verifyOtp(mobileNumber, "customer_login", otp);
    if (!otpResult.success) {
      return res.status(400).json({ success: false, message: otpResult.message });
    }

    const customer = await Customer.findOne({ mobileNumber });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Account not found. Please register first.",
      });
    }

    if (!customer.isActive) {
      return res.status(403).json({
        success: false,
        message: "Your account has been disabled. Please contact support.",
      });
    }

    const { accessToken } = await issueTokens(res, customer);

    return res.status(200).json({
      success: true,
      message: "Logged in successfully.",
      customer: formatCustomer(customer),
      accessToken,
    });
  } catch (error) {
    console.error("Customer Login Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error.",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/customer/logout
// ─────────────────────────────────────────────────────────────────────────────
const customerLogout = async (req, res) => {
  try {
    const customer = await Customer.findById(req.user._id);
    if (customer) {
      customer.refreshToken = null;
      await customer.save();
    }

    clearTokenCookies(res);

    return res.status(200).json({
      success: true,
      message: "Logged out successfully.",
    });
  } catch (error) {
    console.error("Customer Logout Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error.",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/customer/profile
// Returns the logged-in customer's full profile.
// ─────────────────────────────────────────────────────────────────────────────
const getCustomerProfile = async (req, res) => {
  try {
    const customer = await Customer.findById(req.user._id);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found.",
      });
    }

    return res.status(200).json({
      success: true,
      customer: formatCustomer(customer),
    });
  } catch (error) {
    console.error("Get Customer Profile Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error.",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/customer/profile
// Update basic info: firstName, lastName, email.
// Phone number is NOT changeable here — use the dedicated change-phone flow.
// All fields are optional; only provided fields are updated.
// ─────────────────────────────────────────────────────────────────────────────
const updateCustomerProfile = async (req, res) => {
  try {
    const { firstName, lastName, email } = req.body;

    // At least one field must be present
    if (!firstName && !lastName && email === undefined) {
      return res.status(400).json({
        success: false,
        message: "At least one field (firstName, lastName, email) is required.",
      });
    }

    // ── Validate individual fields ──────────────────────────────────────────
    if (firstName !== undefined) {
      const trimmed = firstName.trim();
      if (!trimmed) {
        return res.status(400).json({ success: false, message: "First name cannot be empty." });
      }
      if (trimmed.length > 50) {
        return res.status(400).json({ success: false, message: "First name must be 50 characters or less." });
      }
      if (!NAME_REGEX.test(trimmed)) {
        return res.status(400).json({ success: false, message: "First name can only contain letters, spaces, hyphens, and apostrophes." });
      }
    }

    if (lastName !== undefined) {
      const trimmed = lastName.trim();
      if (!trimmed) {
        return res.status(400).json({ success: false, message: "Last name cannot be empty." });
      }
      if (trimmed.length > 50) {
        return res.status(400).json({ success: false, message: "Last name must be 50 characters or less." });
      }
      if (!NAME_REGEX.test(trimmed)) {
        return res.status(400).json({ success: false, message: "Last name can only contain letters, spaces, hyphens, and apostrophes." });
      }
    }

    if (email !== undefined && email !== null && email !== "") {
      const normalizedEmail = email.trim().toLowerCase();
      if (!EMAIL_REGEX.test(normalizedEmail)) {
        return res.status(400).json({ success: false, message: "Invalid email address format." });
      }

      // Email uniqueness check — make sure no other customer or seller uses it
      const [existingCustomer, existingSeller] = await Promise.all([
        Customer.findOne({ email: normalizedEmail, _id: { $ne: req.user._id } }),
        Seller.findOne({ email: normalizedEmail }),
      ]);

      if (existingCustomer || existingSeller) {
        return res.status(409).json({
          success: false,
          message: "This email address is already in use.",
        });
      }
    }

    // ── Fetch and update ────────────────────────────────────────────────────
    const customer = await Customer.findById(req.user._id);

    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found." });
    }

    if (firstName !== undefined) customer.firstName = firstName.trim();
    if (lastName !== undefined) customer.lastName = lastName.trim();

    if (email !== undefined) {
      // Allow clearing email by passing empty string or null
      customer.email = (email === "" || email === null)
        ? null
        : email.trim().toLowerCase();
    }

    await customer.save();

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      customer: formatCustomer(customer),
    });
  } catch (error) {
    console.error("Update Customer Profile Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error.",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/customer/profile/address
// Update shipping address details.
// All sub-fields are optional — only provided fields overwrite existing values.
// ─────────────────────────────────────────────────────────────────────────────
const updateCustomerAddress = async (req, res) => {
  try {
    const { shippingAddress, state, cityId, postalCode } = req.body;

    if (
      shippingAddress === undefined &&
      state === undefined &&
      cityId === undefined &&
      postalCode === undefined
    ) {
      return res.status(400).json({
        success: false,
        message: "At least one address field is required.",
      });
    }

    // ── Validate fields ─────────────────────────────────────────────────────
    if (shippingAddress !== undefined) {
      const trimmed = shippingAddress.trim();
      if (!trimmed) {
        return res.status(400).json({ success: false, message: "Shipping address cannot be empty." });
      }
      if (trimmed.length > 200) {
        return res.status(400).json({ success: false, message: "Shipping address must be 200 characters or less." });
      }
    }

    if (state !== undefined) {
      const trimmed = state.trim();
      if (!trimmed) {
        return res.status(400).json({ success: false, message: "State cannot be empty." });
      }
      if (trimmed.length > 100) {
        return res.status(400).json({ success: false, message: "State must be 100 characters or less." });
      }
    }

    if (postalCode !== undefined && postalCode !== null && postalCode !== "") {
      if (!PINCODE_REGEX.test(postalCode.trim())) {
        return res.status(400).json({ success: false, message: "Postal code must be a 6-digit number." });
      }
    }

    // ── Fetch and update ────────────────────────────────────────────────────
    const customer = await Customer.findById(req.user._id);

    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found." });
    }

    // Granular update — only overwrite what was sent
    if (shippingAddress !== undefined) customer.address.shippingAddress = shippingAddress.trim();
    if (state !== undefined) customer.address.state = state.trim();
    if (cityId !== undefined) customer.address.cityId = cityId || null;
    if (postalCode !== undefined) {
      customer.address.postalCode = (postalCode === "" || postalCode === null)
        ? null
        : postalCode.trim();
    }

    // markModified required because address is a nested object (not a subdocument)
    customer.markModified("address");
    await customer.save();

    return res.status(200).json({
      success: true,
      message: "Address updated successfully.",
      customer: formatCustomer(customer),
    });
  } catch (error) {
    console.error("Update Customer Address Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error.",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/customer/profile
// Soft-delete: marks the account as inactive, clears cart and session.
// Orders are preserved for business/legal records.
// Does NOT permanently delete the account — only admin can do that.
// ─────────────────────────────────────────────────────────────────────────────
const deleteCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.user._id);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found.",
      });
    }

    // Soft delete — preserve order history for business records
    customer.isActive = false;
    customer.refreshToken = null;
    await customer.save();

    // Clear cart
    await Cart.deleteOne({ customer: req.user._id });

    clearTokenCookies(res);

    return res.status(200).json({
      success: true,
      message: "Account deactivated successfully. Your order history has been retained.",
    });
  } catch (error) {
    console.error("Delete Customer Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error.",
    });
  }
};

module.exports = {
  sendCustomerOtp,
  registerCustomer,
  customerLogin,
  customerLogout,
  getCustomerProfile,
  updateCustomerProfile,
  updateCustomerAddress,
  deleteCustomer,
};
