
const Order = require("../models/order");
const Cart = require("../models/cart");
const Product = require("../models/productModel");
const Customer = require("../models/customers");
const Payment = require("../models/Payment");
const mongoose = require("mongoose");
const { createVendorPaymentsForOrder } = require("./vendorPaymentController");

// ─────────────────────────────────────────────────────────────────────────────
// ABANDONED ORDER CLEANUP
// Orders that are still PENDING + paymentStatus "pending" after this window
// are considered abandoned — stock is restored and the order is cancelled.
// The DB-backed cron job in jobs/abandonedOrderCleanup.js is the authoritative
// cleanup mechanism. This in-process timeout is intentionally removed to avoid
// double-cleanup race conditions on server restarts.
// ─────────────────────────────────────────────────────────────────────────────

const createOrder = async (req, res) => {
  try {
    const customerId = req.user._id; // authMiddleware attaches both .id and ._id

    const {
      checkoutType,
      productId,
      quantity,
      shippingAddress,
      paymentMethod = "COD",
      notes = "",
    } = req.body;

    // Validate paymentMethod
    const validPaymentMethods = ["COD", "razorpay", "card", "upi", "netbanking", "wallet"];
    if (!validPaymentMethods.includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: `Invalid payment method. Allowed: ${validPaymentMethods.join(", ")}`,
      });
    }

    if (!["cart", "buyNow"].includes(checkoutType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid checkout type",
      });
    }

    if (
      !shippingAddress ||
      !shippingAddress.fullName ||
      !shippingAddress.phone ||
      !shippingAddress.addressLine1 ||
      !shippingAddress.landmark ||
      !shippingAddress.city ||
      !shippingAddress.state ||
      !shippingAddress.postalCode
    ) {
      return res.status(400).json({
        success: false,
        message: "Complete shipping address is required (landmark is mandatory)",
      });
    }

    const customer = await Customer.findById(customerId);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    let cartItems = [];

    if (checkoutType === "cart") {

      const cart = await Cart.findOne({
        customer: customerId,
      }).populate("items.product");

      if (!cart || cart.items.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Your cart is empty",
        });
      }

      cartItems = cart.items;

    }

    else {
      if (!productId) {
        return res.status(400).json({
          success: false,
          message: "Product ID is required",
        });
      }

      if (!quantity || quantity < 1) {
        return res.status(400).json({
          success: false,
          message: "Quantity must be at least 1",
        });
      }

      const product = await Product.findById(productId);

      if (!product) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      if (!product.isActive) {
        return res.status(400).json({
          success: false,
          message: "Product is currently unavailable",
        });
      }

      if (product.stock < quantity) {
        return res.status(400).json({
          success: false,
          message: "Insufficient stock",
        });
      }

      cartItems = [
        {
          product,
          quantity,
        },
      ];

    }
    let subtotal = 0;
    const orderItems = [];

    for (const item of cartItems) {

      const product = item.product;

      if (!product) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      if (!product.isActive) {
        return res.status(400).json({
          success: false,
          message: `${product.name} is unavailable`,
        });
      }

      if (product.stock < item.quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${product.name}`,
        });
      }

      const itemSubtotal = product.price * item.quantity;

      subtotal += itemSubtotal;

      orderItems.push({
        product: product._id,
        seller: product.seller,
        category: product.category,
        name: product.name,
        slug: product.slug,
        image: product.images?.[0] || "",
        sku: product.sku,
        quantity: item.quantity,
        price: product.price,
        discount: 0,
        subtotal: itemSubtotal,
      });

    }
    const shippingCharge = 0;
    const tax = 0;
    const discount = 0;

    const total =
      subtotal +
      shippingCharge +
      tax -
      discount;

    const orderNumber = `ORD${Date.now()}`;

    const orderData = {
      orderNumber,

      customer: {
        customerId: customer._id,
        name: `${customer.firstName} ${customer.lastName}`.trim(),
        email: customer.email || "",
        phone: customer.mobileNumber || "",
      },

  items: orderItems,

  shippingAddress,

  billingAddress: shippingAddress,

  paymentMethod,

  pricing: {
    subtotal,
    shippingCharge,
    tax,
    discount,
    total,
  },

  paymentStatus: "pending",

  notes,
};

const order = await Order.create(orderData);

    for (const item of orderItems) {
      await Product.findByIdAndUpdate(
        item.product,
        {
          $inc: {
            stock: -item.quantity,
          },
        }
      );
    }

    if (checkoutType === "cart") {
      await Cart.findOneAndUpdate(
        { customer: customerId },
        {
          items: [],
        }
      );
    }

    // For online payment methods, the DB-backed cron job (jobs/abandonedOrderCleanup.js)
    // will cancel and restore stock if payment is not received within 30 minutes.
    // COD orders are confirmed immediately — no online payment required.
    if (paymentMethod === "COD") {
      // COD — mark as confirmed right away, no online payment required.
      // paymentStatus = "cod_pending" means: order confirmed, cash will be collected at delivery.
      order.paymentStatus = "cod_pending";
      order.orderStatus = "CONFIRMED";

      // Create a Payment record for COD so that analytics and audit trail are consistent.
      // This mirrors the Razorpay flow — every order always has a linked Payment document.
      const codPayment = await Payment.create({
        order: order._id,
        customer: customerId,
        amount: total,
        currency: "INR",
        receipt: order._id.toString(),
        paymentMethod: "cod",
        transactionId: `COD-${order.orderNumber}`,
        status: "cod_pending",
      });

      order.payment = codPayment._id;
      await order.save();
    } else {
      await order.save();
    }

    return res.status(201).json({
      success: true,
      message: "Order placed successfully",
      order,
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getMyOrders = async (req, res) => {
  try {
    const customerId = req.user._id;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status;       // specific status filter
    const includeAbandoned = req.query.includeAbandoned === "true"; // default: hide

    const filter = {
      "customer.customerId": customerId,
    };

    if (status) {
      // Caller asked for a specific status — honour it exactly
      filter.orderStatus = status;
    } else if (!includeAbandoned) {
      // By default hide auto-cancelled abandoned orders so the customer's
      // order history stays clean. They can still fetch them explicitly with
      // ?includeAbandoned=true or ?status=CANCELLED.
      filter.$or = [
        { orderStatus: { $ne: "CANCELLED" } },
        // A CANCELLED order is shown if the customer manually cancelled it
        // (cancelReason will NOT contain the abandoned-order phrase)
        {
          orderStatus: "CANCELLED",
          cancelReason: {
            $not: /Payment not received within the allowed time|Payment failed/i,
          },
        },
      ];
    }

    const totalOrders = await Order.countDocuments(filter);

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return res.status(200).json({
      success: true,
      currentPage: page,
      totalPages: Math.ceil(totalOrders / limit),
      totalOrders,
      orders,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
 
const getOrderById = async (req, res) => {
  try {
    const customerId = req.user._id;
    const { id } = req.params;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID",
      });
    }

    const order = await Order.findOne({
      _id: id,
      "customer.customerId": customerId,
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    return res.status(200).json({
      success: true,
      order,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
 
const cancelOrder = async (req, res) => {
  try {
    const customerId = req.user._id;
    const { id } = req.params;
    const { cancelReason = "" } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID",
      });
    }

      // Find customer's order
      const order = await Order.findOne({
        _id: id,
        "customer.customerId": customerId,
      });

      if (!order) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      // Check if order can be cancelled
      const cancellableStatuses = ["PENDING", "CONFIRMED"];

      if (!cancellableStatuses.includes(order.orderStatus)) {
        return res.status(400).json({
          success: false,
          message: `Order cannot be cancelled once it is ${order.orderStatus}`,
        });
      }

      // Restore Stock
      for (const item of order.items) {
        await Product.findByIdAndUpdate(item.product, {
          $inc: {
            stock: item.quantity,
          },
        });
      }

      // Update Order
      order.orderStatus = "CANCELLED";
      order.cancelReason = cancelReason;

      // ── COD cancellation: update linked Payment record ─────────────────────
      // If COD order was cancelled before delivery (cash never collected),
      // mark the payment as cancelled — no refund needed.
      if (order.paymentMethod === "COD" && order.paymentStatus === "cod_pending") {
        order.paymentStatus = "pending"; // no cash taken, clean state
        await Payment.findOneAndUpdate(
          { order: order._id, paymentMethod: "cod" },
          { status: "cancelled" }
        );
      }

      await order.save();

      return res.status(200).json({
        success: true,
        message: "Order cancelled successfully",
        order,
      });

    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  };

const getSellerOrders = async (req, res) => {
  try {
    const sellerId = req.user._id;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status;

    // Sellers should only see orders where payment is confirmed.
    // Pending/abandoned orders are not actionable for the seller.
    // COD orders have paymentStatus "cod_pending" — they are confirmed & actionable.
    const filter = {
      "items.seller": sellerId,
      paymentStatus: { $in: ["paid", "cod_pending", "cod_refund_pending"] },
    };

    if (status) {
      filter.orderStatus = status;
    }

    const totalOrders = await Order.countDocuments(filter);

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const formattedOrders = orders.map((order) => {
      const sellerItems = order.items.filter(
        (item) => item.seller.toString() === sellerId.toString()
      );

      const sellerSubtotal = sellerItems.reduce(
        (sum, item) => sum + item.subtotal,
        0
      );

      return {
        _id: order._id,
        orderNumber: order.orderNumber,
        customer: order.customer,
        orderStatus: order.orderStatus,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        totalAmount: order.pricing.total,
        shipping: order.shipping,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        sellerSubtotal,
        items: sellerItems,
      };
    });

    return res.status(200).json({
      success: true,
      currentPage: page,
      totalPages: Math.ceil(totalOrders / limit),
      totalOrders,
      orders: formattedOrders,
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getSellerOrderById = async (req, res) => {
  try {
    const sellerId = req.user._id;
    const { id } = req.params;

    // Validate Order ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID",
      });
    }

    // Find order containing this seller's products — only if payment is confirmed
    // (paid = online payment done; cod_pending = COD confirmed, cash to be collected)
    const order = await Order.findOne({
      _id: id,
      "items.seller": sellerId,
      paymentStatus: { $in: ["paid", "cod_pending", "cod_refund_pending"] },
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Keep only this seller's items
    const sellerItems = order.items.filter(
      (item) => item.seller.toString() === sellerId.toString()
    );

    // Calculate seller subtotal
    const sellerSubtotal = sellerItems.reduce(
      (total, item) => total + item.subtotal,
      0
    );

    return res.status(200).json({
      success: true,
      order: {
        _id: order._id,
        orderNumber: order.orderNumber,

        customer: order.customer,

        shippingAddress: order.shippingAddress,

        billingAddress: order.billingAddress,

        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        totalAmount: order.pricing.total,

        shipping: order.shipping,

        orderStatus: order.orderStatus,

        notes: order.notes,

        createdAt: order.createdAt,

        updatedAt: order.updatedAt,

        sellerSubtotal,

        items: sellerItems,
      },
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const updateOrderStatus = async (req, res) => {
  try {
    const sellerId = req.user._id;
    const { id } = req.params;
    const { orderStatus } = req.body;

    // Validate Order ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID",
      });
    }

    // Allowed Status Flow
    const statusFlow = {
      PENDING: ["CONFIRMED"],
      CONFIRMED: ["PROCESSING"],
      PROCESSING: ["PACKED"],
      PACKED: ["SHIPPED"],
      SHIPPED: ["OUT_FOR_DELIVERY"],
      OUT_FOR_DELIVERY: ["DELIVERED"],
      DELIVERED: [],
      CANCELLED: [],
      RETURN_REQUESTED: [],
      RETURN_APPROVED: [],
      RETURN_REJECTED: [],
      RETURNED: [],
    };

    // Find order belonging to seller
    const order = await Order.findOne({
      _id: id,
      "items.seller": sellerId,
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Block status updates on unpaid orders — seller should never touch these
    // COD orders with "cod_pending" are confirmed and actionable
    if (order.paymentStatus !== "paid" && order.paymentStatus !== "cod_pending" && order.paymentStatus !== "cod_refund_pending") {
      return res.status(400).json({
        success: false,
        message: "Cannot update status: payment has not been received for this order",
      });
    }

    // Validate next status
    const allowedNextStatuses =
      statusFlow[order.orderStatus] || [];

    if (!allowedNextStatuses.includes(orderStatus)) {
      return res.status(400).json({
        success: false,
        message: `Order cannot be updated from ${order.orderStatus} to ${orderStatus}`,
      });
    }

    order.orderStatus = orderStatus;

    // Shipping timestamps
    if (!order.shipping) {
      order.shipping = {};
    }

    if (orderStatus === "SHIPPED") {
      order.shipping.shippedAt = new Date();
    }

    if (orderStatus === "DELIVERED") {
      order.shipping.deliveredAt = new Date();
    }

    await order.save();

    // When order is delivered, auto-create vendor payment records and update
    // totalSales for each seller. Errors here are non-blocking — the order
    // status update has already succeeded.
    if (orderStatus === "DELIVERED") {
      try {
        await createVendorPaymentsForOrder(order._id);
      } catch (vpErr) {
        console.error(`[VendorPayment] Auto-creation failed for order ${order.orderNumber}:`, vpErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: "Order status updated successfully",
      order,
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
 
const updateTracking = async (req, res) => {
  try {
    const sellerId = req.user._id;
    const { id } = req.params;

    const {
      courier,
      trackingId,
      estimatedDelivery,
    } = req.body;

    // Validate Order ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID",
      });
    }

    // Find seller's order
    const order = await Order.findOne({
      _id: id,
      "items.seller": sellerId,
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (order.paymentStatus !== "paid" && order.paymentStatus !== "cod_pending") {
      return res.status(400).json({
        success: false,
        message: "Cannot update tracking: payment has not been received for this order",
      });
    }

    // Tracking can only be added after packing
    const allowedStatuses = [
      "PACKED",
      "SHIPPED",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
    ];

    if (!allowedStatuses.includes(order.orderStatus)) {
      return res.status(400).json({
        success: false,
        message:
          "Tracking details can only be added after the order is packed",
      });
    }

    if (courier) {
      order.shipping.courier = courier;
    }

    if (trackingId) {
      order.shipping.trackingId = trackingId;
    }

    if (estimatedDelivery) {
      order.shipping.estimatedDelivery = estimatedDelivery;
    }

    await order.save();

    return res.status(200).json({
      success: true,
      message: "Tracking details updated successfully",
      shipping: order.shipping,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  createOrder,
  getMyOrders,
  getOrderById,
  cancelOrder,
  getSellerOrders,
  getSellerOrderById,
  updateOrderStatus,
  updateTracking,
};