const VendorPayment = require("../models/vendorPaymentModel");
const VendorCommission = require("../models/vendorCommissionModel");
const Order = require("../models/order");
const Seller = require("../models/sellersModel");
const Product = require("../models/productModel");
const mongoose = require("mongoose");

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL: Auto-create vendor payment records when an order is DELIVERED.
//
// Logic per seller in the order:
//   1. Sum up all items belonging to that seller → grossAmount
//   2. Look up VendorCommission for seller + item.category (Active rules only)
//   3. Calculate commission and GST on commission
//   4. netAmount = grossAmount - totalCommission - totalGstOnCommission
//   5. Create VendorPayment with paymentStatus "Pending"
//   6. Increment seller.totalSales by grossAmount
//
// One VendorPayment record is created PER SELLER (not per order).
// If a VendorPayment already exists for this order+seller it is skipped
// (idempotent — safe to call multiple times).
// ─────────────────────────────────────────────────────────────────────────────
const createVendorPaymentsForOrder = async (orderId) => {
  const order = await Order.findById(orderId);
  if (!order) throw new Error(`Order ${orderId} not found`);

  // Group items by seller
  const sellerItemsMap = {};
  for (const item of order.items) {
    const sellerId = item.seller.toString();
    if (!sellerItemsMap[sellerId]) sellerItemsMap[sellerId] = [];
    sellerItemsMap[sellerId].push(item);
  }

  for (const [sellerId, items] of Object.entries(sellerItemsMap)) {
    // Idempotency check — skip if already created for this order+seller
    const exists = await VendorPayment.findOne({
      order: order._id,
      seller: sellerId,
    });
    if (exists) continue;

    const grossAmount = items.reduce((sum, i) => sum + i.subtotal, 0);

    let totalCommission = 0;
    let totalGst = 0;

    // Calculate commission for each item based on its category rule
    for (const item of items) {
      // If item doesn't have category (old orders), fetch from product
      let categoryId = item.category;
      if (!categoryId && item.product) {
        try {
          const product = await Product.findById(item.product).select("category").lean();
          categoryId = product?.category;
        } catch (e) {
          console.warn(`[VendorPayment] Could not fetch product ${item.product} for category:`, e.message);
        }
      }

      if (!categoryId) continue;

      const rule = await VendorCommission.findOne({
        seller: sellerId,
        category: categoryId,
        status: "Active",
      });

      if (!rule) continue;

      let itemCommission = 0;
      if (rule.commissionType === "Percentage") {
        itemCommission = (item.subtotal * rule.commissionValue) / 100;
      } else {
        // Fixed — per item unit
        itemCommission = rule.commissionValue * item.quantity;
      }

      const itemGst = (itemCommission * (rule.gst || 0)) / 100;

      totalCommission += itemCommission;
      totalGst += itemGst;
    }

    const netAmount = grossAmount - totalCommission - totalGst;

    await VendorPayment.create({
      seller: sellerId,
      order: order._id,
      grossAmount: parseFloat(grossAmount.toFixed(2)),
      commission: parseFloat(totalCommission.toFixed(2)),
      gst: parseFloat(totalGst.toFixed(2)),
      netAmount: parseFloat(netAmount.toFixed(2)),
      paymentStatus: "Pending",
      remarks: `Auto-generated on order delivery — ${order.orderNumber}`,
    });

    // Update seller's total sales
    await Seller.findByIdAndUpdate(sellerId, {
      $inc: { totalSales: grossAmount },
    });

    console.log(
      `[VendorPayment] Created for seller ${sellerId}, order ${order.orderNumber} — net ₹${netAmount.toFixed(2)}`
    );
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: Manually create a vendor payment (override / correction flow)
// ─────────────────────────────────────────────────────────────────────────────
const createVendorPayment = async (req, res) => {
  try {
    const {
      seller,   // required — admin must explicitly supply the seller ID
      order,
      grossAmount,
      commission,
      gst,
      paymentMode,
      transactionId,
      remarks,
    } = req.body;

    if (!seller || !mongoose.Types.ObjectId.isValid(seller)) {
      return res.status(400).json({
        success: false,
        message: "Valid seller ID is required.",
      });
    }

    if (!order || !mongoose.Types.ObjectId.isValid(order)) {
      return res.status(400).json({
        success: false,
        message: "Valid order ID is required.",
      });
    }

    const orderExists = await Order.findById(order);
    if (!orderExists) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    // Verify the seller actually sold items in this order
    const sellerInOrder = orderExists.items.some(
      (item) => item.seller.toString() === seller
    );
    if (!sellerInOrder) {
      return res.status(400).json({
        success: false,
        message: "This seller has no items in the specified order.",
      });
    }

    const existingPayment = await VendorPayment.findOne({ order, seller });
    if (existingPayment) {
      return res.status(400).json({
        success: false,
        message: "Payment already exists for this seller and order.",
      });
    }

    const netAmount =
      Number(grossAmount || 0) -
      Number(commission || 0) -
      Number(gst || 0);

    const payment = await VendorPayment.create({
      seller,
      order,
      grossAmount,
      commission,
      gst,
      netAmount,
      paymentMode,
      transactionId,
      remarks,
    });

    const result = await VendorPayment.findById(payment._id)
      .populate("seller", "firstName lastName email businessName")
      .populate("order", "orderNumber pricing paymentStatus");

    res.status(201).json({
      success: true,
      message: "Vendor payment created successfully.",
      payment: result,
    });
  } catch (error) {
    console.error("Create Vendor Payment:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET: List vendor payments
//   - Admin sees ALL payments (no seller filter unless explicitly passed)
//   - Seller sees only their own
// ─────────────────────────────────────────────────────────────────────────────
const getVendorPayments = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      paymentStatus,
      paymentMode,
      search,
      fromDate,
      toDate,
      sort,
      sellerId, // admin can filter by a specific seller
    } = req.query;

    const query = {};

    if (req.user.role === "seller") {
      // Seller can only see their own payments
      query.seller = req.user._id;
    } else if (sellerId && mongoose.Types.ObjectId.isValid(sellerId)) {
      // Admin filtered by seller
      query.seller = sellerId;
    }
    // Otherwise admin sees all

    if (paymentStatus) query.paymentStatus = paymentStatus;
    if (paymentMode) query.paymentMode = paymentMode;

    if (search) {
      query.$or = [
        { paymentId: { $regex: search, $options: "i" } },
        { transactionId: { $regex: search, $options: "i" } },
      ];
    }

    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) query.createdAt.$gte = new Date(fromDate);
      if (toDate) query.createdAt.$lte = new Date(toDate);
    }

    let sortOption = { createdAt: -1 };
    if (sort === "amount") sortOption = { netAmount: 1 };
    else if (sort === "-amount") sortOption = { netAmount: -1 };

    const total = await VendorPayment.countDocuments(query);

    const payments = await VendorPayment.find(query)
      .populate("seller", "firstName lastName email businessName")
      .populate("order", "orderNumber pricing paymentStatus orderStatus")
      .sort(sortOption)
      .skip((page - 1) * Number(limit))
      .limit(Number(limit));

    res.status(200).json({
      success: true,
      total,
      currentPage: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      payments,
    });
  } catch (error) {
    console.error("Get Vendor Payments:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET single vendor payment
//   - Admin can fetch any; seller can only fetch their own
// ─────────────────────────────────────────────────────────────────────────────
const getVendorPaymentById = async (req, res) => {
  try {
    const filter = { _id: req.params.id };
    if (req.user.role === "seller") filter.seller = req.user._id;

    const payment = await VendorPayment.findOne(filter)
      .populate("seller", "firstName lastName email businessName bankDetails")
      .populate("order", "orderNumber pricing paymentStatus orderStatus items");

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Vendor payment not found.",
      });
    }

    res.status(200).json({ success: true, payment });
  } catch (error) {
    console.error("Get Vendor Payment:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: Update vendor payment (amounts / mode / transaction reference)
// ─────────────────────────────────────────────────────────────────────────────
const updateVendorPayment = async (req, res) => {
  try {
    const payment = await VendorPayment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Vendor payment not found.",
      });
    }

    // Cannot edit a payment that has already been paid/failed
    if (["Paid", "Failed", "Cancelled"].includes(payment.paymentStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot edit a payment with status "${payment.paymentStatus}".`,
      });
    }

    const { grossAmount, commission, gst, paymentMode, transactionId, remarks } = req.body;

    if (grossAmount !== undefined) payment.grossAmount = grossAmount;
    if (commission !== undefined) payment.commission = commission;
    if (gst !== undefined) payment.gst = gst;
    payment.netAmount =
      Number(payment.grossAmount) - Number(payment.commission) - Number(payment.gst);

    if (paymentMode) payment.paymentMode = paymentMode;
    if (transactionId) payment.transactionId = transactionId;
    if (remarks !== undefined) payment.remarks = remarks;

    await payment.save();

    const updatedPayment = await VendorPayment.findById(payment._id)
      .populate("seller", "firstName lastName email businessName")
      .populate("order", "orderNumber pricing paymentStatus orderStatus");

    res.status(200).json({
      success: true,
      message: "Vendor payment updated successfully.",
      payment: updatedPayment,
    });
  } catch (error) {
    console.error("Update Vendor Payment:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: Delete vendor payment (only Pending or Processing)
// ─────────────────────────────────────────────────────────────────────────────
const deleteVendorPayment = async (req, res) => {
  try {
    const payment = await VendorPayment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Vendor payment not found.",
      });
    }

    if (["Paid"].includes(payment.paymentStatus)) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete a payment that has already been paid.",
      });
    }

    await payment.deleteOne();
    res.status(200).json({
      success: true,
      message: "Vendor payment deleted successfully.",
    });
  } catch (error) {
    console.error("Delete Vendor Payment:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: Update only payment status (Pending → Processing → Paid / Failed)
// ─────────────────────────────────────────────────────────────────────────────
const updateVendorPaymentStatus = async (req, res) => {
  try {
    const { paymentStatus, transactionId, remarks } = req.body;

    const validStatuses = ["Pending", "Processing", "Paid", "Failed", "Cancelled"];
    if (!validStatuses.includes(paymentStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    const payment = await VendorPayment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Vendor payment not found.",
      });
    }

    // Prevent re-processing an already-paid payment
    if (payment.paymentStatus === "Paid" && paymentStatus !== "Paid") {
      return res.status(400).json({
        success: false,
        message: "Cannot change status of a payment that has already been marked as Paid.",
      });
    }

    payment.paymentStatus = paymentStatus;

    if (paymentStatus === "Paid") {
      payment.paidAt = new Date();
      if (transactionId) payment.transactionId = transactionId;
    }

    if (remarks) payment.remarks = remarks;

    await payment.save();

    res.status(200).json({
      success: true,
      message: "Payment status updated successfully.",
      payment,
    });
  } catch (error) {
    console.error("Update Payment Status:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SELLER: Get own payment dashboard summary
// GET /api/vendor-payments/my-summary
// ─────────────────────────────────────────────────────────────────────────────
const getMyPaymentSummary = async (req, res) => {
  try {
    const sellerId = req.user._id;

    const [summaryRaw, recentPayments, monthlyTrendRaw] = await Promise.all([
      // Overall grouped by paymentStatus
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

      // Latest 10 payment records with order info
      VendorPayment.find({ seller: sellerId })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate("order", "orderNumber orderStatus paymentStatus createdAt pricing"),

      // Monthly payout trend — last 6 months
      VendorPayment.aggregate([
        {
          $match: {
            seller: sellerId,
            createdAt: {
              $gte: new Date(new Date().getFullYear(), new Date().getMonth() - 5, 1),
            },
          },
        },
        {
          $group: {
            _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
            totalGross: { $sum: "$grossAmount" },
            totalNet: { $sum: "$netAmount" },
            totalCommission: { $sum: "$commission" },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
      ]),
    ]);

    // Shape summary
    const summary = {
      pending:    { count: 0, totalGross: 0, totalCommission: 0, totalGst: 0, totalNet: 0 },
      processing: { count: 0, totalGross: 0, totalCommission: 0, totalGst: 0, totalNet: 0 },
      paid:       { count: 0, totalGross: 0, totalCommission: 0, totalGst: 0, totalNet: 0 },
      failed:     { count: 0, totalGross: 0, totalCommission: 0, totalGst: 0, totalNet: 0 },
      cancelled:  { count: 0, totalGross: 0, totalCommission: 0, totalGst: 0, totalNet: 0 },
    };
    for (const row of summaryRaw) {
      const key = (row._id || "").toLowerCase();
      if (summary[key]) summary[key] = { count: row.count, totalGross: row.totalGross, totalCommission: row.totalCommission, totalGst: row.totalGst, totalNet: row.totalNet };
    }

    const totalEarningsGross = summaryRaw.reduce((s, r) => s + r.totalGross, 0);
    const totalEarningsNet   = summaryRaw.reduce((s, r) => s + r.totalNet, 0);

    // Shape monthly trend
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthlyTrend = monthlyTrendRaw.map((r) => ({
      month: `${monthNames[r._id.month - 1]} ${r._id.year}`,
      totalGross: parseFloat(r.totalGross.toFixed(2)),
      totalNet: parseFloat(r.totalNet.toFixed(2)),
      totalCommission: parseFloat(r.totalCommission.toFixed(2)),
      count: r.count,
    }));

    res.status(200).json({
      success: true,
      summary,
      totals: {
        earningsGross: parseFloat(totalEarningsGross.toFixed(2)),
        earningsNet:   parseFloat(totalEarningsNet.toFixed(2)),
        paidNet:       parseFloat(summary.paid.totalNet.toFixed(2)),
        pendingNet:    parseFloat((summary.pending.totalNet + summary.processing.totalNet).toFixed(2)),
      },
      monthlyTrend,
      recentPayments,
    });
  } catch (error) {
    console.error("Get My Payment Summary:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: Get payment summary for a seller (dashboard stats)
// ─────────────────────────────────────────────────────────────────────────────
const getSellerPaymentSummary = async (req, res) => {
  try {
    const { sellerId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(sellerId)) {
      return res.status(400).json({ success: false, message: "Invalid seller ID." });
    }

    const summary = await VendorPayment.aggregate([
      { $match: { seller: new mongoose.Types.ObjectId(sellerId) } },
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
    ]);

    // Format into a friendlier object
    const result = {
      pending: { count: 0, totalGross: 0, totalNet: 0 },
      processing: { count: 0, totalGross: 0, totalNet: 0 },
      paid: { count: 0, totalGross: 0, totalNet: 0 },
      failed: { count: 0, totalGross: 0, totalNet: 0 },
      cancelled: { count: 0, totalGross: 0, totalNet: 0 },
    };

    for (const row of summary) {
      const key = row._id.toLowerCase();
      if (result[key] !== undefined) {
        result[key] = {
          count: row.count,
          totalGross: row.totalGross,
          totalCommission: row.totalCommission,
          totalGst: row.totalGst,
          totalNet: row.totalNet,
        };
      }
    }

    res.status(200).json({ success: true, summary: result });
  } catch (error) {
    console.error("Get Seller Payment Summary:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createVendorPayment,
  createVendorPaymentsForOrder,
  getVendorPayments,
  getVendorPaymentById,
  updateVendorPayment,
  deleteVendorPayment,
  updateVendorPaymentStatus,
  getMyPaymentSummary,
  getSellerPaymentSummary,
};
