const mongoose = require("mongoose");
const Review = require("../models/review");
const Product = require("../models/productModel");

// ─────────────────────────────────────────────────────────────────────────────
// Internal: recalculate product rating after any review change
// ─────────────────────────────────────────────────────────────────────────────
const updateProductRating = async (productId) => {
  const stats = await Review.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(productId) } },
    {
      $group: {
        _id: "$product",
        avgRating: { $avg: "$rating" },
        numReviews: { $sum: 1 },
      },
    },
  ]);

  await Product.findByIdAndUpdate(productId, {
    rating: stats.length ? Number(stats[0].avgRating.toFixed(1)) : 0,
    numReviews: stats.length ? stats[0].numReviews : 0,
  });
};

// POST /api/reviews  (customer only)
const addReview = async (req, res) => {
  try {
    const { productId, rating, comment } = req.body;

    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: "Valid product ID is required." });
    }

    const ratingNum = Number(rating);
    if (!ratingNum || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ success: false, message: "Rating must be between 1 and 5." });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found." });
    }

    const existingReview = await Review.findOne({
      customer: req.user._id,
      product: productId,
    });

    if (existingReview) {
      return res.status(409).json({ success: false, message: "You have already reviewed this product." });
    }

    const review = await Review.create({
      customer: req.user._id,
      product: productId,
      rating: ratingNum,
      comment: comment?.trim() || "",
    });

    await updateProductRating(productId);

    return res.status(201).json({ success: true, message: "Review added successfully.", review });
  } catch (error) {
    console.error("Add Review Error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error." });
  }
};

// GET /api/reviews/:productId  (public)
const getProductReviews = async (req, res) => {
  try {
    const { productId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: "Invalid product ID." });
    }

    const reviews = await Review.find({ product: productId })
      .populate("customer", "firstName lastName")
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, count: reviews.length, reviews });
  } catch (error) {
    console.error("Get Product Reviews Error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error." });
  }
};

// PUT /api/reviews/:id  (customer — own review only)
const updateReview = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid review ID." });
    }

    const review = await Review.findById(id);
    if (!review) {
      return res.status(404).json({ success: false, message: "Review not found." });
    }

    // Ownership check — compare ObjectId strings
    if (review.customer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized." });
    }

    const { rating, comment } = req.body;

    if (rating !== undefined) {
      const ratingNum = Number(rating);
      if (ratingNum < 1 || ratingNum > 5) {
        return res.status(400).json({ success: false, message: "Rating must be between 1 and 5." });
      }
      review.rating = ratingNum;
    }

    if (comment !== undefined) review.comment = comment.trim();

    await review.save();
    await updateProductRating(review.product);

    return res.status(200).json({ success: true, message: "Review updated successfully.", review });
  } catch (error) {
    console.error("Update Review Error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error." });
  }
};

// DELETE /api/reviews/:id  (customer — own review only)
const deleteReview = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid review ID." });
    }

    const review = await Review.findById(id);
    if (!review) {
      return res.status(404).json({ success: false, message: "Review not found." });
    }

    if (review.customer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized." });
    }

    const productId = review.product;
    await review.deleteOne();
    await updateProductRating(productId);

    return res.status(200).json({ success: true, message: "Review deleted successfully." });
  } catch (error) {
    console.error("Delete Review Error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error." });
  }
};

// GET /api/reviews/seller  (seller — reviews of their products)
const getSellerReviews = async (req, res) => {
  try {
    const sellerId = req.user._id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const ratingFilter = req.query.rating ? Number(req.query.rating) : null;

    const sellerProducts = await Product.find({ seller: sellerId }).select("_id");
    const productIds = sellerProducts.map((p) => p._id);

    const filter = { product: { $in: productIds } };
    if (ratingFilter && ratingFilter >= 1 && ratingFilter <= 5) {
      filter.rating = ratingFilter;
    }

    const [totalReviews, reviews, ratingStats] = await Promise.all([
      Review.countDocuments(filter),
      Review.find(filter)
        .populate("customer", "firstName lastName email")
        .populate("product", "name images")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Review.aggregate([
        { $match: { product: { $in: productIds } } },
        { $group: { _id: null, averageRating: { $avg: "$rating" } } },
      ]),
    ]);

    return res.status(200).json({
      success: true,
      averageRating: ratingStats.length > 0 ? Number(ratingStats[0].averageRating.toFixed(1)) : 0,
      totalReviews,
      currentPage: page,
      totalPages: Math.ceil(totalReviews / limit),
      reviews,
    });
  } catch (error) {
    console.error("Get Seller Reviews Error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error." });
  }
};

// GET /api/reviews/seller/:id  (seller — single review of their product)
const getReviewById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid review ID." });
    }

    const review = await Review.findById(id)
      .populate("customer", "firstName lastName email")
      .populate("product", "name seller images");

    if (!review) {
      return res.status(404).json({ success: false, message: "Review not found." });
    }

    // Fix: compare ObjectId to ObjectId (both .toString())
    if (review.product.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized." });
    }

    return res.status(200).json({ success: true, review });
  } catch (error) {
    console.error("Get Review By ID Error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error." });
  }
};

module.exports = {
  addReview,
  getProductReviews,
  updateReview,
  deleteReview,
  getSellerReviews,
  getReviewById,
};
