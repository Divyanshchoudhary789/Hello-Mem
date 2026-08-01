const express = require("express");
const { searchProducts, searchSuggestions } = require("../controllers/searchController");
const { searchRateLimiter, suggestionsRateLimiter } = require("../middlewares/otpRateLimiter");

const router = express.Router();

/**
 * GET /api/search
 * Advanced product search with filters, sorting, pagination & facets.
 *
 * Query Params:
 *   q          {string}  - Search keyword
 *   category   {string}  - Category ObjectId or slug
 *   brand      {string}  - Brand name (case-insensitive)
 *   minPrice   {number}  - Minimum price
 *   maxPrice   {number}  - Maximum price
 *   minRating  {number}  - Minimum product rating (1-5)
 *   inStock    {boolean} - "true" to show only in-stock products
 *   tags       {string}  - Comma-separated tags e.g. "organic,fresh"
 *   sort       {string}  - relevance | price_asc | price_desc | newest | rating | popular
 *   page       {number}  - Page number (default: 1)
 *   limit      {number}  - Results per page (default: 20, max: 50)
 *
 * Rate limit: 60 requests/min per IP
 *
 * Example:
 *   GET /api/search?q=shoes&category=footwear&minPrice=500&maxPrice=3000&sort=price_asc&page=1
 */
router.get("/", searchRateLimiter, searchProducts);

/**
 * GET /api/search/suggestions
 * Typeahead autocomplete — returns matching product names + categories.
 *
 * Query Params:
 *   q  {string}  - Min 2 characters required
 *
 * Rate limit: 120 requests/min per IP (higher because typeahead fires on every keystroke)
 *
 * Example:
 *   GET /api/search/suggestions?q=shoe
 */
router.get("/suggestions", suggestionsRateLimiter, searchSuggestions);

module.exports = router;
