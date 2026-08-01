const mongoose = require("mongoose");
const Product = require("../models/productModel");
const Category = require("../models/category");

/**
 * Advanced Product Search Controller
 * GET /api/search?q=...&category=...&brand=...&minPrice=...&maxPrice=...
 *       &minRating=...&inStock=true&sort=relevance&page=1&limit=20&tags=...
 *
 * Features:
 *  - MongoDB Atlas $text search (uses existing text index) with relevance scoring
 *  - Regex fallback for partial/prefix matches
 *  - Multi-field search: name, brand, description, tags, seo.keywords
 *  - Category filter (by id or slug)
 *  - Brand, price range, rating, stock, tags filters
 *  - Sort: relevance | price_asc | price_desc | newest | rating | popular
 *  - Pagination with metadata
 *  - Suggestions: top matching brands + categories returned alongside results
 *  - Response time header for monitoring
 */
const searchProducts = async (req, res) => {
  const startTime = Date.now();

  try {
    const {
      q = "",                     // search query
      category,                   // category ObjectId or slug
      brand,                      // exact brand name (case-insensitive)
      minPrice,
      maxPrice,
      minRating,
      inStock,                    // "true" => only in-stock items
      tags,                       // comma-separated tags e.g. "organic,fresh"
      sort = "relevance",         // relevance | price_asc | price_desc | newest | rating | popular
      page = 1,
      limit = 20,
    } = req.query;

    // ── Sanitize & validate pagination ──────────────────────────────────────
    const pageNum  = Math.max(1, parseInt(page)  || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit) || 20));

    // ── Base filter — only show active products ──────────────────────────────
    const filter = { isActive: true };

    // ── Category filter (supports ObjectId or slug) ──────────────────────────
    if (category) {
      if (mongoose.Types.ObjectId.isValid(category)) {
        filter.category = new mongoose.Types.ObjectId(category);
      } else {
        // Treat as slug — resolve to ObjectId
        const categoryDoc = await Category.findOne({
          slug: category.toLowerCase().trim(),
          isActive: true,
        }).select("_id").lean();

        if (categoryDoc) {
          filter.category = categoryDoc._id;
        } else {
          // Unknown category slug — return empty result fast
          return res.status(200).json({
            success: true,
            query: q.trim(),
            total: 0,
            currentPage: pageNum,
            totalPages: 0,
            products: [],
            facets: { brands: [], categories: [] },
            responseTime: `${Date.now() - startTime}ms`,
          });
        }
      }
    }

    // ── Brand filter ─────────────────────────────────────────────────────────
    if (brand && brand.trim()) {
      filter.brand = { $regex: `^${escapeRegex(brand.trim())}$`, $options: "i" };
    }

    // ── Price range filter ───────────────────────────────────────────────────
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice && !isNaN(Number(minPrice))) filter.price.$gte = Number(minPrice);
      if (maxPrice && !isNaN(Number(maxPrice))) filter.price.$lte = Number(maxPrice);
    }

    // ── Rating filter ────────────────────────────────────────────────────────
    if (minRating && !isNaN(Number(minRating))) {
      filter.rating = { $gte: Number(minRating) };
    }

    // ── Stock filter ─────────────────────────────────────────────────────────
    if (inStock === "true") {
      filter.stockStatus = "In Stock";
      filter.stock = { $gt: 0 };
    }

    // ── Tags filter ───────────────────────────────────────────────────────────
    if (tags && tags.trim()) {
      const tagList = tags
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      if (tagList.length > 0) {
        filter.tags = { $in: tagList };
      }
    }

    // ── Sort option mapping ──────────────────────────────────────────────────
    const sortMap = {
      price_asc:  { price: 1 },
      price_desc: { price: -1 },
      newest:     { createdAt: -1 },
      rating:     { rating: -1, numReviews: -1 },
      popular:    { numReviews: -1, rating: -1 },
    };

    // ── Search Query Building ────────────────────────────────────────────────
    const trimmedQ = q.trim();
    let projection = {};
    let sortOption = sortMap[sort] || { createdAt: -1 };

    if (trimmedQ) {
      const escaped = escapeRegex(trimmedQ);

      if (sort === "relevance") {
        // $text search — uses MongoDB weighted text index (fast, indexed)
        filter.$text = { $search: trimmedQ };
        projection   = { score: { $meta: "textScore" } };
        sortOption   = { score: { $meta: "textScore" } };
      } else {
        // Non-relevance sort: regex search across multiple fields
        // Partial/prefix matches work here; $text doesn't support partial matches
        filter.$or = [
          { name:             { $regex: escaped, $options: "i" } },
          { brand:            { $regex: escaped, $options: "i" } },
          { shortDescription: { $regex: escaped, $options: "i" } },
          { tags:             { $regex: escaped, $options: "i" } },
          { "seo.keywords":   { $regex: escaped, $options: "i" } },
        ];
      }
    }

    // ── Execute main query + facet aggregation in parallel ──────────────────
    const [countResult, products, facets] = await Promise.all([
      // Count total matches
      Product.countDocuments(filter),

      // Paginated product results
      Product.find(filter, projection)
        .populate("category", "name slug image")
        .populate("seller", "businessName isVerified")
        .select(
          "name slug thumbnail price discountPrice mrp rating numReviews " +
          "brand stockStatus stock isFeatured tags category seller createdAt"
        )
        .sort(sortOption)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),

      // Facets: distinct brands + categories matching the filter (without pagination)
      // Only compute when a search query is present to keep it fast
      trimmedQ || Object.keys(filter).length > 1
        ? getFacets(filter)
        : Promise.resolve({ brands: [], categories: [] }),
    ]);

    const totalPages = Math.ceil(countResult / limitNum);

    return res.status(200).json({
      success: true,
      query: trimmedQ,
      total: countResult,
      currentPage: pageNum,
      totalPages,
      hasNextPage: pageNum < totalPages,
      hasPrevPage: pageNum > 1,
      products,
      facets,
      appliedFilters: buildAppliedFilters(req.query),
      responseTime: `${Date.now() - startTime}ms`,
    });
  } catch (error) {
    console.error("searchProducts error:", error);
    return res.status(500).json({
      success: false,
      message: "Search failed. Please try again.",
    });
  }
};

