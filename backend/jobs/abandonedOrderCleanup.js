const cron = require("node-cron");
const Order = require("../models/order");
const Product = require("../models/productModel");

// ─────────────────────────────────────────────────────────────────────────────
// ABANDONED ORDER CLEANUP — CRON JOB
//
// Runs every 15 minutes.
// Finds all orders that are:
//   - orderStatus  : PENDING
//   - paymentStatus: pending
//   - createdAt    : older than 30 minutes
//
// For each such order → restores stock + marks CANCELLED.
//
// This is the DB-backed safety net that survives server restarts.
// The in-process setTimeout in ordersController is the "fast path" for
// the common case; this cron is the "guaranteed cleanup" fallback.
// ─────────────────────────────────────────────────────────────────────────────

const PAYMENT_TIMEOUT_MINUTES = 30;

const runCleanup = async () => {
  try {
    const cutoff = new Date(Date.now() - PAYMENT_TIMEOUT_MINUTES * 60 * 1000);

    // Find all abandoned orders in one query
    const abandonedOrders = await Order.find({
      orderStatus: "PENDING",
      paymentStatus: "pending",
      createdAt: { $lt: cutoff },
    });

    if (abandonedOrders.length === 0) return;

    console.log(`[Cron] Found ${abandonedOrders.length} abandoned order(s) to clean up.`);

    for (const order of abandonedOrders) {
      try {
        // Restore stock for every item in this order
        for (const item of order.items) {
          await Product.findByIdAndUpdate(item.product, {
            $inc: { stock: item.quantity },
          });
        }

        order.orderStatus = "CANCELLED";
        order.cancelReason = "Payment not received within the allowed time";
        await order.save();

        console.log(`[Cron] Abandoned order ${order.orderNumber} cancelled and stock restored.`);
      } catch (itemErr) {
        // Don't let one bad order stop the rest from being processed
        console.error(`[Cron] Failed to clean up order ${order.orderNumber}:`, itemErr.message);
      }
    }
  } catch (err) {
    console.error("[Cron] abandonedOrderCleanup job error:", err.message);
  }
};

/**
 * Starts the cron job.
 * Called once from server.js after DB connection is established.
 *
 * Schedule: every 15 minutes  →  "0,15,30,45 * * * *"
 * This ensures no abandoned order lives more than ~45 min in the worst case
 * (order created 1 sec after a cron tick + 30 min timeout + 15 min next tick).
 */
const startAbandonedOrderCleanupJob = () => {
  cron.schedule("0,15,30,45 * * * *", runCleanup, {
    timezone: "Asia/Kolkata",
  });

  console.log("[Cron] Abandoned order cleanup job scheduled (every 15 min).");
};

module.exports = { startAbandonedOrderCleanupJob };
