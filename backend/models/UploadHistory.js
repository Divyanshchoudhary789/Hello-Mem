const mongoose = require("mongoose");

const uploadHistorySchema = new mongoose.Schema(
  {
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Seller",
      required: true,
    },

    fileName: {
      type: String,
      required: true,
      trim: true,
    },

    totalProducts: {
      type: Number,
      default: 0,
    },

    successCount: {
      type: Number,
      default: 0,
    },

    failedCount: {
      type: Number,
      default: 0,
    },

    status: {
      type: String,
      enum: ["Success", "Partial", "Failed"],
      default: "Success",
    },

    failedRows: [
      {
        row: Number,
        product: String,
        reason: String,
      },
    ],
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("UploadHistory", uploadHistorySchema);