/**
 * Search Suggestions / Autocomplete
 * GET /api/search/suggestions?q=...
 *
 * Returns: top 8 product name matches + matching category names
 * Designed for typeahead — fast, minimal projection
 */
const searchSuggestions = async (req, res) => {
  try {
    const { q = "" } = req.query;
    const trimmedQ = q.trim();

    if (!trimmedQ || trimmedQ.length < 2) {
      return res.status(200).json({ success: true, suggestions: [] });
    }

    const escaped = escapeRegex(trimmedQ);
    const regex   = { $regex: escaped, $options: "i" };

    const [productSuggestions, categorySuggestions] = await Promise.all([
      Product.find({ name: regex, isActive: true })
        .select("name slug thumbnail price discountPrice brand")
        .sort({ rating: -1, numReviews: -1 })
        .limit(6)
        .lean(),

      Category.find({ name: regex, isActive: true })
        .select("name slug image")
        .limit(3)
        .lean(),
    ]);

    const suggestions = [
      ...categorySuggestions.map((c) => ({ type: "category", ...c })),
      ...productSuggestions.map((p)  => ({ type: "product",  ...p  })),
    ];

    return res.status(200).json({ success: true, suggestions });
  } catch (error) {
    console.error("searchSuggestions error:", error);
    return res.status(500).json({
      success: false,
      message: "Suggestions failed. Please try again.",
    });
  }
};

// ── Private Helpers ────────────────────────────────────────────────────────────

/**
 * Escapes special regex characters from user input to prevent ReDoS attacks.
 */
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Returns distinct brands and categories from the current filtered set.
 * Used for search result facets (filter sidebar on frontend).
 *
 * We strip text-search operators ($text, $or from search) so that facets show
 * ALL brands/categories that match the non-search filters — this is the standard
 * e-commerce UX (e.g. price filter applied, show all brands in that price range).
 */
const getFacets = async (baseFilter) => {
  try {
    const facetFilter = { ...baseFilter };
    // Remove search-specific operators — facets should reflect filter context only
    delete facetFilter.$text;
    delete facetFilter.$or;

    const [brands, categories] = await Promise.all([
      Product.distinct("brand", { ...facetFilter, brand: { $nin: ["", null] } }),
      Product.distinct("category", facetFilter),
    ]);

    const categoryDocs = await Category.find({ _id: { $in: categories } })
      .select("name slug")
      .lean();

    return {
      brands: brands.filter(Boolean).sort(),
      categories: categoryDocs,
    };
  } catch {
    return { brands: [], categories: [] };
  }
};

/**
 * Builds a clean summary of which filters are currently active.
 * Useful for frontend "Applied Filters" chips.
 */
const buildAppliedFilters = (query) => {
  const active = [];
  if (query.category)  active.push({ key: "category",  value: query.category });
  if (query.brand)     active.push({ key: "brand",     value: query.brand });
  if (query.minPrice)  active.push({ key: "minPrice",  value: query.minPrice });
  if (query.maxPrice)  active.push({ key: "maxPrice",  value: query.maxPrice });
  if (query.minRating) active.push({ key: "minRating", value: query.minRating });
  if (query.inStock === "true") active.push({ key: "inStock", value: "true" });
  if (query.tags)      active.push({ key: "tags",      value: query.tags });
  return active;
};

module.exports = { searchProducts, searchSuggestions };
