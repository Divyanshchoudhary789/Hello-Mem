const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    shortDescription: {
      type: String,
      default: "",
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    brand: {
      type: String,
      trim: true,
      default: "",
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Seller",
      required: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    discountPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    mrp: {
      type: Number,
      default: 0,
      min: 0,
    },
    costPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    gst: {
      type: Number,
      default: 0,
      min: 0,
    },
    taxType: {
      type: String,
      enum: ["Inclusive", "Exclusive"],
      default: "Inclusive",
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    numReviews: {
      type: Number,
      default: 0,
    },
    stock: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    barcode: {
      type: String,
      trim: true,
      default: "",
    },
    minimumStockAlert: {
      type: Number,
      default: 5,
    },
    warehouse: {
      type: String,
      trim: true,
      default: "",
    },
    stockStatus: {
      type: String,
      enum: ["In Stock", "Out of Stock"],
      default: "In Stock",
    },
    sku: {
      type: String,
      required: true,
      trim: true,
    },
    images: [
      {
        url: { type: String, default: "" },
        public_id: { type: String, default: "" },
      },
    ],
    thumbnail: {
      url: { type: String, default: "" },
      public_id: { type: String, default: "" },
    },
    shipping: {
      weight: { type: Number, default: 0 },
      length: { type: Number, default: 0 },
      width: { type: Number, default: 0 },
      height: { type: Number, default: 0 },
      shippingCharge: { type: Number, default: 0 },
      deliveryTime: { type: String, default: "" },
    },
    specifications: {
      type: Map,
      of: String,
      default: {},
    },
    variants: {
      colors: [String],
      sizes: [String],
    },
    tags: [String],
    seo: {
      metaTitle: { type: String, default: "" },
      metaDescription: { type: String, default: "" },
      keywords: [String],
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Explicit indexes — sku uniqueness defined here only (not in field definition)
productSchema.index({ sku: 1 }, { unique: true });
productSchema.index({ seller: 1 });
productSchema.index({ category: 1 });
productSchema.index({ isActive: 1 });
productSchema.index({ isFeatured: 1 });
productSchema.index({ name: "text", brand: "text" }); // full-text search

module.exports = mongoose.model("Product", productSchema);
