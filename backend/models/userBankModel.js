const mongoose = require("mongoose");
const Counter = require("./counterModel");

const userBankSchema = new mongoose.Schema(
  {
    userBankId: {
      type: String,
      unique: true,
    },

    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },

    bankName: {
      type: String,
      required: true,
      trim: true,
    },

    accountHolderName: {
      type: String,
      required: true,
      trim: true,
    },

    accountNumber: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },

    ifscCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },

    branchName: {
      type: String,
      trim: true,
    },

    accountType: {
      type: String,
      enum: ["Savings", "Current"],
      default: "Savings",
    },

    isPrimary: {
      type: Boolean,
      default: false,
    },

    status: {
      type: String,
      enum: ["Active", "Inactive"],
      default: "Active",
    },

    hiddenForSellers: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Seller",
    },
  ],
  },
  {
    timestamps: true,
  }
);

userBankSchema.pre("save", async function () {
  if (!this.userBankId) {
    const seq = await Counter.nextSeq("UserBank");
    this.userBankId = `UB${String(seq).padStart(3, "0")}`;
  }
});

module.exports = mongoose.model(
  "UserBank",
  userBankSchema
);