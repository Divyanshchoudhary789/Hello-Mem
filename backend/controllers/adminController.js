const bcrypt = require("bcryptjs");
const Customer = require("../models/customers");
const Seller = require("../models/sellersModel");
const Product = require("../models/productModel");
const Order = require("../models/order");
const Payment = require("../models/Payment");
const Review = require("../models/review");
const VendorPayment = require("../models/vendorPaymentModel");
const VendorCommission = require("../models/vendorCommissionModel");
const UploadHistory = require("../models/UploadHistory");
const Cart = require("../models/cart");
const cloudinary = require("../config/cloudinary");
const {
  generateAccessToken,
  generateRefreshToken,
  setTokenCookies,
  clearTokenCookies,
} = require("../utils/tokens");
const { createVendorPaymentsForOrder } = require("./vendorPaymentController");

// ── Admin credentials from environment ────────────────────────────────────────
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "admin@hellomaam.com").toLowerCase();
const ADMIN_PHONE = process.env.ADMIN_PHONE || "9876543210";

// Escape user input before using in $regex to prevent ReDoS
const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Pagination helper
const getPagination = (query) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 20));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

// ── Admin token helpers ────────────────────────────────────────────────────────
let _adminRefreshToken = null;
const getAdminRefreshToken = () => _adminRefreshToken;
const setAdminRefreshToken = (token) => { _adminRefreshToken = token; };
const clearAdminRefreshToken = () => { _adminRefreshToken = null; };

// ==========================================
// Authentication Controllers
// ==========================================

/**
 * POST /api/admin/login
 */
const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }
    const inputEmail = email.trim().toLowerCase();
    if (inputEmail !== ADMIN_EMAIL) {
      return res.status(401).json({ success: false, message: "Invalid credentials." });
    }
    const passwordHash = process.env.ADMIN_PASSWORD_HASH;
    if (!passwordHash) {
      console.error("ADMIN_PASSWORD_HASH is not set in environment.");
      return res.status(500).json({ success: false, message: "Server misconfiguration." });
    }
    const isPasswordValid = await bcrypt.compare(password, passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: "Invalid credentials." });
    }
    const adminPayload = { id: "admin", _id: "admin", role: "admin" };
    const accessToken = generateAccessToken(adminPayload);
    const refreshToken = generateRefreshToken(adminPayload);
    setAdminRefreshToken(refreshToken);
    setTokenCookies(res, accessToken, refreshToken);
    return res.status(200).json({
      success: true,
      message: "Admin login successful.",
      accessToken,
      user: { id: "admin", name: "System Admin", email: ADMIN_EMAIL, phone: ADMIN_PHONE, role: "admin" },
    });
  } catch (error) {
    console.error("Admin Login Error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error." });
  }
};

/**
 * POST /api/admin/logout
 */
const adminLogout = async (req, res) => {
  try {
    clearAdminRefreshToken();
    clearTokenCookies(res);
    return res.status(200).json({ success: true, message: "Logged out successfully." });
  } catch (error) {
    console.error("Admin Logout Error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error." });
  }
};

/**
 * GET /api/admin/profile
 */
