const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
require("dotenv").config();

const connectDB = require("./config/db");
const { startAbandonedOrderCleanupJob } = require("./jobs/abandonedOrderCleanup");

const authRoutes = require("./routes/authRoutes");
const customerRoutes = require("./routes/customerRoutes");
const sellerRoutes = require("./routes/sellerRoutes");
const adminRoutes = require("./routes/adminRoutes");
const productRoutes = require("./routes/productRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const cartRoutes = require("./routes/cartRoutes");
const orderRoutes = require("./routes/orderRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const reviewRoutes = require("./routes/reviewRoutes");
const bulkUploadRoutes = require("./routes/bulkUploadRoutes");
const bankRoutes = require("./routes/bankRoutes");
const userBankRoutes = require("./routes/userBankRoutes");
const vendorPaymentRoutes = require("./routes/vendorPaymentRoutes");
const vendorCommissionRoutes = require("./routes/vendorCommissionRoutes");

const app = express();
connectDB();

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173" || "https://hellomem.com",
    credentials: true,
  })
);

// Raw body preserved for Razorpay webhook signature verification
app.use("/api/payments/webhook", express.raw({ type: "application/json" }));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// ── Health Check ──────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ message: "HelloMaam E-Commerce API is running." });
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);          // token refresh (customer, seller, admin)
app.use("/api/admin", adminRoutes);        // admin auth + management
app.use("/api/customer", customerRoutes);  // customer auth + profile
app.use("/api/sellers", sellerRoutes);     // seller auth + profile + products
app.use("/api/products", productRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/bulk-upload", bulkUploadRoutes);
app.use("/api/banks", bankRoutes);
app.use("/api/user-banks", userBankRoutes);
app.use("/api/vendor-payments", vendorPaymentRoutes);
app.use("/api/vendor-commissions", vendorCommissionRoutes);

// ── Global Error Handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err);
  res.status(500).json({
    success: false,
    message: "Something went wrong. Please try again.",
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running at port:${PORT}`);

  // Start cron jobs after the server (and DB) are ready
  startAbandonedOrderCleanupJob();
});
