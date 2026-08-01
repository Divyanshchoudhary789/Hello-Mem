/**
 * In-memory rate limiter (shared store).
 *
 * NOTE: This uses a process-level Map. For multi-instance deployments,
 * replace this with a Redis-backed store (e.g. rate-limiter-flexible package).
 */
const rateLimitStore = new Map();

// Periodically prune expired entries to avoid unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of rateLimitStore.entries()) {
    if (now - data.firstRequest > data.windowMs) {
      rateLimitStore.delete(key);
    }
  }
}, 60 * 1000); // prune every minute

// ── Core limiter factory ──────────────────────────────────────────────────────
/**
 * Generic rate limiter middleware factory.
 *
 * @param {object} options
 * @param {number}   options.windowMs    - Sliding window in ms (default: 60s)
 * @param {number}   options.max         - Max requests per window (default: 60)
 * @param {string}   options.prefix      - Key prefix to namespace different limiters
 * @param {Function} options.keyFn       - (req) => string  Custom key extractor.
 *                                         Defaults to IP address.
 * @param {string}   options.message     - Error message on rate limit hit
 */
const createRateLimiter = ({
  windowMs = 60 * 1000,
  max = 60,
  prefix = "rl",
  keyFn = null,
  message = "Too many requests. Please try again later.",
} = {}) => {
  return (req, res, next) => {
    // Resolve identifier — custom key function or fall back to IP
    const rawKey = keyFn
      ? keyFn(req)
      : (req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress || "unknown");

    if (!rawKey) {
      // Cannot identify requester — let through (fail open, don't block legit traffic)
      return next();
    }

    const identifier = `${prefix}:${rawKey}`;
    const now = Date.now();
    const record = rateLimitStore.get(identifier);

    if (!record || now - record.firstRequest > windowMs) {
      // New window — start fresh
      rateLimitStore.set(identifier, { count: 1, firstRequest: now, windowMs });
      return next();
    }

    if (record.count >= max) {
      const remainingSeconds = Math.ceil((windowMs - (now - record.firstRequest)) / 1000);
      res.setHeader("Retry-After", remainingSeconds);
      return res.status(429).json({
        success: false,
        message,
        retryAfter: remainingSeconds,
      });
    }

    record.count += 1;
    return next();
  };
};

// ── OTP limiter (phone / email based) ────────────────────────────────────────
/**
 * Usage: otpRateLimiter(windowMs, maxRequests)
 *   windowMs    — sliding window in milliseconds (default: 60s)
 *   maxRequests — max OTP requests per window (default: 3)
 *
 * Identifier is read from req.body.phone or req.body.email.
 */
const otpRateLimiter = (windowMs = 60 * 1000, maxRequests = 3) => {
  return (req, res, next) => {
    let identifier;

    if (req.body.phone) {
      identifier = `otp:phone:${req.body.phone}`;
    } else if (req.body.email) {
      identifier = `otp:email:${req.body.email}`;
    } else {
      return res.status(400).json({
        success: false,
        message: "Phone number or email is required.",
      });
    }

    const now = Date.now();
    const record = rateLimitStore.get(identifier);

    if (!record || now - record.firstRequest > record.windowMs) {
      rateLimitStore.set(identifier, { count: 1, firstRequest: now, windowMs });
      return next();
    }

    if (record.count >= maxRequests) {
      const remainingSeconds = Math.ceil((record.windowMs - (now - record.firstRequest)) / 1000);
      return res.status(429).json({
        success: false,
        message: `Too many OTP requests. Please try again in ${remainingSeconds} second(s).`,
        retryAfter: remainingSeconds,
      });
    }

    record.count += 1;
    return next();
  };
};

// ── Pre-configured search limiters ───────────────────────────────────────────

/**
 * Search endpoint limiter — 60 requests per minute per IP.
 * Allows normal browsing/filtering but blocks scrapers.
 */
const searchRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  prefix: "search",
  message: "Too many search requests. Please slow down.",
});

/**
 * Suggestions/autocomplete limiter — 120 requests per minute per IP.
 * Higher limit because typeahead fires on every keystroke.
 */
const suggestionsRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  prefix: "suggestions",
  message: "Too many suggestion requests. Please slow down.",
});

module.exports = { otpRateLimiter, searchRateLimiter, suggestionsRateLimiter };
