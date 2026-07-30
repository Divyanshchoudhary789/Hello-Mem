const mongoose = require("mongoose");
const Counter = require("./counterModel");

const vendorPaymentSchema = new mongoose.Schema(
  {
    paymentId: {
      type: String,
      unique: true,
    },

    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Seller",
      required: true,
    },

    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },

    grossAmount: {
      type: Number,
      required: true,
      default: 0,
    },

    commission: {
      type: Number,
      default: 0,
    },

    gst: {
      type: Number,
      default: 0,
    },

    netAmount: {
      type: Number,
      required: true,
      default: 0,
    },

    paymentMode: {
      type: String,
      enum: [
        "Cash",
        "UPI",
        "NEFT",
        "RTGS",
        "IMPS",
        "Bank Transfer",
      ],
      default: "Bank Transfer",
    },

    paymentStatus: {
      type: String,
      enum: [
        "Pending",
        "Processing",
        "Paid",
        "Failed",
        "Cancelled",
      ],
      default: "Pending",
    },

    transactionId: {
      type: String,
      trim: true,
    },

    remarks: {
      type: String,
      trim: true,
    },

    paidAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Unique per seller+order pair — supports multi-seller orders
vendorPaymentSchema.index({ order: 1, seller: 1 }, { unique: true });

vendorPaymentSchema.pre("save", async function () {
  if (!this.paymentId) {
    const seq = await Counter.nextSeq("VendorPayment");
    this.paymentId = `PAY${String(seq).padStart(3, "0")}`;
  }
});

module.exports = mongoose.model(
  "VendorPayment",
  vendorPaymentSchema
);