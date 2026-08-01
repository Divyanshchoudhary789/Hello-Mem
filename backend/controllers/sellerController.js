const Seller = require("../models/sellersModel");
const Customer = require("../models/customers");
const Product = require("../models/productModel");
const Order = require("../models/order");
const VendorPayment = require("../models/vendorPaymentModel");
const { saveOtp, verifyOtp } = require("../utils/otp");
const { sendOtp: sendSmsOtp } = require("../config/msg.config");
const {
  generateAccessToken,
  generateRefreshToken,
  setTokenCookies,
  clearTokenCookies,
} = require("../utils/tokens");

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper — issue tokens, save refresh token, set cookies
// ─────────────────────────────────────────────────────────────────────────────
const issueTokens = async (res, seller) => {
  const payload = { _id: seller._id, role: "seller" };
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  await Seller.findByIdAndUpdate(seller._id, { refreshToken });
  setTokenCookies(res, accessToken, refreshToken);

  return { accessToken, refreshToken };
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sellers/send-otp
// Unified OTP sender for both register and login flows.
// Body: { phone, purpose: "register" | "login" }
// ─────────────────────────────────────────────────────────────────────────────
const sendSellerOtp = async (req, res) => {
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
    const otpPurpose = purpose === "register" ? "seller_register" : "seller_login";

    if (purpose === "register") {
      // Phone must not already exist for any user type
      const [existingSeller, existingCustomer] = await Promise.all([
        Seller.findOne({ phone: mobileNumber }),
        Customer.findOne({ mobileNumber }),
      ]);

      if (existingSeller || existingCustomer) {
        return res.status(409).json({
          success: false,
          message: "Phone number is already registered.",
        });
      }
    }

    if (purpose === "login") {
      // Seller must already exist
      const seller = await Seller.findOne({ phone: mobileNumber });
      if (!seller) {
        return res.status(404).json({
          success: false,
          message: "No seller account found with this phone number. Please register first.",
        });
      }

      if (!seller.isActive) {
        return res.status(403).json({
          success: false,
          message: "Your account has been deactivated. Please contact support.",
        });
      }
    }

    const otp = await saveOtp(mobileNumber, otpPurpose, 10); // 10 min TTL

    try {
      await sendSmsOtp(mobileNumber, otp);
    } catch (smsErr) {
      console.error("SMS send failed:", smsErr.message);
      // In production, you may want to return 500 here
    }

    const response = {
      success: true,
      message: `OTP sent to ${mobileNumber}.`,
    };

    if (process.env.NODE_ENV !== "production") {
      response.otp = otp; // convenience for dev/testing only
    }

    return res.status(200).json(response);
  } catch (error) {
    console.error("Send Seller OTP Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to send OTP. Please try again.",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sellers/register
// Step 2 of registration: verify OTP + create seller account + issue tokens.
// Required body: firstName, lastName, email, phone, otp, businessName
// ─────────────────────────────────────────────────────────────────────────────
const registerSeller = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      otp,
      businessName,
      businessType,
      gstNumber,
      panNumber,
      address,
      bankDetails,
    } = req.body;

    if (!firstName || !lastName || !email || !phone || !otp || !businessName) {
      return res.status(400).json({
        success: false,
        message: "First name, last name, email, phone, OTP, and business name are required.",
      });
    }

    // Landmark is mandatory inside address
    if (!address || !address.landmark) {
      return res.status(400).json({
        success: false,
        message: "Address with landmark is required.",
      });
    }

    const mobileNumber = phone.trim();
    const normalizedEmail = email.trim().toLowerCase();

    // Verify OTP first
    const otpResult = await verifyOtp(mobileNumber, "seller_register", otp);
    if (!otpResult.success) {
      return res.status(400).json({ success: false, message: otpResult.message });
    }

    // Race-condition guard: re-check uniqueness after OTP passes
    const [emailSeller, emailCustomer, phoneSeller, phoneCustomer] = await Promise.all([
      Seller.findOne({ email: normalizedEmail }),
      Customer.findOne({ email: normalizedEmail }),
      Seller.findOne({ phone: mobileNumber }),
      Customer.findOne({ mobileNumber }),
    ]);

    if (emailSeller || emailCustomer) {
      return res.status(409).json({
        success: false,
        message: "Email address is already registered.",
      });
    }

    if (phoneSeller || phoneCustomer) {
      return res.status(409).json({
        success: false,
        message: "Phone number is already registered.",
      });
    }

    const seller = await Seller.create({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: normalizedEmail,
      phone: mobileNumber,
      businessName: businessName.trim(),
      businessType,
      gstNumber,
      panNumber,
      address,
      bankDetails,
    });

    const { accessToken } = await issueTokens(res, seller);

    return res.status(201).json({
      success: true,
      message: "Seller account created successfully.",
      seller: {
        id: seller._id,
        firstName: seller.firstName,
        lastName: seller.lastName,
        email: seller.email,
        phone: seller.phone,
        businessName: seller.businessName,
        verificationStatus: seller.verificationStatus,
      },
      accessToken,
    });
  } catch (error) {
    console.error("Register Seller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error.",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sellers/login
// Step 2 of OTP login: verify OTP + issue tokens.
// Body: { phone, otp }
// ─────────────────────────────────────────────────────────────────────────────
const loginSeller = async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({
        success: false,
        message: "Phone number and OTP are required.",
      });
    }

    const mobileNumber = phone.trim();

    // Verify OTP
    const otpResult = await verifyOtp(mobileNumber, "seller_login", otp);
    if (!otpResult.success) {
      return res.status(400).json({ success: false, message: otpResult.message });
    }

    const seller = await Seller.findOne({ phone: mobileNumber });

    if (!seller) {
      return res.status(404).json({
        success: false,
        message: "Seller account not found. Please register first.",
      });
    }

    if (!seller.isActive) {
      return res.status(403).json({
        success: false,
        message: "Your account has been deactivated. Please contact support.",
      });
    }

    const { accessToken } = await issueTokens(res, seller);

    return res.status(200).json({
      success: true,
      message: "Logged in successfully.",
      seller: {
        id: seller._id,
        firstName: seller.firstName,
        lastName: seller.lastName,
        email: seller.email,
        phone: seller.phone,
        businessName: seller.businessName,
        verificationStatus: seller.verificationStatus,
      },
      accessToken,
    });
  } catch (error) {
    console.error("Seller Login Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error.",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sellers/logout
// ─────────────────────────────────────────────────────────────────────────────
const logoutSeller = async (req, res) => {
  try {
    await Seller.findByIdAndUpdate(req.user._id, { refreshToken: null });
    clearTokenCookies(res);

    return res.status(200).json({
      success: true,
      message: "Logged out successfully.",
    });
  } catch (error) {
    console.error("Seller Logout Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error.",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sellers/profile
// ─────────────────────────────────────────────────────────────────────────────
const getProfile = async (req, res) => {
  try {
    const seller = await Seller.findById(req.user._id);

    if (!seller) {
      return res.status(404).json({
        success: false,
        message: "Seller not found.",
      });
    }

    return res.status(200).json({
      success: true,
      seller,
    });
  } catch (error) {
    console.error("Get Seller Profile Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error.",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/sellers/profile
// ─────────────────────────────────────────────────────────────────────────────
const updateProfile = async (req, res) => {
  try {
    const seller = await Seller.findById(req.user._id);

    if (!seller) {
      return res.status(404).json({
        success: false,
        message: "Seller not found.",
      });
    }

    const { firstName, lastName, businessName, businessType, gstNumber, panNumber, address, bankDetails } =
      req.body;

    if (firstName) seller.firstName = firstName.trim();
    if (lastName) seller.lastName = lastName.trim();
    if (businessName) seller.businessName = businessName.trim();
    if (businessType) seller.businessType = businessType;
    if (gstNumber !== undefined) seller.gstNumber = gstNumber;
    if (panNumber !== undefined) seller.panNumber = panNumber;
    if (address) seller.address = { ...seller.address, ...address };
    if (bankDetails) seller.bankDetails = { ...seller.bankDetails, ...bankDetails };

    await seller.save();

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      seller,
    });
  } catch (error) {
    console.error("Update Seller Profile Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error.",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/sellers/deactivate
// ─────────────────────────────────────────────────────────────────────────────
const deactivateSeller = async (req, res) => {
  try {
    const seller = await Seller.findById(req.user._id);

    if (!seller) {
      return res.status(404).json({
        success: false,
        message: "Seller not found.",
      });
    }

    seller.isActive = false;
    await seller.save();

    clearTokenCookies(res);

    return res.status(200).json({
      success: true,
      message: "Account deactivated.",
    });
  } catch (error) {
    console.error("Deactivate Seller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error.",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sellers/dashboard
// ─────────────────────────────────────────────────────────────────────────────
const dashboard = async (req, res) => {
  try {
    const sellerId = req.user._id;

    const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const sixMonthsAgo = new Date(new Date().getFullYear(), new Date().getMonth() - 5, 1);
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

    const validStatuses = [
      "CONFIRMED",
      "PROCESSING",
      "PACKED",
      "SHIPPED",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
    ];

    const [
      totalProducts,
      totalOrders,
      pendingOrders,
      confirmedOrders,
      deliveredOrders,
      cancelledOrders,
      totalUsers,
      totalRevenueResult,
      monthlyRevenueResult,
      monthlySales,
      salesChartRaw,
      recentOrdersRaw,
      paymentSummaryRaw,
      recentPaymentsRaw,
    ] = await Promise.all([
      Product.countDocuments({ seller: sellerId }),
      Order.countDocuments({ "items.seller": sellerId }),
      Order.countDocuments({ "items.seller": sellerId, orderStatus: "PENDING" }),
      Order.countDocuments({ "items.seller": sellerId, orderStatus: "CONFIRMED" }),
      Order.countDocuments({ "items.seller": sellerId, orderStatus: "DELIVERED" }),
      Order.countDocuments({ "items.seller": sellerId, orderStatus: "CANCELLED" }),
      Order.distinct("customer.customerId", { "items.seller": sellerId }),
      Order.aggregate([
        { $match: { orderStatus: { $in: validStatuses } } },
        { $unwind: "$items" },
        { $match: { "items.seller": sellerId } },
        { $group: { _id: null, revenue: { $sum: "$items.subtotal" } } },
      ]),
      Order.aggregate([
        { $match: { orderStatus: { $in: validStatuses }, createdAt: { $gte: firstDayOfMonth } } },
        { $unwind: "$items" },
        { $match: { "items.seller": sellerId } },
        { $group: { _id: null, revenue: { $sum: "$items.subtotal" } } },
      ]),
      Order.countDocuments({ "items.seller": sellerId, createdAt: { $gte: firstDayOfMonth } }),
      Order.aggregate([
        { $match: { orderStatus: { $in: validStatuses }, createdAt: { $gte: sixMonthsAgo } } },
        { $unwind: "$items" },
        { $match: { "items.seller": sellerId } },
        {
          $group: {
            _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
            revenue: { $sum: "$items.subtotal" },
            ordersCount: { $sum: 1 },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
      ]),
      Order.find({ "items.seller": sellerId, createdAt: { $gte: twoDaysAgo } })
        .sort({ createdAt: -1 })
        .select("orderNumber orderStatus pricing paymentStatus createdAt customer items"),
      VendorPayment.aggregate([
        { $match: { seller: sellerId } },
        {
          $group: {
            _id: "$paymentStatus",
            count: { $sum: 1 },
            totalGross: { $sum: "$grossAmount" },
            totalCommission: { $sum: "$commission" },
            totalGst: { $sum: "$gst" },
            totalNet: { $sum: "$netAmount" },
          },
        },
      ]),
      VendorPayment.find({ seller: sellerId })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate("order", "orderNumber orderStatus createdAt"),
    ]);

    let recentOrders = recentOrdersRaw;
    if (!recentOrders || recentOrders.length === 0) {
      recentOrders = await Order.find({ "items.seller": sellerId })
        .sort({ createdAt: -1 })
        .limit(5)
        .select("orderNumber orderStatus pricing paymentStatus createdAt customer items");
    }

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    const salesChart = salesChartRaw.map((item) => ({
      month: monthNames[item._id.month - 1],
      revenue: item.revenue,
      orders: item.ordersCount,
    }));

    const paymentSummary = {
      pending:    { count: 0, totalGross: 0, totalCommission: 0, totalGst: 0, totalNet: 0 },
      processing: { count: 0, totalGross: 0, totalCommission: 0, totalGst: 0, totalNet: 0 },
      paid:       { count: 0, totalGross: 0, totalCommission: 0, totalGst: 0, totalNet: 0 },
      failed:     { count: 0, totalGross: 0, totalCommission: 0, totalGst: 0, totalNet: 0 },
      cancelled:  { count: 0, totalGross: 0, totalCommission: 0, totalGst: 0, totalNet: 0 },
    };

    for (const row of paymentSummaryRaw) {
      const key = (row._id || "").toLowerCase();
      if (paymentSummary[key] !== undefined) {
        paymentSummary[key] = {
          count: row.count,
          totalGross: row.totalGross,
          totalCommission: row.totalCommission,
          totalGst: row.totalGst,
          totalNet: row.totalNet,
        };
      }
    }

    const totalEarningsGross = paymentSummaryRaw.reduce((sum, r) => sum + r.totalGross, 0);
    const totalEarningsNet   = paymentSummaryRaw.reduce((sum, r) => sum + r.totalNet, 0);
    const totalPaidNet       = paymentSummary.paid.totalNet;
    const totalPendingNet    = paymentSummary.pending.totalNet + paymentSummary.processing.totalNet;

    return res.status(200).json({
      success: true,
      dashboard: {
        totalProducts,
        totalOrders,
        pendingOrders,
        confirmedOrders,
        deliveredOrders,
        cancelledOrders,
        totalUsers: totalUsers.length,
        totalRevenue: totalRevenueResult[0]?.revenue ?? 0,
        monthlyRevenue: monthlyRevenueResult[0]?.revenue ?? 0,
        monthlySales,
        salesChart,
        recentOrders,
        payments: {
          summary: paymentSummary,
          totalEarningsGross: parseFloat(totalEarningsGross.toFixed(2)),
          totalEarningsNet:   parseFloat(totalEarningsNet.toFixed(2)),
          totalPaidNet:       parseFloat(totalPaidNet.toFixed(2)),
          totalPendingNet:    parseFloat(totalPendingNet.toFixed(2)),
          recentPayments: recentPaymentsRaw,
        },
      },
    });
  } catch (error) {
    console.error("Seller Dashboard Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error.",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sellers/get-user-details  (internal/admin utility)
// ─────────────────────────────────────────────────────────────────────────────
const getUserDetailsByEmail = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required." });
    }

    const seller = await Seller.findOne({ email: email.trim().toLowerCase() }).select(
      "_id firstName lastName email"
    );

    if (seller) {
      return res.status(200).json({
        success: true,
        role: "seller",
        data: {
          userId: seller._id,
          email: seller.email,
          firstName: seller.firstName,
          lastName: seller.lastName,
        },
      });
    }

    const customer = await Customer.findOne({ email: email.trim().toLowerCase() }).select(
      "_id firstName lastName email"
    );

    if (customer) {
      return res.status(200).json({
        success: true,
        role: "customer",
        data: {
          userId: customer._id,
          email: customer.email,
          firstName: customer.firstName,
          lastName: customer.lastName,
        },
      });
    }

    return res.status(404).json({ success: false, message: "User not found." });
  } catch (error) {
    console.error("Get User Details Error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error." });
  }
};

module.exports = {
  sendSellerOtp,
  registerSeller,
  loginSeller,
  logoutSeller,
  getProfile,
  updateProfile,
  dashboard,
  deactivateSeller,
  getUserDetailsByEmail,
};
