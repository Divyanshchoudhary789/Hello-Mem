const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
    },

    lastName: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },

    mobileNumber: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },

    address: {
      shippingAddress: {
        type: String,
        trim: true,
      },
      state: {
        type: String,
      },
      cityId: {
        type: String,
        default: null,
      },
      postalCode: {
        type: String,
        trim: true,
      },
    },

    refreshToken: {
      type: String,
      default: null,
      select: false, // never returned in queries by default
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Customer", customerSchema);
