const mongoose = require("mongoose");
const Counter = require("./counterModel");

const vendorCommissionSchema = new mongoose.Schema(
  {
    commissionId: {
      type: String,
      unique: true,
    },

    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Seller",
      required: true,
    },

    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },

    commissionType: {
      type: String,
      enum: ["Percentage", "Fixed"],
      default: "Percentage",
    },

    commissionValue: {
      type: Number,
      required: true,
      min: 0,
    },

    gst: {
      type: Number,
      default: 0,
    },

    status: {
      type: String,
      enum: ["Active", "Inactive"],
      default: "Active",
    },

    remarks: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

vendorCommissionSchema.pre("save", async function () {
  if (!this.commissionId) {
    const seq = await Counter.nextSeq("VendorCommission");
    this.commissionId = `COM${String(seq).padStart(3, "0")}`;
  }
});

module.exports = mongoose.model(
  "VendorCommission",
  vendorCommissionSchema
);