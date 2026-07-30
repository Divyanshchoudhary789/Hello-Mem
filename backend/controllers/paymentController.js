const Payment = require("../models/Payment");
const Order = require("../models/order");
const Product = require("../models/productModel");
const mongoose = require("mongoose");
const { razorpay, createOrder: createRazorpayOrderApi, verifyPaymentSignature, verifyWebhookSignature } = require("../config/razorpay.config");

// Restore stock and cancel an order that failed payment
const cancelAbandonedOrder = async (orderId) => {
  try {
    const order = await Order.findById(orderId);
    if (!order || order.paymentStatus === "paid" || order.orderStatus === "CANCELLED") return;

    for (const item of order.items) {
      await Product.findByIdAndUpdate(item.product, {
        $inc: { stock: item.quantity },
      });
    }

    order.orderStatus = "CANCELLED";
    order.cancelReason = "Payment failed";
    await order.save();

    console.log(`[Payment] Order ${order.orderNumber} cancelled and stock restored (payment failed).`);
  } catch (err) {
    console.error(`[Payment] cancelAbandonedOrder failed for ${orderId}:`, err.message);
  }
};

const createRazorpayOrder = async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID",
      });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (order.customer.customerId.toString() !== req.user.id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Not authorized for this order",
      });
    }

    if (order.paymentStatus === "paid") {
      return res.status(400).json({
        success: false,
        message: "Order already paid",
      });
    }

    // Order was auto-cancelled (timeout) or manually cancelled — cannot pay for it
    if (order.orderStatus === "CANCELLED") {
      return res.status(400).json({
        success: false,
        message: "This order has been cancelled. Please place a new order.",
      });
    }

    const existingPayment = await Payment.findOne({
      order: order._id,
      status: "pending",
    });

    if (existingPayment) {
      // User already initiated payment but didn't complete it.
      // Return the same Razorpay order so the frontend can resume checkout
      // without creating a duplicate. This is not an error — it's a resume.
      return res.status(200).json({
        success: true,
        resumed: true,
        keyId: process.env.RAZORPAY_KEY_ID,
        razorpayOrder: {
          id: existingPayment.razorpayOrderId,
          amount: Math.round(existingPayment.amount * 100),
          currency: existingPayment.currency,
        },
        amount: existingPayment.amount,
      });
    }

    const amountInPaisa = Math.round(order.pricing.total * 100);

    const razorpayOrder = await createRazorpayOrderApi({
      amount: amountInPaisa,
      currency: "INR",
      receipt: order._id.toString(),
      notes: { orderNumber: order.orderNumber || "" },
    });

    const payment = await Payment.create({
      order: order._id,
      customer: req.user._id,
      amount: order.pricing.total,
      currency: "INR",
      receipt: order._id.toString(),
      paymentMethod: "razorpay",
      razorpayOrderId: razorpayOrder.id,
      transactionId: razorpayOrder.id,
      status: "pending",
    });

    order.payment = payment._id;
    await order.save();

    res.status(200).json({
      success: true,
      keyId: process.env.RAZORPAY_KEY_ID,
      razorpayOrder,
      amount: order.pricing.total,
    });
  } catch (error) {
    console.error("Create Razorpay Order error:", error.message);
    const message = error.error?.description || error.message || "Failed to create Razorpay order";
    res.status(500).json({
      success: false,
      message,
    });
  }
};

