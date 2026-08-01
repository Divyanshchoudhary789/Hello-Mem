const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },

    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },

    transactionId: {
      type: String,
    },

    razorpayOrderId: {
      type: String,
    },

    razorpayPaymentId: {
      type: String,
    },

    razorpaySignature: {
      type: String,
    },

    amount: {
      type: Number,
      required: true,
    },

    currency: {
      type: String,
      default: "INR",
    },

    receipt: {
      type: String,
    },

    paymentMethod: {
      type: String,
      enum: [
        "card",
        "upi",
        "netbanking",
        "wallet",
        "cod",
        "razorpay",
      ],
      required: true,
    },

    status: {
      type: String,
      enum: [
        "pending",          // initial state — awaiting payment
        "success",          // online payment verified
        "failed",           // online payment failed
        "refunded",         // online refund processed via Razorpay
        "cancelled",        // order cancelled before any payment
        // COD-specific statuses
        "cod_pending",      // COD order confirmed — awaiting cash collection at delivery
        "cod_collected",    // delivery agent collected cash — payment complete
        "cod_refund_pending", // COD order cancelled/returned — cash refund to be issued manually
      ],
      default: "pending",
    },

    // Reason for COD refund (filled when status → cod_refund_pending)
    codRefundReason: {
      type: String,
      trim: true,
    },

    // Date when COD cash was physically collected
    codCollectedAt: {
      type: Date,
    },

    paidAt: Date,

    refunds: [
      {
        refundId: String,
        amount: Number,
        status: {
          type: String,
          enum: ["pending", "processed", "failed"],
          default: "pending",
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  { timestamps: true }
);

paymentSchema.index({ razorpayOrderId: 1 }, { unique: true, sparse: true });
paymentSchema.index({ transactionId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("Payment", paymentSchema);
