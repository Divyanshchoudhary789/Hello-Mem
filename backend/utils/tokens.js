const jwt = require("jsonwebtoken");

/**
 * Generate a short-lived access token.
 * Payload: { id, role }
 */
const generateAccessToken = (user) => {
  return jwt.sign(
    { id: user._id || user.id, role: user.role },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: process.env.ACCESS_TOKEN_EXPIRES || "15m" }
  );
};

/**
 * Generate a long-lived refresh token.
 * Payload: { id, role }
 */
const generateRefreshToken = (user) => {
  return jwt.sign(
    { id: user._id || user.id, role: user.role },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRES || "7d" }
  );
};

/**
 * Shared cookie options.
 * httpOnly prevents XSS access; secure + sameSite protect against CSRF.
 */
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
};

/**
 * Set access + refresh tokens in HttpOnly cookies on the response.
 */
const setTokenCookies = (res, accessToken, refreshToken) => {
  res.cookie("accessToken", accessToken, {
    ...cookieOptions,
    maxAge: 15 * 60 * 1000, // 15 minutes
  });

  res.cookie("refreshToken", refreshToken, {
    ...cookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
};

/**
 * Clear auth cookies on logout.
 * Using res.clearCookie is more reliable across browsers than maxAge: 0.
 * The options (httpOnly, secure, sameSite) must match exactly what was set.
 */
const clearTokenCookies = (res) => {
  res.clearCookie("accessToken", cookieOptions);
  res.clearCookie("refreshToken", cookieOptions);
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  setTokenCookies,
  clearTokenCookies,
};