const verifyRazorpayPayment = async (req, res) => {
  try {
    const { orderId, razorpayPaymentId, razorpayOrderId, razorpaySignature } = req.body;

    if (!orderId || !razorpayPaymentId || !razorpayOrderId || !razorpaySignature) {
      return res.status(400).json({
        success: false,
        message: "Missing required verification fields",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }

    // Ensure this order belongs to the requesting customer
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (order.customer.customerId.toString() !== req.user.id.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized for this order" });
    }

    const isValid = verifyPaymentSignature({
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    });

    if (!isValid) {
      await Payment.findOneAndUpdate(
        { razorpayOrderId },
        { status: "failed" }
      );
      await Order.findByIdAndUpdate(orderId, { paymentStatus: "failed" });
      // Cancel the order and restore stock since payment definitively failed
      await cancelAbandonedOrder(orderId);

      return res.status(400).json({
        success: false,
        message: "Payment verification failed (signature mismatch)",
      });
    }

    const payment = await Payment.findOneAndUpdate(
      { razorpayOrderId },
      {
        razorpayPaymentId,
        transactionId: razorpayPaymentId,
        razorpaySignature,
        status: "success",
        paidAt: new Date(),
      },
      { new: true }
    );

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment record not found",
      });
    }

    await Order.findByIdAndUpdate(orderId, {
      paymentStatus: "paid",
      orderStatus: "CONFIRMED",
    });

    res.status(200).json({
      success: true,
      message: "Payment verified successfully",
      payment,
    });
  } catch (error) {
    console.error("Verify Razorpay Payment error:", error.message);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getPaymentDetails = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment ID",
      });
    }

    const payment = await Payment.findById(req.params.id).populate("order", "orderNumber paymentStatus customer");

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    // Admin can see any payment; customer can only see their own
    if (req.user.role === "customer") {
      const orderCustomerId = payment.order?.customer?.customerId?.toString();
      if (orderCustomerId && orderCustomerId !== req.user.id.toString()) {
        return res.status(403).json({ success: false, message: "Not authorized to view this payment" });
      }
    }

    res.status(200).json({
      success: true,
      payment,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const handleRazorpayWebhook = async (req, res) => {
  try {
    const signature = req.headers["x-razorpay-signature"];

    if (!signature) {
      return res.status(400).json({ success: false, message: "Missing Razorpay signature" });
    }

    // req.body is a raw Buffer here (express.raw middleware in server.js)
    const rawBody = req.body instanceof Buffer ? req.body : Buffer.from(JSON.stringify(req.body));
    const isValid = verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      return res.status(400).json({ success: false, message: "Invalid webhook signature" });
    }

    const event = JSON.parse(rawBody.toString());
    const eventType = event.event;

    let handled = false;

    if (eventType === "order.paid") {
      const orderEntity = event.payload?.order?.entity;
      const paymentEntity = event.payload?.payment?.entity;

      if (orderEntity) {
        const payment = await Payment.findOne({
          razorpayOrderId: orderEntity.id,
        });

        if (payment && payment.status !== "success") {
          await Payment.findOneAndUpdate(
            { razorpayOrderId: orderEntity.id },
            {
              razorpayPaymentId: paymentEntity?.id || payment.razorpayPaymentId,
              transactionId: paymentEntity?.id || payment.transactionId,
              status: "success",
              paidAt: paymentEntity?.created_at ? new Date(paymentEntity.created_at * 1000) : new Date(),
            }
          );

          await Order.findOneAndUpdate(
            { payment: payment._id },
            {
              paymentStatus: "paid",
              orderStatus: "CONFIRMED",
            }
          );

          handled = true;
        }
      }
    } else if (eventType === "payment.failed" || eventType === "order.failed") {
      const orderEntity = event.payload?.order?.entity;

      if (orderEntity) {
        const payment = await Payment.findOne({
          razorpayOrderId: orderEntity.id,
        });

        if (payment && payment.status !== "failed" && payment.status !== "success") {
          await Payment.findOneAndUpdate(
            { razorpayOrderId: orderEntity.id },
            { status: "failed" }
          );

          const failedOrder = await Order.findOneAndUpdate(
            { payment: payment._id },
            { paymentStatus: "failed" },
            { new: true }
          );

          // Restore stock and cancel the order
          if (failedOrder) {
            await cancelAbandonedOrder(failedOrder._id);
          }

          handled = true;
        }
      }
    } else if (eventType === "payment.captured") {
      const paymentEntity = event.payload?.payment?.entity;

      if (paymentEntity) {
        const payment = await Payment.findOne({
          razorpayPaymentId: paymentEntity.id,
        });

        if (payment && payment.status !== "success") {
          await Payment.findOneAndUpdate(
            { razorpayPaymentId: paymentEntity.id },
            {
              status: "success",
              paidAt: new Date((paymentEntity.created_at || Date.now() / 1000) * 1000),
            }
          );

          await Order.findOneAndUpdate(
            { payment: payment._id },
            {
              paymentStatus: "paid",
              orderStatus: "CONFIRMED",
            }
          );

          handled = true;
        }
      }
    } else if (eventType === "refund.processed") {
      const paymentEntity = event.payload?.payment?.entity;
      const refundEntity = event.payload?.refund?.entity;

      if (refundEntity && refundEntity.id) {
        const payment = await Payment.findOne({
          razorpayPaymentId: refundEntity.payment_id,
        });

        if (payment) {
          const refundAmount = refundEntity.amount ? refundEntity.amount / 100 : 0;

          await Payment.findOneAndUpdate(
            { razorpayPaymentId: refundEntity.payment_id },
            {
              status: "refunded",
              $push: {
                refunds: {
                  refundId: refundEntity.id,
                  amount: refundAmount,
                  status: "processed",
                },
              },
            }
          );

          // Update the linked order
          const linkedOrder = await Order.findOneAndUpdate(
            { payment: payment._id },
            {
              paymentStatus: "refunded",
              $inc: { refundedAmount: refundAmount },
            },
            { new: true }
          );

          // Restore stock for refunded order
          if (linkedOrder) {
            for (const item of linkedOrder.items) {
              await Product.findByIdAndUpdate(item.product, {
                $inc: { stock: item.quantity },
              });
            }
          }

          handled = true;
        }
      }
    }

    res.status(200).json({
      success: true,
      handled,
      event: eventType,
    });
  } catch (error) {
    console.error("Razorpay Webhook error:", error.message);
    res.status(500).json({
      success: false,
      message: "Webhook processing failed",
    });
  }
};

// Initiate a refund via Razorpay (admin only)
const initiateRefund = async (req, res) => {
  try {
    const { orderId, amount, reason = "requested_by_customer" } = req.body;

    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    if (order.paymentStatus !== "paid") {
      return res.status(400).json({
        success: false,
        message: "Only paid orders can be refunded",
      });
    }

    const payment = await Payment.findOne({ order: order._id, status: "success" });
    if (!payment || !payment.razorpayPaymentId) {
      return res.status(404).json({
        success: false,
        message: "No successful Razorpay payment found for this order",
      });
    }

    // Refund amount in paisa — default to full order amount
    const refundAmountPaisa = amount
      ? Math.round(Number(amount) * 100)
      : Math.round(order.pricing.total * 100);

    const refund = await razorpay.payments.refund(payment.razorpayPaymentId, {
      amount: refundAmountPaisa,
      speed: "normal",
      notes: { orderId: orderId, reason },
    });

    const refundAmountINR = refund.amount / 100;

    // Update payment record immediately (webhook will also fire but this ensures
    // the record is updated even if webhook delivery is delayed)
    await Payment.findByIdAndUpdate(payment._id, {
      status: "refunded",
      $push: {
        refunds: {
          refundId: refund.id,
          amount: refundAmountINR,
          status: refund.status,
        },
      },
    });

    // Update order
    await Order.findByIdAndUpdate(orderId, {
      paymentStatus: "refunded",
      orderStatus: "RETURNED",
      $inc: { refundedAmount: refundAmountINR },
    });

    // Restore stock
    for (const item of order.items) {
      await Product.findByIdAndUpdate(item.product, {
        $inc: { stock: item.quantity },
      });
    }

    res.status(200).json({
      success: true,
      message: "Refund initiated successfully",
      refund: {
        refundId: refund.id,
        amount: refundAmountINR,
        status: refund.status,
      },
    });
  } catch (error) {
    console.error("Initiate Refund error:", error.message);
    const message = error.error?.description || error.message || "Failed to initiate refund";
    res.status(500).json({ success: false, message });
  }
};

module.exports = {
  createRazorpayOrder,
  verifyRazorpayPayment,
  getPaymentDetails,
  handleRazorpayWebhook,
  initiateRefund,
};
