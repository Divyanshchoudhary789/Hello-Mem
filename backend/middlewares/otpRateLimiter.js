/**
 * In-memory OTP rate limiter.
 *
 * NOTE: This uses a process-level Map. For multi-instance deployments,
 * replace this with a Redis-backed store (e.g. rate-limiter-flexible package).
 *
 * Usage: otpRateLimiter(windowMs, maxRequests)
 *   windowMs    — sliding window in milliseconds (default: 60s)
 *   maxRequests — max OTP requests per window (default: 3)
 *
 * Identifier is read from req.body.phone or req.body.email.
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
      // New window
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

module.exports = { otpRateLimiter };