const getAdminProfile = async (_req, res) => {
  try {
    res.status(200).json({
      success: true,
      admin: { id: "admin", name: "System Admin", email: ADMIN_EMAIL, phone: ADMIN_PHONE, role: "admin" },
    });
  } catch (error) {
    console.error("Get Admin Profile Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// ==========================================
// Dashboard Stats — rich analytics
// GET /api/admin/stats
// ==========================================
const getAdminDashboardStats = async (req, res) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    const startOf7DaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const startOf6MonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const [
      totalCustomers,
      newCustomersToday,
      newCustomersThisMonth,
      newCustomersLastMonth,
      totalSellers,
      pendingSellers,
      approvedSellers,
      rejectedSellers,
      totalProducts,
      activeProducts,
      outOfStockProducts,
      lowStockProducts,
      totalOrders,
      ordersToday,
      ordersThisMonth,
      orderStatusCounts,
      revenueAll,
      revenueThisMonth,
      revenueLastMonth,
      revenueToday,
      totalReviews,
      recentOrders,
      topSellingProducts,
      revenueLast7Days,
      paymentMethodBreakdown,
      totalVendorPaymentsPaid,
      pendingVendorPayments,
    ] = await Promise.all([
      // Customers
      Customer.countDocuments(),
      Customer.countDocuments({ createdAt: { $gte: startOfToday } }),
      Customer.countDocuments({ createdAt: { $gte: startOfMonth } }),
      Customer.countDocuments({ createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth } }),
      // Sellers
      Seller.countDocuments(),
      Seller.countDocuments({ verificationStatus: "Pending" }),
      Seller.countDocuments({ verificationStatus: "Approved" }),
      Seller.countDocuments({ verificationStatus: "Rejected" }),
      // Products
      Product.countDocuments(),
      Product.countDocuments({ isActive: true }),
      Product.countDocuments({ stockStatus: "Out of Stock" }),
      Product.countDocuments({ stock: { $gt: 0, $lte: 10 } }),
      // Orders
      Order.countDocuments(),
      Order.countDocuments({ createdAt: { $gte: startOfToday } }),
      Order.countDocuments({ createdAt: { $gte: startOfMonth } }),
      Order.aggregate([
        { $group: { _id: "$orderStatus", count: { $sum: 1 } } },
      ]),
      // Revenue — include both online-paid and COD confirmed orders
      // "paid"       = online payment verified OR COD cash collected
      // "cod_pending" = COD order confirmed, cash to be collected at delivery (committed revenue)
      Order.aggregate([
        { $match: { paymentStatus: { $in: ["paid", "cod_pending"] } } },
        { $group: { _id: null, total: { $sum: "$pricing.total" }, count: { $sum: 1 } } },
      ]),
      Order.aggregate([
        { $match: { paymentStatus: { $in: ["paid", "cod_pending"] }, createdAt: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: "$pricing.total" }, count: { $sum: 1 } } },
      ]),
      Order.aggregate([
        { $match: { paymentStatus: { $in: ["paid", "cod_pending"] }, createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth } } },
        { $group: { _id: null, total: { $sum: "$pricing.total" }, count: { $sum: 1 } } },
      ]),
      Order.aggregate([
        { $match: { paymentStatus: { $in: ["paid", "cod_pending"] }, createdAt: { $gte: startOfToday } } },
        { $group: { _id: null, total: { $sum: "$pricing.total" }, count: { $sum: 1 } } },
      ]),
      // Reviews
      Review.countDocuments(),
      // Recent 10 orders
      Order.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .select("orderNumber customer.name customer.email pricing.total orderStatus paymentStatus createdAt items")
        .lean(),
      // Top 5 selling products by order item quantity
      Order.aggregate([
        { $match: { paymentStatus: { $in: ["paid", "cod_pending"] } } },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.product",
            name: { $first: "$items.name" },
            image: { $first: "$items.image" },
            totalQuantitySold: { $sum: "$items.quantity" },
            totalRevenue: { $sum: "$items.subtotal" },
          },
        },
        { $sort: { totalQuantitySold: -1 } },
        { $limit: 5 },
      ]),
      // Revenue per day for last 7 days (paid + COD confirmed)
      Order.aggregate([
        { $match: { paymentStatus: { $in: ["paid", "cod_pending"] }, createdAt: { $gte: startOf7DaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            revenue: { $sum: "$pricing.total" },
            orders: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      // Payment method breakdown — include cod_collected + cod_pending for COD representation
      Payment.aggregate([
        { $match: { status: { $in: ["success", "cod_collected", "cod_pending"] } } },
        { $group: { _id: "$paymentMethod", count: { $sum: 1 }, total: { $sum: "$amount" } } },
        { $sort: { total: -1 } },
      ]),
      // Vendor payments paid
      VendorPayment.aggregate([
        { $match: { paymentStatus: "Paid" } },
        { $group: { _id: null, total: { $sum: "$netAmount" }, count: { $sum: 1 } } },
      ]),
      // Vendor payments pending
      VendorPayment.aggregate([
        { $match: { paymentStatus: "Pending" } },
        { $group: { _id: null, total: { $sum: "$netAmount" }, count: { $sum: 1 } } },
      ]),
    ]);

    // ── Additional chart queries (run after first batch) ───────────────────────
    const [
      revenueLast6Months,
      customerGrowthLast6Months,
      ordersByCategory,
      topSellersByRevenue,
      orderReturnStats,
      stockByCategory,
      vendorPaymentTrend,
    ] = await Promise.all([

      // Revenue + order count per month for last 6 months (Line/Bar chart)
      Order.aggregate([
        { $match: { paymentStatus: { $in: ["paid", "cod_pending"] }, createdAt: { $gte: startOf6MonthsAgo } } },
        {
          $group: {
            _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
            revenue: { $sum: "$pricing.total" },
            orders: { $sum: 1 },
            avgOrderValue: { $avg: "$pricing.total" },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
        {
          $project: {
            _id: 0,
            month: {
              $dateToString: {
                format: "%b %Y",
                date: { $dateFromParts: { year: "$_id.year", month: "$_id.month", day: 1 } },
              },
            },
            revenue: { $round: ["$revenue", 2] },
            orders: 1,
            avgOrderValue: { $round: ["$avgOrderValue", 2] },
          },
        },
      ]),

      // New customers per month last 6 months (Area/Bar chart)
      Customer.aggregate([
        { $match: { createdAt: { $gte: startOf6MonthsAgo } } },
        {
          $group: {
            _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
        {
          $project: {
            _id: 0,
            month: {
              $dateToString: {
                format: "%b %Y",
                date: { $dateFromParts: { year: "$_id.year", month: "$_id.month", day: 1 } },
              },
            },
            count: 1,
          },
        },
      ]),

      // Revenue breakdown by category (Pie/Donut chart)
      Order.aggregate([
        { $match: { paymentStatus: { $in: ["paid", "cod_pending"] } } },
        { $unwind: "$items" },
        {
          $lookup: {
            from: "products",
            localField: "items.product",
            foreignField: "_id",
            as: "productDoc",
          },
        },
        { $unwind: { path: "$productDoc", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "categories",
            localField: "productDoc.category",
            foreignField: "_id",
            as: "categoryDoc",
          },
        },
        { $unwind: { path: "$categoryDoc", preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: "$categoryDoc._id",
            name: { $first: { $ifNull: ["$categoryDoc.name", "Uncategorized"] } },
            revenue: { $sum: "$items.subtotal" },
            unitsSold: { $sum: "$items.quantity" },
            orderCount: { $sum: 1 },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 8 },
        {
          $project: {
            _id: 0,
            categoryId: "$_id",
            name: 1,
            revenue: { $round: ["$revenue", 2] },
            unitsSold: 1,
            orderCount: 1,
          },
        },
      ]),

      // Top 10 sellers by revenue (Horizontal Bar chart)
      Order.aggregate([
        { $match: { paymentStatus: { $in: ["paid", "cod_pending"] } } },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.seller",
            totalRevenue: { $sum: "$items.subtotal" },
            totalUnitsSold: { $sum: "$items.quantity" },
            orderCount: { $sum: 1 },
          },
        },
        {
          $lookup: {
            from: "sellers",
            localField: "_id",
            foreignField: "_id",
            as: "sellerDoc",
          },
        },
        { $unwind: { path: "$sellerDoc", preserveNullAndEmptyArrays: true } },
        { $sort: { totalRevenue: -1 } },
        { $limit: 10 },
        {
          $project: {
            _id: 0,
            sellerId: "$_id",
            name: {
              $ifNull: [
                "$sellerDoc.businessName",
                { $concat: [{ $ifNull: ["$sellerDoc.firstName", ""] }, " ", { $ifNull: ["$sellerDoc.lastName", ""] }] },
              ],
            },
            totalRevenue: { $round: ["$totalRevenue", 2] },
            totalUnitsSold: 1,
            orderCount: 1,
          },
        },
      ]),

      // Return & cancellation rate per month — last 6 months (Line chart)
      Order.aggregate([
        { $match: { createdAt: { $gte: startOf6MonthsAgo } } },
        {
          $group: {
            _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
            total: { $sum: 1 },
            returned: {
              $sum: { $cond: [{ $in: ["$orderStatus", ["RETURNED", "RETURN_REQUESTED"]] }, 1, 0] },
            },
            cancelled: {
              $sum: { $cond: [{ $eq: ["$orderStatus", "CANCELLED"] }, 1, 0] },
            },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
        {
          $project: {
            _id: 0,
            month: {
              $dateToString: {
                format: "%b %Y",
                date: { $dateFromParts: { year: "$_id.year", month: "$_id.month", day: 1 } },
              },
            },
            total: 1,
            returned: 1,
            cancelled: 1,
            returnRate: {
              $round: [
                { $multiply: [{ $divide: ["$returned", { $max: ["$total", 1] }] }, 100] }, 1,
              ],
            },
            cancellationRate: {
              $round: [
                { $multiply: [{ $divide: ["$cancelled", { $max: ["$total", 1] }] }, 100] }, 1,
              ],
            },
          },
        },
      ]),

      // Stock health by category (Stacked Bar chart)
      Product.aggregate([
        {
          $lookup: {
            from: "categories",
            localField: "category",
            foreignField: "_id",
            as: "categoryDoc",
          },
        },
        { $unwind: { path: "$categoryDoc", preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: "$categoryDoc._id",
            name: { $first: { $ifNull: ["$categoryDoc.name", "Uncategorized"] } },
            totalProducts: { $sum: 1 },
            inStock: { $sum: { $cond: [{ $gt: ["$stock", 10] }, 1, 0] } },
            lowStock: {
              $sum: { $cond: [{ $and: [{ $gt: ["$stock", 0] }, { $lte: ["$stock", 10] }] }, 1, 0] },
            },
            outOfStock: { $sum: { $cond: [{ $eq: ["$stock", 0] }, 1, 0] } },
          },
        },
        { $sort: { totalProducts: -1 } },
        { $limit: 8 },
        {
          $project: {
            _id: 0,
            categoryId: "$_id",
            name: 1,
            totalProducts: 1,
            inStock: 1,
            lowStock: 1,
            outOfStock: 1,
          },
        },
      ]),

      // Vendor payment disbursement per month — last 6 months (Bar chart)
      VendorPayment.aggregate([
        { $match: { paymentStatus: "Paid", createdAt: { $gte: startOf6MonthsAgo } } },
        {
          $group: {
            _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
            totalPaid: { $sum: "$netAmount" },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
        {
          $project: {
            _id: 0,
            month: {
              $dateToString: {
                format: "%b %Y",
                date: { $dateFromParts: { year: "$_id.year", month: "$_id.month", day: 1 } },
              },
            },
            totalPaid: { $round: ["$totalPaid", 2] },
            count: 1,
          },
        },
      ]),
    ]);

    // Shape order status into a flat map
    const orderStatusMap = {};
    orderStatusCounts.forEach(({ _id, count }) => { orderStatusMap[_id] = count; });

    // Revenue helpers
    const totalRevenue = revenueAll[0]?.total || 0;
    const paidOrdersCount = revenueAll[0]?.count || 0;
    const revenueThisMonthVal = revenueThisMonth[0]?.total || 0;
    const revenueLastMonthVal = revenueLastMonth[0]?.total || 0;
    const revenueTodayVal = revenueToday[0]?.total || 0;

    // Month-over-month revenue growth %
    const revenueGrowth = revenueLastMonthVal > 0
      ? (((revenueThisMonthVal - revenueLastMonthVal) / revenueLastMonthVal) * 100).toFixed(2)
      : revenueThisMonthVal > 0 ? 100 : 0;

    // Customer growth %
    const customerGrowth = newCustomersLastMonth > 0
      ? (((newCustomersThisMonth - newCustomersLastMonth) / newCustomersLastMonth) * 100).toFixed(2)
      : newCustomersThisMonth > 0 ? 100 : 0;

    res.status(200).json({
      success: true,
      stats: {
        // ── KPI Cards ──────────────────────────────────────────────────────────
        customers: {
          total: totalCustomers,
          newToday: newCustomersToday,
          newThisMonth: newCustomersThisMonth,
          newLastMonth: newCustomersLastMonth,
          growthPercent: parseFloat(customerGrowth),
        },
        sellers: {
          total: totalSellers,
          pending: pendingSellers,
          approved: approvedSellers,
          rejected: rejectedSellers,
        },
        products: {
          total: totalProducts,
          active: activeProducts,
          inactive: totalProducts - activeProducts,
          outOfStock: outOfStockProducts,
          lowStock: lowStockProducts,
        },
        orders: {
          total: totalOrders,
          today: ordersToday,
          thisMonth: ordersThisMonth,
          byStatus: {
            pending: orderStatusMap["PENDING"] || 0,
            confirmed: orderStatusMap["CONFIRMED"] || 0,
            processing: orderStatusMap["PROCESSING"] || 0,
            packed: orderStatusMap["PACKED"] || 0,
            shipped: orderStatusMap["SHIPPED"] || 0,
            outForDelivery: orderStatusMap["OUT_FOR_DELIVERY"] || 0,
            delivered: orderStatusMap["DELIVERED"] || 0,
            cancelled: orderStatusMap["CANCELLED"] || 0,
            returnRequested: orderStatusMap["RETURN_REQUESTED"] || 0,
            returned: orderStatusMap["RETURNED"] || 0,
          },
        },
        revenue: {
          total: totalRevenue,
          today: revenueTodayVal,
          thisMonth: revenueThisMonthVal,
          lastMonth: revenueLastMonthVal,
          growthPercent: parseFloat(revenueGrowth),
          paidOrdersCount,
          averageOrderValue: paidOrdersCount > 0
            ? parseFloat((totalRevenue / paidOrdersCount).toFixed(2))
            : 0,
        },
        reviews: {
          total: totalReviews,
        },
        vendorPayments: {
          paidAmount: totalVendorPaymentsPaid[0]?.total || 0,
          paidCount: totalVendorPaymentsPaid[0]?.count || 0,
          pendingAmount: pendingVendorPayments[0]?.total || 0,
          pendingCount: pendingVendorPayments[0]?.count || 0,
        },

        // ── Charts ────────────────────────────────────────────────────────────
        charts: {
          /**
           * LINE / BAR CHART — Revenue & Orders per day (last 7 days)
           * Use for: "This Week" mini trend line on revenue card
           * x-axis: date (YYYY-MM-DD)  |  series: revenue, orders
           */
          revenueLast7Days,

          /**
           * LINE / BAR CHART — Revenue, Orders & AOV per month (last 6 months)
           * Use for: Main revenue trend chart on dashboard
           * x-axis: month (e.g. "Jan 2025")  |  series: revenue, orders, avgOrderValue
           */
          revenueLast6Months,

          /**
           * AREA / BAR CHART — New customer registrations per month (last 6 months)
           * Use for: Customer growth chart
           * x-axis: month  |  series: count
           */
          customerGrowthLast6Months,

          /**
           * PIE / DONUT CHART — Payment method distribution
           * Use for: "How customers are paying" donut chart
           * segments: paymentMethod  |  value: count, total
           */
          paymentMethodBreakdown,

          /**
           * PIE / DONUT CHART — Revenue by product category
           * Use for: Category performance pie chart
           * segments: name  |  value: revenue, unitsSold
           */
          ordersByCategory,

          /**
           * DONUT CHART — Order status distribution
           * Use for: Order funnel / status pie chart
           * Direct from stats.orders.byStatus above — pre-shaped for charts:
           */
          orderStatusDistribution: Object.entries(orderStatusMap).map(([status, count]) => ({
            status,
            count,
          })),

          /**
           * HORIZONTAL BAR CHART — Top 10 sellers by revenue
           * Use for: Seller leaderboard bar chart
           * x-axis: totalRevenue  |  y-axis: seller name
           */
          topSellersByRevenue,

          /**
           * LINE CHART — Return rate & cancellation rate per month (last 6 months)
           * Use for: Returns trend chart, operations health
           * x-axis: month  |  series: returnRate (%), cancellationRate (%), returned, cancelled, total
           */
          orderReturnStats,

          /**
           * STACKED BAR CHART — Stock health per category
           * Use for: Inventory health chart
           * x-axis: category  |  series: inStock (green), lowStock (yellow), outOfStock (red)
           */
          stockByCategory,

          /**
           * BAR CHART — Vendor payment disbursements per month (last 6 months)
           * Use for: Payout trend chart on vendor finance section
           * x-axis: month  |  series: totalPaid, count
           */
          vendorPaymentTrend,
        },

        // ── Recent Activity ───────────────────────────────────────────────────
        recentOrders: recentOrders.map((o) => ({
          orderId: o._id,
          orderNumber: o.orderNumber,
          customer: o.customer,
          itemCount: o.items?.length || 0,
          total: o.pricing?.total || 0,
          orderStatus: o.orderStatus,
          paymentStatus: o.paymentStatus,
          createdAt: o.createdAt,
        })),

        /**
         * TABLE / BAR CHART — Top 5 products by units sold
         * columns: name, totalQuantitySold, totalRevenue, image
         */
        topSellingProducts,
      },
    });
  } catch (error) {
    console.error("Get Admin Dashboard Stats Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// ==========================================
// Dedicated Chart Analytics Endpoints
// ==========================================

/**
 * GET /api/admin/analytics/revenue
 * Query: period = "7d" | "30d" | "6m" | "12m"  (default: "6m")
 *
 * Returns revenue trend data — use for Line / Bar chart on revenue page.
 * Response shape:
 *   { success, period, data: [{ date|month, revenue, orders, avgOrderValue }] }
 */
const getRevenueAnalytics = async (req, res) => {
  try {
    const period = req.query.period || "6m";

    let startDate;
    let groupByDay = false;
    const now = new Date();

    if (period === "7d") {
      startDate = new Date(now - 7 * 24 * 60 * 60 * 1000);
      groupByDay = true;
    } else if (period === "30d") {
      startDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
      groupByDay = true;
    } else if (period === "12m") {
      startDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    } else {
      // default 6m
      startDate = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    }

    const groupStage = groupByDay
      ? { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }
      : {
          $dateToString: {
            format: "%b %Y",
            date: { $dateFromParts: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" }, day: 1 } },
          },
        };

    const data = await Order.aggregate([
      { $match: { paymentStatus: { $in: ["paid", "cod_pending"] }, createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: groupStage,
          revenue: { $sum: "$pricing.total" },
          orders: { $sum: 1 },
          avgOrderValue: { $avg: "$pricing.total" },
          discount: { $sum: "$pricing.discount" },
          tax: { $sum: "$pricing.tax" },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          date: "$_id",
          revenue: { $round: ["$revenue", 2] },
          orders: 1,
          avgOrderValue: { $round: ["$avgOrderValue", 2] },
          discount: { $round: ["$discount", 2] },
          tax: { $round: ["$tax", 2] },
        },
      },
    ]);

    res.status(200).json({ success: true, period, data });
  } catch (error) {
    console.error("Revenue Analytics Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

/**
 * GET /api/admin/analytics/orders
 * Query: period = "7d" | "30d" | "6m" | "12m"  (default: "6m")
 *
 * Returns order volume, status breakdown, return/cancel rates.
 * Response shape:
 *   { success, period, trend: [...], statusBreakdown: [...], funnelData: [...] }
 */
const getOrderAnalytics = async (req, res) => {
  try {
    const period = req.query.period || "6m";
    const now = new Date();
    let startDate;
    let groupByDay = false;

    if (period === "7d") {
      startDate = new Date(now - 7 * 24 * 60 * 60 * 1000);
      groupByDay = true;
    } else if (period === "30d") {
      startDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
      groupByDay = true;
    } else if (period === "12m") {
      startDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    }

    const dateLabel = groupByDay
      ? { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }
      : {
          $dateToString: {
            format: "%b %Y",
            date: { $dateFromParts: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" }, day: 1 } },
          },
        };

    const [trend, statusBreakdown] = await Promise.all([
      // Order volume trend
      Order.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: dateLabel,
            total: { $sum: 1 },
            delivered: { $sum: { $cond: [{ $eq: ["$orderStatus", "DELIVERED"] }, 1, 0] } },
            cancelled: { $sum: { $cond: [{ $eq: ["$orderStatus", "CANCELLED"] }, 1, 0] } },
            returned: {
              $sum: { $cond: [{ $in: ["$orderStatus", ["RETURNED", "RETURN_REQUESTED"]] }, 1, 0] },
            },
          },
        },
        { $sort: { _id: 1 } },
        {
          $project: {
            _id: 0,
            date: "$_id",
            total: 1,
            delivered: 1,
            cancelled: 1,
            returned: 1,
            successRate: {
              $round: [
                { $multiply: [{ $divide: ["$delivered", { $max: ["$total", 1] }] }, 100] }, 1,
              ],
            },
          },
        },
      ]),
      // Overall status breakdown (for pie/donut chart — all time)
      Order.aggregate([
        { $group: { _id: "$orderStatus", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $project: { _id: 0, status: "$_id", count: 1 } },
      ]),
    ]);

    // Funnel data: pipeline stages in order
    const FUNNEL_STAGES = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED"];
    const statusMap = {};
    statusBreakdown.forEach(({ status, count }) => { statusMap[status] = count; });
    const funnelData = FUNNEL_STAGES.map((stage) => ({
      stage,
      count: statusMap[stage] || 0,
    }));

    res.status(200).json({ success: true, period, trend, statusBreakdown, funnelData });
  } catch (error) {
    console.error("Order Analytics Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

/**
 * GET /api/admin/analytics/customers
 * Query: period = "6m" | "12m"  (default: "6m")
 *
 * Returns new vs returning customers trend and cohort summary.
 * Response shape:
 *   { success, period, trend: [...], summary: { newCustomers, returningCustomers, repeatRate } }
 */
const getCustomerAnalytics = async (req, res) => {
  try {
    const period = req.query.period || "6m";
    const now = new Date();
    const startDate = period === "12m"
      ? new Date(now.getFullYear() - 1, now.getMonth(), 1)
      : new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const [registrationTrend, orderCohort, totalCustomers] = await Promise.all([
      // New registrations per month
      Customer.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
            newCustomers: { $sum: 1 },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
        {
          $project: {
            _id: 0,
            month: {
              $dateToString: {
                format: "%b %Y",
                date: { $dateFromParts: { year: "$_id.year", month: "$_id.month", day: 1 } },
              },
            },
            newCustomers: 1,
          },
        },
      ]),
      // Customers segmented by order count — new (1 order) vs returning (2+ orders)
      Order.aggregate([
        { $group: { _id: "$customer.customerId", orderCount: { $sum: 1 } } },
        {
          $group: {
            _id: null,
            newCustomers: { $sum: { $cond: [{ $eq: ["$orderCount", 1] }, 1, 0] } },
            returningCustomers: { $sum: { $cond: [{ $gte: ["$orderCount", 2] }, 1, 0] } },
            totalWithOrders: { $sum: 1 },
          },
        },
      ]),
      Customer.countDocuments(),
    ]);

    const cohort = orderCohort[0] || { newCustomers: 0, returningCustomers: 0, totalWithOrders: 0 };
    const repeatRate = cohort.totalWithOrders > 0
      ? parseFloat(((cohort.returningCustomers / cohort.totalWithOrders) * 100).toFixed(1))
      : 0;

    res.status(200).json({
      success: true,
      period,
      trend: registrationTrend,
      summary: {
        totalCustomers,
        customersWithOrders: cohort.totalWithOrders,
        newCustomers: cohort.newCustomers,
        returningCustomers: cohort.returningCustomers,
        repeatRate,
      },
    });
  } catch (error) {
    console.error("Customer Analytics Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

/**
 * GET /api/admin/analytics/products
 * Query: limit (default: 10), sortBy = "revenue" | "quantity" | "orders"
 *
 * Returns top products and category performance.
 * Response shape:
 *   { success, topProducts: [...], categoryBreakdown: [...], stockHealth: {...} }
 */
const getProductAnalytics = async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const sortField = ["revenue", "quantity", "orders"].includes(req.query.sortBy)
      ? req.query.sortBy
      : "revenue";
    const sortKey = sortField === "revenue" ? "totalRevenue"
      : sortField === "quantity" ? "totalQuantitySold"
      : "orderCount";

    const [topProducts, categoryBreakdown, stockSummary] = await Promise.all([
      // Top products
      Order.aggregate([
        { $match: { paymentStatus: { $in: ["paid", "cod_pending"] } } },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.product",
            name: { $first: "$items.name" },
            sku: { $first: "$items.sku" },
            image: { $first: "$items.image" },
            totalRevenue: { $sum: "$items.subtotal" },
            totalQuantitySold: { $sum: "$items.quantity" },
            orderCount: { $sum: 1 },
            avgPrice: { $avg: "$items.price" },
          },
        },
        { $sort: { [sortKey]: -1 } },
        { $limit: limit },
        {
          $lookup: {
            from: "products",
            localField: "_id",
            foreignField: "_id",
            as: "productDoc",
          },
        },
        { $unwind: { path: "$productDoc", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 0,
            productId: "$_id",
            name: 1,
            sku: 1,
            image: 1,
            totalRevenue: { $round: ["$totalRevenue", 2] },
            totalQuantitySold: 1,
            orderCount: 1,
            avgPrice: { $round: ["$avgPrice", 2] },
            currentStock: { $ifNull: ["$productDoc.stock", 0] },
            isActive: { $ifNull: ["$productDoc.isActive", false] },
          },
        },
      ]),
      // Category revenue breakdown
      Order.aggregate([
        { $match: { paymentStatus: { $in: ["paid", "cod_pending"] } } },
        { $unwind: "$items" },
        {
          $lookup: {
            from: "products",
            localField: "items.product",
            foreignField: "_id",
            as: "productDoc",
          },
        },
        { $unwind: { path: "$productDoc", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "categories",
            localField: "productDoc.category",
            foreignField: "_id",
            as: "categoryDoc",
          },
        },
        { $unwind: { path: "$categoryDoc", preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: "$categoryDoc._id",
            name: { $first: { $ifNull: ["$categoryDoc.name", "Uncategorized"] } },
            revenue: { $sum: "$items.subtotal" },
            unitsSold: { $sum: "$items.quantity" },
            productCount: { $addToSet: "$items.product" },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 10 },
        {
          $project: {
            _id: 0,
            categoryId: "$_id",
            name: 1,
            revenue: { $round: ["$revenue", 2] },
            unitsSold: 1,
            uniqueProducts: { $size: "$productCount" },
          },
        },
      ]),
      // Stock health summary
      Product.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            inStock: { $sum: { $cond: [{ $gt: ["$stock", 10] }, 1, 0] } },
            lowStock: { $sum: { $cond: [{ $and: [{ $gt: ["$stock", 0] }, { $lte: ["$stock", 10] }] }, 1, 0] } },
            outOfStock: { $sum: { $cond: [{ $eq: ["$stock", 0] }, 1, 0] } },
            totalStockValue: { $sum: { $multiply: ["$stock", "$costPrice"] } },
          },
        },
        { $project: { _id: 0, total: 1, inStock: 1, lowStock: 1, outOfStock: 1, totalStockValue: { $round: ["$totalStockValue", 2] } } },
      ]),
    ]);

    res.status(200).json({
      success: true,
      sortBy: sortField,
      topProducts,
      categoryBreakdown,
      stockHealth: stockSummary[0] || { total: 0, inStock: 0, lowStock: 0, outOfStock: 0, totalStockValue: 0 },
    });
  } catch (error) {
    console.error("Product Analytics Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

/**
 * GET /api/admin/analytics/sellers
 * Query: limit (default: 10)
 *
 * Returns seller performance data for leaderboard and comparison charts.
 * Response shape:
 *   { success, topSellers: [...], verificationBreakdown: [...] }
 */
const getSellerAnalytics = async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));

    const [topSellers, verificationBreakdown, sellerGrowthTrend] = await Promise.all([
      // Top sellers by revenue with enriched data
      Order.aggregate([
        { $match: { paymentStatus: { $in: ["paid", "cod_pending"] } } },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.seller",
            totalRevenue: { $sum: "$items.subtotal" },
            totalUnitsSold: { $sum: "$items.quantity" },
            orderCount: { $sum: 1 },
            uniqueProducts: { $addToSet: "$items.product" },
          },
        },
        {
          $lookup: {
            from: "sellers",
            localField: "_id",
            foreignField: "_id",
            as: "sellerDoc",
          },
        },
        { $unwind: { path: "$sellerDoc", preserveNullAndEmptyArrays: true } },
        { $sort: { totalRevenue: -1 } },
        { $limit: limit },
        {
          $project: {
            _id: 0,
            sellerId: "$_id",
            name: {
              $ifNull: [
                "$sellerDoc.businessName",
                { $concat: [{ $ifNull: ["$sellerDoc.firstName", ""] }, " ", { $ifNull: ["$sellerDoc.lastName", ""] }] },
              ],
            },
            email: "$sellerDoc.email",
            verificationStatus: "$sellerDoc.verificationStatus",
            isActive: "$sellerDoc.isActive",
            totalRevenue: { $round: ["$totalRevenue", 2] },
            totalUnitsSold: 1,
            orderCount: 1,
            uniqueProductCount: { $size: "$uniqueProducts" },
          },
        },
      ]),
      // Seller verification status breakdown (Pie chart)
      Seller.aggregate([
        { $group: { _id: "$verificationStatus", count: { $sum: 1 } } },
        { $project: { _id: 0, status: "$_id", count: 1 } },
      ]),
      // New seller registrations per month — last 6 months
      Seller.aggregate([
        { $match: { createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth() - 5, 1) } } },
        {
          $group: {
            _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
        {
          $project: {
            _id: 0,
            month: {
              $dateToString: {
                format: "%b %Y",
                date: { $dateFromParts: { year: "$_id.year", month: "$_id.month", day: 1 } },
              },
            },
            count: 1,
          },
        },
      ]),
    ]);

    res.status(200).json({ success: true, topSellers, verificationBreakdown, sellerGrowthTrend });
  } catch (error) {
    console.error("Seller Analytics Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// ==========================================
// Customer Management Controllers
// ==========================================

/**
 * GET /api/admin/customers
 * Query: search, isActive, page, limit
 */
const getAllCustomers = async (req, res) => {
  try {
    const { search, isActive } = req.query;
    const { page, limit, skip } = getPagination(req.query);
    const query = {};

    if (isActive !== undefined) query.isActive = isActive === "true";

    if (search) {
      const s = escapeRegex(search);
      query.$or = [
        { firstName: { $regex: s, $options: "i" } },
        { lastName: { $regex: s, $options: "i" } },
        { email: { $regex: s, $options: "i" } },
        { mobileNumber: { $regex: s, $options: "i" } },
      ];
    }

    const [customers, total] = await Promise.all([
      Customer.find(query)
        .select("-password -refreshToken")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Customer.countDocuments(query),
    ]);

    // Attach order count per customer
    const customerIds = customers.map((c) => c._id);
    const orderCounts = await Order.aggregate([
      { $match: { "customer.customerId": { $in: customerIds } } },
      { $group: { _id: "$customer.customerId", orderCount: { $sum: 1 }, totalSpent: { $sum: "$pricing.total" } } },
    ]);
    const orderCountMap = {};
    orderCounts.forEach(({ _id, orderCount, totalSpent }) => {
      orderCountMap[String(_id)] = { orderCount, totalSpent };
    });

    const enriched = customers.map((c) => ({
      ...c,
      orderCount: orderCountMap[String(c._id)]?.orderCount || 0,
      totalSpent: orderCountMap[String(c._id)]?.totalSpent || 0,
    }));

    res.status(200).json({
      success: true,
      count: enriched.length,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      customers: enriched,
    });
  } catch (error) {
    console.error("Get All Customers Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

const toggleCustomerStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found." });
    }
    customer.isActive = req.body.isActive !== undefined ? req.body.isActive : !customer.isActive;
    await customer.save();
    res.status(200).json({
      success: true,
      message: `Customer status updated to ${customer.isActive ? "Active" : "Inactive"}.`,
      customer,
    });
  } catch (error) {
    console.error("Toggle Customer Status Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

const deleteCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const customer = await Customer.findByIdAndDelete(id);
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found." });
    }
    res.status(200).json({ success: true, message: "Customer deleted successfully." });
  } catch (error) {
    console.error("Delete Customer Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// ==========================================
// Seller Management Controllers
// ==========================================

/**
 * GET /api/admin/sellers
 * Query: status, isActive, search, page, limit
 */
const getAllSellers = async (req, res) => {
  try {
    const { status, isActive, search } = req.query;
    const { page, limit, skip } = getPagination(req.query);
    const query = {};

    if (status) query.verificationStatus = status;
    if (isActive !== undefined) query.isActive = isActive === "true";

    if (search) {
      const s = escapeRegex(search);
      query.$or = [
        { firstName: { $regex: s, $options: "i" } },
        { lastName: { $regex: s, $options: "i" } },
        { email: { $regex: s, $options: "i" } },
        { businessName: { $regex: s, $options: "i" } },
        { phone: { $regex: s, $options: "i" } },
      ];
    }

    const [sellers, total] = await Promise.all([
      Seller.find(query)
        .select("-refreshToken")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Seller.countDocuments(query),
    ]);

    // Attach product count and total sales per seller
    const sellerIds = sellers.map((s) => s._id);
    const [productCounts, sellerOrderStats] = await Promise.all([
      Product.aggregate([
        { $match: { seller: { $in: sellerIds } } },
        { $group: { _id: "$seller", productCount: { $sum: 1 }, activeProducts: { $sum: { $cond: ["$isActive", 1, 0] } } } },
      ]),
      Order.aggregate([
        { $match: { paymentStatus: { $in: ["paid", "cod_pending"] } } },
        { $unwind: "$items" },
        { $match: { "items.seller": { $in: sellerIds } } },
        { $group: { _id: "$items.seller", totalRevenue: { $sum: "$items.subtotal" }, orderCount: { $sum: 1 } } },
      ]),
    ]);

    const productCountMap = {};
    productCounts.forEach(({ _id, productCount, activeProducts }) => {
      productCountMap[String(_id)] = { productCount, activeProducts };
    });
    const sellerOrderMap = {};
    sellerOrderStats.forEach(({ _id, totalRevenue, orderCount }) => {
      sellerOrderMap[String(_id)] = { totalRevenue, orderCount };
    });

    const enriched = sellers.map((s) => ({
      ...s,
      productCount: productCountMap[String(s._id)]?.productCount || 0,
      activeProducts: productCountMap[String(s._id)]?.activeProducts || 0,
      totalRevenue: sellerOrderMap[String(s._id)]?.totalRevenue || 0,
      orderCount: sellerOrderMap[String(s._id)]?.orderCount || 0,
    }));

    res.status(200).json({
      success: true,
      count: enriched.length,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      sellers: enriched,
    });
  } catch (error) {
    console.error("Get All Sellers Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

const updateSellerStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { verificationStatus, isActive } = req.body;
    const seller = await Seller.findById(id);
    if (!seller) {
      return res.status(404).json({ success: false, message: "Seller not found." });
    }
    if (verificationStatus) {
      if (!["Pending", "Approved", "Rejected"].includes(verificationStatus)) {
        return res.status(400).json({ success: false, message: "Invalid verification status." });
      }
      seller.verificationStatus = verificationStatus;
      seller.isVerified = verificationStatus === "Approved";
    }
    if (isActive !== undefined) seller.isActive = isActive;
    await seller.save();
    res.status(200).json({ success: true, message: "Seller status updated successfully.", seller });
  } catch (error) {
    console.error("Update Seller Status Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

const deleteSeller = async (req, res) => {
  try {
    const { id } = req.params;

    const seller = await Seller.findById(id);
    if (!seller) {
      return res.status(404).json({ success: false, message: "Seller not found." });
    }

    // ── Step 1: Collect all products belonging to this seller ─────────────────
    const products = await Product.find({ seller: id }).select("_id images thumbnail");

    const productIds = products.map((p) => p._id);

    // ── Step 2: Delete all Cloudinary images for every product ────────────────
    const cloudinaryDeletions = [];

    for (const product of products) {
      // Product images array
      if (Array.isArray(product.images)) {
        for (const img of product.images) {
          if (img.public_id) {
            cloudinaryDeletions.push(
              cloudinary.uploader.destroy(img.public_id).catch((err) =>
                console.error(`[DeleteSeller] Failed to delete product image ${img.public_id}:`, err.message)
              )
            );
          }
        }
      }
      // Product thumbnail
      if (product.thumbnail?.public_id) {
        cloudinaryDeletions.push(
          cloudinary.uploader.destroy(product.thumbnail.public_id).catch((err) =>
            console.error(`[DeleteSeller] Failed to delete thumbnail ${product.thumbnail.public_id}:`, err.message)
          )
        );
      }
    }

    // Seller logo and banner from Cloudinary
    if (seller.logo?.public_id) {
      cloudinaryDeletions.push(
        cloudinary.uploader.destroy(seller.logo.public_id).catch((err) =>
          console.error(`[DeleteSeller] Failed to delete seller logo:`, err.message)
        )
      );
    }
    if (seller.banner?.public_id) {
      cloudinaryDeletions.push(
        cloudinary.uploader.destroy(seller.banner.public_id).catch((err) =>
          console.error(`[DeleteSeller] Failed to delete seller banner:`, err.message)
        )
      );
    }

    // Fire all Cloudinary deletions in parallel — don't block on failures
    await Promise.allSettled(cloudinaryDeletions);

    // ── Step 3: Delete all Reviews for this seller's products ─────────────────
    if (productIds.length > 0) {
      await Review.deleteMany({ product: { $in: productIds } });
    }

    // ── Step 4: Remove seller's products from any customer carts ─────────────
    if (productIds.length > 0) {
      await Cart.updateMany(
        { "items.product": { $in: productIds } },
        { $pull: { items: { product: { $in: productIds } } } }
      );
    }

    // ── Step 5: Delete all Products ───────────────────────────────────────────
    if (productIds.length > 0) {
      await Product.deleteMany({ seller: id });
    }

    // ── Step 6: Delete VendorCommissions ──────────────────────────────────────
    await VendorCommission.deleteMany({ seller: id });

    // ── Step 7: Delete VendorPayments ─────────────────────────────────────────
    // These are financial records. We delete them since the seller account is gone.
    // Orders themselves are NOT deleted — they are customer financial records.
    await VendorPayment.deleteMany({ seller: id });

    // ── Step 8: Delete Bulk Upload History ────────────────────────────────────
    await UploadHistory.deleteMany({ seller: id });

    // ── Step 9: Finally delete the Seller document ────────────────────────────
    await Seller.findByIdAndDelete(id);

    console.log(
      `[Admin] Seller ${seller.businessName} (${id}) deleted. ` +
      `Products: ${productIds.length}, Cloudinary assets: ${cloudinaryDeletions.length}`
    );

    res.status(200).json({
      success: true,
      message: "Seller and all associated data deleted successfully.",
      deleted: {
        seller: seller.businessName,
        productsDeleted: productIds.length,
      },
    });
  } catch (error) {
    console.error("Delete Seller Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// ==========================================
// Product Management Controllers
// ==========================================

/**
 * GET /api/admin/products
 * Query: search, isActive, categoryId, sellerId, stockStatus, page, limit
 */
const getAllProductsAdmin = async (req, res) => {
  try {
    const { search, isActive, categoryId, sellerId, stockStatus } = req.query;
    const { page, limit, skip } = getPagination(req.query);
    const query = {};

    if (isActive !== undefined) query.isActive = isActive === "true";
    if (categoryId) query.category = categoryId;
    if (sellerId) query.seller = sellerId;
    if (stockStatus) query.stockStatus = stockStatus;

    if (search) {
      const s = escapeRegex(search);
      query.$or = [
        { name: { $regex: s, $options: "i" } },
        { brand: { $regex: s, $options: "i" } },
        { sku: { $regex: s, $options: "i" } },
      ];
    }

    const [products, total] = await Promise.all([
      Product.find(query)
        .populate("seller", "firstName lastName businessName email phone isVerified")
        .populate("category", "name slug")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      count: products.length,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      products,
    });
  } catch (error) {
    console.error("Get All Products Admin Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

const updateProductStatusAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found." });
    }
    product.isActive = req.body.isActive !== undefined ? req.body.isActive : !product.isActive;
    await product.save();
    res.status(200).json({
      success: true,
      message: `Product status updated to ${product.isActive ? "Active" : "Inactive"}.`,
      product,
    });
  } catch (error) {
    console.error("Update Product Status Admin Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

const deleteProductAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findByIdAndDelete(id);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found." });
    }
    res.status(200).json({ success: true, message: "Product deleted successfully." });
  } catch (error) {
    console.error("Delete Product Admin Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// ==========================================
// Order Management Controllers
// ==========================================

/**
 * GET /api/admin/orders
 * Query: status, paymentStatus, search, startDate, endDate, page, limit
 */
const getAllOrdersAdmin = async (req, res) => {
  try {
    const { status, paymentStatus, search, startDate, endDate } = req.query;
    const { page, limit, skip } = getPagination(req.query);
    const query = {};

    if (status) query.orderStatus = status;
    if (paymentStatus) query.paymentStatus = paymentStatus;

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    if (search) {
      const s = escapeRegex(search);
      query.$or = [
        { orderNumber: { $regex: s, $options: "i" } },
        { "customer.name": { $regex: s, $options: "i" } },
        { "customer.email": { $regex: s, $options: "i" } },
        { "customer.phone": { $regex: s, $options: "i" } },
      ];
    }

    const [orders, total] = await Promise.all([
      Order.find(query)
        .populate("customer.customerId", "firstName lastName email mobileNumber isActive")
        .populate("items.product", "name sku thumbnail")
        .populate("items.seller", "businessName firstName lastName email phone")
        .populate("payment", "paymentMethod transactionId razorpayPaymentId paidAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Order.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      count: orders.length,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      orders,
    });
  } catch (error) {
    console.error("Get All Orders Admin Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

/**
 * GET /api/admin/orders/:id
 * Single order full detail
 */
const getOrderDetailAdmin = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("customer.customerId", "firstName lastName email mobileNumber address isActive createdAt")
      .populate("items.product", "name sku slug thumbnail images price discountPrice brand")
      .populate("items.seller", "businessName firstName lastName email phone address logo")
      .populate("payment")
      .lean();

    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }

    res.status(200).json({ success: true, order });
  } catch (error) {
    console.error("Get Order Detail Admin Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

/**
 * PATCH /api/admin/orders/:id/status
 * Body: { orderStatus }
 *
 * COD special handling:
 *   - DELIVERED  : paymentStatus stays "cod_pending" (cash not yet collected).
 *                  Admin must separately call PATCH /api/payments/cod/collect to confirm cash.
 *   - CANCELLED (COD, cod_pending): paymentStatus → "pending" (no cash taken, no refund needed).
 *   - RETURN_APPROVED / RETURNED (COD, paid): paymentStatus → "cod_refund_pending" (cash was taken, refund required).
 */
const updateOrderStatusAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { orderStatus } = req.body;

    const validStatuses = [
      "PENDING", "CONFIRMED", "PROCESSING", "PACKED",
      "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED",
      "CANCELLED", "RETURN_REQUESTED", "RETURN_APPROVED",
      "RETURN_REJECTED", "RETURNED",
    ];

    if (!orderStatus || !validStatuses.includes(orderStatus)) {
      return res.status(400).json({ success: false, message: "Invalid order status." });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }

    const updateFields = { orderStatus };

    // Set shipping timestamps when admin advances status
    if (orderStatus === "SHIPPED") updateFields["shipping.shippedAt"] = new Date();
    if (orderStatus === "DELIVERED") updateFields["shipping.deliveredAt"] = new Date();

    // ── COD-specific paymentStatus transitions ─────────────────────────────
    const isCOD = order.paymentMethod === "COD";

    if (isCOD) {
      if (orderStatus === "CANCELLED" && order.paymentStatus === "cod_pending") {
        // Cancelled before delivery — no cash was collected, so no refund needed.
        // Reset paymentStatus to plain "pending" to keep things clean.
        updateFields.paymentStatus = "pending";

        // Update the linked Payment record to cancelled
        await Payment.findOneAndUpdate(
          { order: order._id, paymentMethod: "cod" },
          { status: "cancelled" }
        );

        // Restore stock since order is being cancelled
        for (const item of order.items) {
          await Product.findByIdAndUpdate(item.product, {
            $inc: { stock: item.quantity },
          });
        }
      } else if (
        (orderStatus === "RETURN_APPROVED" || orderStatus === "RETURNED") &&
        order.paymentStatus === "paid"
      ) {
        // Cash was already collected — flag for manual refund processing.
        updateFields.paymentStatus = "cod_refund_pending";

        await Payment.findOneAndUpdate(
          { order: order._id, paymentMethod: "cod" },
          { status: "cod_refund_pending", codRefundReason: "Admin initiated return" }
        );
      }
    }
    // ── End COD handling ──────────────────────────────────────────────────

    const updatedOrder = await Order.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    // Auto-create vendor payment records when admin marks an order as DELIVERED.
    // Works for both online-paid and COD orders (vendorPayments are created now;
    // the admin confirms COD cash collection separately via /api/payments/cod/collect).
    if (orderStatus === "DELIVERED") {
      try {
        await createVendorPaymentsForOrder(updatedOrder._id);
      } catch (vpErr) {
        console.error(`[VendorPayment] Auto-creation failed for order ${updatedOrder.orderNumber}:`, vpErr.message);
      }
    }

    res.status(200).json({ success: true, message: "Order status updated.", order: updatedOrder });
  } catch (error) {
    console.error("Update Order Status Admin Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};



const updateCustomerAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const customer = await Customer.findById(id);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found.",
      });
    }

    const { firstName, lastName, email, mobileNumber, address, isActive } = req.body;

    // Check unique email conflict
    if (email && email.toLowerCase() !== (customer.email || "").toLowerCase()) {
      const existingEmail = await Customer.findOne({
        email: email.toLowerCase(),
        _id: { $ne: id },
      });
      if (existingEmail) {
        return res.status(400).json({
          success: false,
          message: "Email is already in use by another customer.",
        });
      }
      customer.email = email.toLowerCase().trim();
    }

    // Check unique mobileNumber conflict
    if (mobileNumber && mobileNumber.trim() !== customer.mobileNumber) {
      const existingPhone = await Customer.findOne({
        mobileNumber: mobileNumber.trim(),
        _id: { $ne: id },
      });
      if (existingPhone) {
        return res.status(400).json({
          success: false,
          message: "Mobile number is already in use by another customer.",
        });
      }
      customer.mobileNumber = mobileNumber.trim();
    }

    if (firstName !== undefined) customer.firstName = firstName.trim();
    if (lastName !== undefined) customer.lastName = lastName.trim();
    if (isActive !== undefined) customer.isActive = isActive;

    if (address && typeof address === "object") {
      customer.address = {
        ...customer.address,
        ...address,
      };
    }

    await customer.save();

    const updatedCustomer = await Customer.findById(id).select("-password -refreshToken");

    res.status(200).json({
      success: true,
      message: "Customer details updated successfully.",
      customer: updatedCustomer,
    });
  } catch (error) {
    console.error("Update Customer Admin Error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};


const updateSellerAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const seller = await Seller.findById(id);

    if (!seller) {
      return res.status(404).json({
        success: false,
        message: "Seller not found.",
      });
    }

    const {
      firstName,
      lastName,
      email,
      phone,
      businessName,
      businessType,
      gstNumber,
      panNumber,
      address,
      bankDetails,
      verificationStatus,
      isActive,
    } = req.body;

    // Check unique email conflict
    if (email && email.toLowerCase() !== seller.email.toLowerCase()) {
      const existingEmail = await Seller.findOne({
        email: email.toLowerCase(),
        _id: { $ne: id },
      });
      if (existingEmail) {
        return res.status(400).json({
          success: false,
          message: "Email is already registered with another seller.",
        });
      }
      seller.email = email.toLowerCase().trim();
    }

    // Check unique phone conflict
    if (phone && phone.trim() !== seller.phone) {
      const existingPhone = await Seller.findOne({
        phone: phone.trim(),
        _id: { $ne: id },
      });
      if (existingPhone) {
        return res.status(400).json({
          success: false,
          message: "Phone number is already registered with another seller.",
        });
      }
      seller.phone = phone.trim();
    }

    if (firstName !== undefined) seller.firstName = firstName.trim();
    if (lastName !== undefined) seller.lastName = lastName.trim();
    if (businessName !== undefined) seller.businessName = businessName.trim();
    if (businessType !== undefined) seller.businessType = businessType;
    if (gstNumber !== undefined) seller.gstNumber = gstNumber.trim();
    if (panNumber !== undefined) seller.panNumber = panNumber.trim();
    if (isActive !== undefined) seller.isActive = isActive;

    if (verificationStatus) {
      if (!["Pending", "Approved", "Rejected"].includes(verificationStatus)) {
        return res.status(400).json({
          success: false,
          message: "Invalid verification status. Must be Pending, Approved, or Rejected.",
        });
      }
      seller.verificationStatus = verificationStatus;
      seller.isVerified = verificationStatus === "Approved";
    }

    if (address && typeof address === "object") {
      seller.address = {
        ...seller.address,
        ...address,
      };
    }

    if (bankDetails && typeof bankDetails === "object") {
      seller.bankDetails = {
        ...seller.bankDetails,
        ...bankDetails,
      };
    }

    await seller.save();

    const updatedSeller = await Seller.findById(id).select("-refreshToken");

    res.status(200).json({
      success: true,
      message: "Seller details updated successfully.",
      seller: updatedSeller,
    });
  } catch (error) {
    console.error("Update Seller Admin Error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};


const getSellerDetailsAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    const seller = await Seller.findById(id).select("-refreshToken");

    if (!seller) {
      return res.status(404).json({
        success: false,
        message: "Seller not found.",
      });
    }

    const mongoose = require("mongoose");
    const sellerObjectId = new mongoose.Types.ObjectId(id);

    // Fetch seller's products & stats in parallel
    const [products, totalProducts, orderStats, recentOrders] = await Promise.all([
      Product.find({ seller: id }).populate("category", "name").sort({ createdAt: -1 }),
      Product.countDocuments({ seller: id }),
      Order.aggregate([
        { $unwind: "$items" },
        { $match: { "items.seller": sellerObjectId } },
        {
          $group: {
            _id: null,
            totalOrdersSet: { $addToSet: "$_id" },
            totalItemsSold: { $sum: "$items.quantity" },
            totalRevenue: {
              $sum: {
                $cond: [
                  { $in: ["$paymentStatus", ["paid", "cod_pending"]] },
                  "$items.subtotal",
                  0,
                ],
              },
            },
            pendingOrdersCount: {
              $sum: {
                $cond: [{ $eq: ["$orderStatus", "PENDING"] }, 1, 0],
              },
            },
          },
        },
      ]),
      Order.find({ "items.seller": id })
        .populate("customer.customerId", "firstName lastName email")
        .sort({ createdAt: -1 })
        .limit(10),
    ]);

    const stats = {
      totalProducts,
      totalOrders: orderStats.length > 0 ? orderStats[0].totalOrdersSet.length : 0,
      totalItemsSold: orderStats.length > 0 ? orderStats[0].totalItemsSold : 0,
      totalRevenue: orderStats.length > 0 ? orderStats[0].totalRevenue : 0,
      pendingOrdersCount: orderStats.length > 0 ? orderStats[0].pendingOrdersCount : 0,
    };

    res.status(200).json({
      success: true,
      seller,
      stats,
      products,
      recentOrders,
    });
  } catch (error) {
    console.error("Get Seller Details Admin Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};



const updateProductAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found.",
      });
    }

    const updateData = { ...req.body };

    // Handle JSON object strings if sent as multipart form-data
    if (updateData.specifications && typeof updateData.specifications === "string") {
      try { updateData.specifications = JSON.parse(updateData.specifications); } catch (e) {}
    }
    if (updateData.tags && typeof updateData.tags === "string") {
      try { updateData.tags = JSON.parse(updateData.tags); } catch (e) {}
    }
    if (updateData.shipping && typeof updateData.shipping === "string") {
      try { updateData.shipping = JSON.parse(updateData.shipping); } catch (e) {}
    }
    if (updateData.variants && typeof updateData.variants === "string") {
      try { updateData.variants = JSON.parse(updateData.variants); } catch (e) {}
    }
    if (updateData.seo && typeof updateData.seo === "string") {
      try { updateData.seo = JSON.parse(updateData.seo); } catch (e) {}
    }

    // Slug update if name changes
    if (updateData.name && updateData.name !== product.name) {
      updateData.slug = slugify(updateData.name, { lower: true });
    }

    // Duplicate SKU check
    if (updateData.sku && updateData.sku !== product.sku) {
      const existingSku = await Product.findOne({
        sku: updateData.sku,
        _id: { $ne: id },
      });

      if (existingSku) {
        return res.status(400).json({
          success: false,
          message: "SKU already exists.",
        });
      }
    }

    // Normalize images array if sent in req.body
    if (updateData.images) {
      let rawImages = updateData.images;
      if (typeof rawImages === "string") {
        try {
          rawImages = JSON.parse(rawImages);
        } catch (e) {
          rawImages = [rawImages];
        }
      }

      if (Array.isArray(rawImages)) {
        updateData.images = rawImages.map((img) => {
          if (typeof img === "string") {
            return { url: img, public_id: "" };
          }
          if (img && typeof img === "object") {
            return { url: img.url || "", public_id: img.public_id || "" };
          }
          return { url: "", public_id: "" };
        });

        if (updateData.images.length > 0) {
          updateData.thumbnail = updateData.images[0];
        }
      }
    }

    // Handle Uploading New Images via Cloudinary
    if (req.files && req.files.length > 0) {
      const newImages = [];
      for (const file of req.files) {
        const result = await uploadToCloudinary(file.buffer);
        newImages.push({ url: result.secure_url, public_id: result.public_id });
      }

      // Append or replace based on replaceImages flag
      if (req.body.replaceImages === "true" || req.body.replaceImages === true) {
        updateData.images = newImages;
        updateData.thumbnail = newImages[0];
      } else {
        updateData.images = [...(updateData.images || product.images || []), ...newImages];
        if (!product.thumbnail || !product.thumbnail.url) {
          updateData.thumbnail = newImages[0];
        }
      }
    }

    const updatedProduct = await Product.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    })
      .populate("seller", "firstName lastName businessName email phone")
      .populate("category", "name");

    res.status(200).json({
      success: true,
      message: "Product updated successfully by admin.",
      product: updatedProduct,
    });
  } catch (error) {
    console.error("Update Product Admin Error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

// ==========================================
// Exports
// ==========================================
module.exports = {
  adminLogin,
  adminLogout,
  getAdminProfile,
  getAdminRefreshToken,
  setAdminRefreshToken,
  clearAdminRefreshToken,
  getAllCustomers,
  updateCustomerAdmin,
  toggleCustomerStatus,
  deleteCustomer,
  getAllSellers,
  getSellerDetailsAdmin,
  updateSellerStatus,
  updateSellerAdmin,
  deleteSeller,
  getAllProductsAdmin,
  updateProductStatusAdmin,
  updateProductAdmin,
  deleteProductAdmin,
  getAllOrdersAdmin,
  getOrderDetailAdmin,
  updateOrderStatusAdmin,
  getAdminDashboardStats,
  // Analytics
  getRevenueAnalytics,
  getOrderAnalytics,
  getCustomerAnalytics,
  getProductAnalytics,
  getSellerAnalytics,
  ADMIN_EMAIL,
  ADMIN_PHONE,
};
