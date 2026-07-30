const Product = require("../models/productModel");
const uploadToCloudinary = require("../utils/uploadToCloudinary");
const slugify = require("slugify");

// ─── Helper: safely parse JSON fields sent as strings (multipart/form-data) ───
const safeParse = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

// ─── CREATE PRODUCT ───────────────────────────────────────────────────────────
const createProduct = async (req, res) => {
  try {
    const {
      name,
      description,
      shortDescription,
      category,
      brand,
      price,
      discountPrice,
      mrp,
      costPrice,
      gst,
      taxType,
      stock,
      barcode,
      minimumStockAlert,
      warehouse,
      stockStatus,
      sku,
      specifications,
      shipping,
      variants,
      tags,
      seo,
      isFeatured,
    } = req.body;

    // ── Required field validation ──────────────────────────────────────────
    if (!name || !price || !sku || !category) {
      return res.status(400).json({
        success: false,
        message: "Name, price, SKU, and category are required.",
      });
    }

    // ── Duplicate SKU check ───────────────────────────────────────────────
    const existingSku = await Product.findOne({ sku: sku.trim() });
    if (existingSku) {
      return res.status(400).json({
        success: false,
        message: "A product with this SKU already exists.",
      });
    }

    // ── Slug generation & duplicate slug check ────────────────────────────
    const slug = slugify(name, { lower: true, strict: true });
    const existingSlug = await Product.findOne({ slug });
    if (existingSlug) {
      return res.status(400).json({
        success: false,
        message: "A product with this name already exists. Please use a different name.",
      });
    }

    // ── Upload images to Cloudinary ───────────────────────────────────────
    const images = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const result = await uploadToCloudinary(file.buffer);
        images.push({ url: result.secure_url, public_id: result.public_id });
      }
    }
    const thumbnail = images.length > 0 ? images[0] : { url: "", public_id: "" };

    // ── Parse JSON string fields (sent via multipart/form-data) ──────────
    const specificationsData = safeParse(specifications, {});
    const tagsData           = safeParse(tags, []);
    const shippingData       = safeParse(shipping, {});
    const seoData            = safeParse(seo, {});

    // variants: model expects { colors: [], sizes: [] }
    const variantsRaw  = safeParse(variants, {});
    const variantsData = {
      colors: Array.isArray(variantsRaw.colors) ? variantsRaw.colors : [],
      sizes:  Array.isArray(variantsRaw.sizes)  ? variantsRaw.sizes  : [],
    };

    // isFeatured arrives as string "true"/"false" in form-data
    const featured =
      typeof isFeatured === "string" ? isFeatured === "true" : Boolean(isFeatured);

    // ── Create product ────────────────────────────────────────────────────
    const product = await Product.create({
      name,
      slug,
      description,
      shortDescription,
      category,
      brand,
      seller: req.user._id,       // ObjectId from authMiddleware
      price,
      discountPrice,
      mrp,
      costPrice,
      gst,
      taxType,
      stock: stock ?? 0,
      sku: sku.trim(),
      barcode,
      minimumStockAlert,
      warehouse,
      stockStatus,
      images,
      thumbnail,
      shipping:        shippingData,
      specifications:  specificationsData,
      variants:        variantsData,
      tags:            tagsData,
      seo:             seoData,
      isFeatured:      featured,
    });

    return res.status(201).json({
      success: true,
      message: "Product created successfully",
      product,
    });
  } catch (error) {
    // Mongoose validation errors — return readable messages
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: messages.join(", ") });
    }
    // Duplicate key (race condition on sku/slug index)
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || "field";
      return res.status(400).json({
        success: false,
        message: `Duplicate value for ${field}. Please use a unique value.`,
      });
    }
    console.error("createProduct error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── GET ALL PRODUCTS (public, with filters + pagination) ────────────────────
const getProducts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      category,
      subCategory,
      brand,
      minPrice,
      maxPrice,
      featured,
      sort,
    } = req.query;

    const pageNum  = Math.max(1, parseInt(page)  || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));

    const query = { isActive: true };

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$or = [
        { name:  { $regex: escaped, $options: "i" } },
        { brand: { $regex: escaped, $options: "i" } },
      ];
    }

    if (category)    query.category    = category;
    if (subCategory) query.subCategory = subCategory;
    if (brand)       query.brand       = brand;
    if (featured === "true") query.isFeatured = true;

    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }

    const sortMap = {
      price:       { price: 1 },
      "-price":    { price: -1 },
      name:        { name: 1 },
      "-createdAt":{ createdAt: -1 },
    };
    const sortOption = sortMap[sort] || { createdAt: -1 };

    const [total, products] = await Promise.all([
      Product.countDocuments(query),
      Product.find(query)
        .populate("category", "name slug")
        .populate("seller", "firstName lastName businessName")
        .sort(sortOption)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
    ]);

    return res.status(200).json({
      success: true,
      total,
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum),
      products,
    });
  } catch (error) {
    console.error("getProducts error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── GET SINGLE PRODUCT ───────────────────────────────────────────────────────
const getProductById = async (req, res) => {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      isActive: true,
    })
      .populate("category", "name slug")
      .populate("seller", "firstName lastName businessName");

    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    return res.status(200).json({ success: true, product });
  } catch (error) {
    console.error("getProductById error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── UPDATE PRODUCT ───────────────────────────────────────────────────────────
const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findOne({ _id: id, seller: req.user._id });
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const updateData = { ...req.body };

    // Parse JSON string fields
    if (updateData.specifications) updateData.specifications = safeParse(updateData.specifications, {});
    if (updateData.tags)           updateData.tags           = safeParse(updateData.tags, []);
    if (updateData.shipping)       updateData.shipping       = safeParse(updateData.shipping, {});
    if (updateData.seo)            updateData.seo            = safeParse(updateData.seo, {});

    // images & thumbnail can arrive as JSON strings from multipart/form-data
    if (updateData.images)    updateData.images    = safeParse(updateData.images, product.images);
    if (updateData.thumbnail) updateData.thumbnail = safeParse(updateData.thumbnail, product.thumbnail);

    if (updateData.variants) {
      const raw = safeParse(updateData.variants, {});
      updateData.variants = {
        colors: Array.isArray(raw.colors) ? raw.colors : [],
        sizes:  Array.isArray(raw.sizes)  ? raw.sizes  : [],
      };
    }

    // Re-generate slug if name changes
    if (updateData.name) {
      updateData.slug = slugify(updateData.name, { lower: true, strict: true });
    }

    // Duplicate SKU check (exclude current product)
    if (updateData.sku) {
      const skuConflict = await Product.findOne({
        sku: updateData.sku.trim(),
        _id: { $ne: id },
      });
      if (skuConflict) {
        return res.status(400).json({ success: false, message: "SKU already exists" });
      }
      updateData.sku = updateData.sku.trim();
    }

    // Handle new images if files uploaded — append to existing (or already-parsed) images
    if (req.files && req.files.length > 0) {
      const newImages = [];
      for (const file of req.files) {
        const result = await uploadToCloudinary(file.buffer);
        newImages.push({ url: result.secure_url, public_id: result.public_id });
      }
      const existingImages = Array.isArray(updateData.images) ? updateData.images : product.images;
      updateData.images    = [...existingImages, ...newImages];
      updateData.thumbnail = updateData.images[0];
    } else if (Array.isArray(updateData.images) && updateData.images.length > 0 && !updateData.thumbnail) {
      // No new file uploads but images array was updated — keep thumbnail in sync
      updateData.thumbnail = updateData.images[0];
    }

    const updatedProduct = await Product.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    return res.status(200).json({
      success: true,
      message: "Product updated successfully",
      product: updatedProduct,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: messages.join(", ") });
    }
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || "field";
      return res.status(400).json({
        success: false,
        message: `Duplicate value for ${field}.`,
      });
    }
    console.error("updateProduct error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── DELETE PRODUCT ───────────────────────────────────────────────────────────
const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findOne({ _id: id, seller: req.user._id });
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    await product.deleteOne();

    return res.status(200).json({ success: true, message: "Product deleted successfully" });
  } catch (error) {
    console.error("deleteProduct error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── TOGGLE PRODUCT STATUS ────────────────────────────────────────────────────
const toggleProductStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (typeof isActive === "undefined") {
      return res.status(400).json({ success: false, message: "isActive field is required." });
    }

    const product = await Product.findOne({ _id: id, seller: req.user._id });
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    product.isActive = isActive;
    await product.save();

    return res.status(200).json({
      success: true,
      message: `Product ${isActive ? "activated" : "deactivated"} successfully`,
      product,
    });
  } catch (error) {
    console.error("toggleProductStatus error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── GET FEATURED PRODUCTS ────────────────────────────────────────────────────
const getFeaturedProducts = async (req, res) => {
  try {
    const products = await Product.find({ isFeatured: true, isActive: true })
      .populate("category", "name slug")
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, count: products.length, products });
  } catch (error) {
    console.error("getFeaturedProducts error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── GET RELATED PRODUCTS ─────────────────────────────────────────────────────
const getRelatedProducts = async (req, res) => {
  try {
    const { id } = req.params;

    const currentProduct = await Product.findById(id);
    if (!currentProduct) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const products = await Product.find({
      category: currentProduct.category,
      _id: { $ne: id },
      isActive: true,
    })
      .limit(8)
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, products });
  } catch (error) {
    console.error("getRelatedProducts error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── UPDATE STOCK ─────────────────────────────────────────────────────────────
const updateStock = async (req, res) => {
  try {
    const { id } = req.params;
    const { stock } = req.body;

    if (stock === undefined || stock === null || isNaN(Number(stock))) {
      return res.status(400).json({ success: false, message: "Valid stock value is required." });
    }

    const product = await Product.findOne({ _id: id, seller: req.user._id });
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    product.stock = Number(stock);
    await product.save();

    return res.status(200).json({
      success: true,
      message: "Stock updated successfully",
      product,
    });
  } catch (error) {
    console.error("updateStock error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── GET MY PRODUCTS (seller's own products) ──────────────────────────────────
const getMyProducts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      sort,
    } = req.query;

    const pageNum  = Math.max(1, parseInt(page)  || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));

    const query = { seller: req.user._id };

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$or = [
        { name:  { $regex: escaped, $options: "i" } },
        { brand: { $regex: escaped, $options: "i" } },
        { sku:   { $regex: escaped, $options: "i" } },
      ];
    }

    const sortMap = {
      price:        { price: 1 },
      "-price":     { price: -1 },
      name:         { name: 1 },
      "-createdAt": { createdAt: -1 },
    };
    const sortOption = sortMap[sort] || { createdAt: -1 };

    const [total, products] = await Promise.all([
      Product.countDocuments(query),
      Product.find(query)
        .populate("category", "name slug")
        .sort(sortOption)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
    ]);

    return res.status(200).json({
      success: true,
      total,
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum),
      products,
    });
  } catch (error) {
    console.error("getMyProducts error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  toggleProductStatus,
  getFeaturedProducts,
  getRelatedProducts,
  getMyProducts,
  updateStock,
};
