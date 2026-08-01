const mongoose = require("mongoose");

// =======================
// Product Snapshot
// =======================
const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Seller",
      required: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    slug: String,

    image: String,

    sku: String,

    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
    },

    quantity: {
      type: Number,
      required: true,
      min: 1,
    },

    price: {
      type: Number,
      required: true,
      min: 0,
    },

    discount: {
      type: Number,
      default: 0,
    },

    subtotal: {
      type: Number,
      required: true,
    },
  },
  { _id: false }
);

// =======================
// Customer Snapshot
// =======================
const customerSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },

    name: String,

    email: String,

    phone: String,
  },
  { _id: false }
);

// =======================
// Address Snapshot
// =======================
const addressSchema = new mongoose.Schema(
  {
    fullName: String,

    phone: String,

    addressLine1: String,

    addressLine2: String,

    landmark: {
      type: String,
      required: true,
      trim: true,
    },

    city: String,

    state: String,

    country: {
      type: String,
      default: "India",
    },

    postalCode: String,
  },
  { _id: false }
);

// Shipping
const shippingSchema = new mongoose.Schema(
  {
    courier: String,

    trackingId: String,

    estimatedDelivery: Date,

    shippedAt: Date,

    deliveredAt: Date,
  },
  { _id: false }
);

// =======================
// Main Order Schema
// =======================
const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      unique: true,
      required: true,
    },

    customer: {
      type: customerSchema,
      required: true,
    },

    items: {
      type: [orderItemSchema],
      required: true,
      validate: [(arr) => arr.length > 0, "Order must contain at least one item"],
    },

    shippingAddress: {
      type: addressSchema,
      required: true,
    },

    billingAddress: {
      type: addressSchema,
      required: true,
    },

    pricing: {
      subtotal: {
        type: Number,
        required: true,
      },

      discount: {
        type: Number,
        default: 0,
      },

      shippingCharge: {
        type: Number,
        default: 0,
      },

      tax: {
        type: Number,
        default: 0,
      },

      total: {
        type: Number,
        required: true,
      },
    },

    coupon: {
      code: String,

      discount: {
        type: Number,
        default: 0,
      },
    },

    payment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
    },

    paymentMethod: {
      type: String,
      enum: ["COD", "razorpay", "card", "upi", "netbanking", "wallet"],
      default: "COD",
    },

    paymentStatus: {
      type: String,
      enum: [
        "pending",            // initial — online payment not yet received
        "paid",               // online payment verified OR COD cash collected
        "failed",             // online payment failed
        "refunded",           // online refund processed via Razorpay
        "cod_pending",        // COD order confirmed — cash to be collected on delivery
        "cod_refund_pending", // COD order returned — manual cash refund to be processed
      ],
      default: "pending",
    },

    shipping: shippingSchema,

    orderStatus: {
      type: String,
      enum: [
        "PENDING",
        "CONFIRMED",
        "PROCESSING",
        "PACKED",
        "SHIPPED",
        "OUT_FOR_DELIVERY",
        "DELIVERED",
        "CANCELLED",
        "RETURN_REQUESTED",
        "RETURN_APPROVED",
        "RETURN_REJECTED",
        "RETURNED",
      ],
      default: "PENDING",
    },

    notes: String,

    cancelReason: String,

    refundedAmount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// =======================
// Indexes
// =======================

orderSchema.index({ "customer.customerId": 1 });

orderSchema.index({ "items.seller": 1 });

orderSchema.index({ orderStatus: 1 });

orderSchema.index({ createdAt: -1 });

module.exports =
  mongoose.models.Order ||
  mongoose.model("Order", orderSchema);