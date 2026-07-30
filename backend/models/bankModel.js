const mongoose = require("mongoose");
const Counter = require("./counterModel");

const bankSchema = new mongoose.Schema(
  {
    bankId: {
      type: String,
      unique: true,
    },

    bankName: {
      type: String,
      required: true,
      trim: true,
    },

    ifscCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    country: {
      type: String,
      required: true,
      trim: true,
      default: "India",
    },

    branches: {
      type: Number,
      default: 0,
      min: 0,
    },

    status: {
      type: String,
      enum: ["Active", "Inactive"],
      default: "Active",
    },
  },
  {
    timestamps: true,
  }
);

bankSchema.pre("save", async function () {
  if (this.bankId) return;
  const seq = await Counter.nextSeq("Bank");
  this.bankId = `BANK${String(seq).padStart(3, "0")}`;
});

module.exports = mongoose.model("Bank", bankSchema);