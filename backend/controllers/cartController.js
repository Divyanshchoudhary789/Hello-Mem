const Cart = require("../models/cart");
const Product = require("../models/productModel");

// ===============================
// Add Product to Cart
// POST /api/cart/add
// ===============================
const addToCart = async (req, res) => {
  try {
    const customerId = req.user.id;
    const { productId, quantity = 1 } = req.body;

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: "Product ID is required",
      });
    }

    if (!Number.isInteger(quantity) || quantity < 1) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be a positive integer",
      });
    }

    const product = await Product.findById(productId);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Check if product is active
    if (!product.isActive) {
      return res.status(400).json({
        success: false,
        message: "Product is currently unavailable",
      });
    }

    // Check stock
    if (product.stock <= 0) {
      return res.status(400).json({
        success: false,
        message: "Product is out of stock",
      });
    }

    if (quantity > product.stock) {
      return res.status(400).json({
        success: false,
        message: "Requested quantity exceeds available stock",
      });
    }

    let cart = await Cart.findOne({ customer: customerId });

    if (!cart) {
      cart = new Cart({
        customer: customerId,
        items: [],
      });
    }

    const existingItem = cart.items.find(
      (item) => item.product.toString() === productId
    );

    if (existingItem) {
      const newQuantity = existingItem.quantity + quantity;

      if (newQuantity > product.stock) {
        return res.status(400).json({
          success: false,
          message: "Requested quantity exceeds available stock",
        });
      }

      existingItem.quantity = newQuantity;
    } else {
      cart.items.push({
        product: product._id,
        seller: product.seller,
        quantity,
      });
    }

    await cart.save();

    const formattedCart = await getFormattedCart(customerId);

    return res.status(200).json({
      success: true,
      message: "Product added to cart successfully",
      cart: formattedCart,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ===============================
// Get Cart
// GET /api/cart
// ===============================
const getCart = async (req, res) => {
  try {
    const customerId = req.user.id;

    const cart = await Cart.findOne({ customer: customerId }).populate({
      path: "items.product",
      select: "name price stock images slug",
    });

    if (!cart || cart.items.length === 0) {
      return res.status(200).json({
        success: true,
        totalItems: 0,
        grandTotal: 0,
        items: [],
      });
    }

    let grandTotal = 0;
    let totalItems = 0;

    const items = cart.items.map((item) => {
      const subtotal = item.product.price * item.quantity;

      grandTotal += subtotal;
      totalItems += item.quantity;

      return {
        product: item.product,
        seller: item.seller,
        quantity: item.quantity,
        subtotal,
      };
    });

    return res.status(200).json({
      success: true,
      totalItems,
      grandTotal,
      items,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getFormattedCart = async (customerId) => {
  const cart = await Cart.findOne({ customer: customerId }).populate({
    path: "items.product",
    select: "name price stock images slug",
  });

  if (!cart || cart.items.length === 0) {
    return {
      totalItems: 0,
      grandTotal: 0,
      items: [],
    };
  }

  let totalItems = 0;
  let grandTotal = 0;

  const items = cart.items.map((item) => {
    const subtotal = item.product.price * item.quantity;

    totalItems += item.quantity;
    grandTotal += subtotal;

    return {
      product: item.product,
      seller: item.seller,
      quantity: item.quantity,
      subtotal,
    };
  });

  return {
    totalItems,
    grandTotal,
    items,
  };
};

// ===============================
// Update Cart Item Quantity
// PATCH /api/cart/update/:productId
// ===============================
const updateCartItem = async (req, res) => {
  try {
    const customerId = req.user.id;
    const { productId } = req.params;
    const { quantity } = req.body;

    if (!quantity || quantity < 1) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be at least 1",
      });
    }

    const product = await Product.findById(productId);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    if (quantity > product.stock) {
      return res.status(400).json({
        success: false,
        message: "Insufficient stock",
      });
    }

    const cart = await Cart.findOne({ customer: customerId });

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      });
    }

    const item = cart.items.find(
      (item) => item.product.toString() === productId
    );

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Product not found in cart",
      });
    }

    item.quantity = quantity;

    await cart.save();

    const formattedCart = await getFormattedCart(customerId);

    return res.status(200).json({
        success: true,
        message: "Cart updated successfully",
        cart: formattedCart,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ===============================
// Remove Product from Cart
// DELETE /api/cart/remove/:productId
// ===============================
const removeCartItem = async (req, res) => {
  try {
    const customerId = req.user.id;
    const { productId } = req.params;

    const cart = await Cart.findOne({ customer: customerId });

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      });
    }

    cart.items = cart.items.filter(
      (item) => item.product.toString() !== productId
    );

    await cart.save();

    const formattedCart = await getFormattedCart(customerId);

    return res.status(200).json({
        success: true,
        message: "Item removed from cart",
        cart: formattedCart,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ===============================
// Clear Cart
// DELETE /api/cart/clear
// ===============================
const clearCart = async (req, res) => {
  try {
    const customerId = req.user.id;

    await Cart.findOneAndUpdate(
      { customer: customerId },
      { items: [] },
      { new: true }
    );

    return res.status(200).json({
    success: true,
    message: "Cart cleared successfully",
    cart: {
        totalItems: 0,
        grandTotal: 0,
        items: []
    }
});
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  addToCart,
  getCart,
  updateCartItem,
  removeCartItem,
  clearCart,
};