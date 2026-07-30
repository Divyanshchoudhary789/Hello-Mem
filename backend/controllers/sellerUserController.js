const Order = require("../models/order");
const Customer = require("../models/customers");

const getCustomers = async (req, res) => {
  try {
    const sellerId = req.user._id;

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const search = req.query.search || "";

    const pipeline = [
      {
        $match: {
          "items.seller": sellerId,
        },
      },

      {
        $group: {
          _id: "$customer.customerId",

          customer: {
            $first: "$customer",
          },

          totalOrders: {
            $sum: 1,
          },

          totalSpent: {
            $sum: "$pricing.total",
          },

          lastOrderDate: {
            $max: "$createdAt",
          },
        },
      },
    ];

    if (search) {
      pipeline.push({
        $match: {
          $or: [
            {
              "customer.name": {
                $regex: search,
                $options: "i",
              },
            },
            {
              "customer.email": {
                $regex: search,
                $options: "i",
              },
            },
            {
              "customer.phone": {
                $regex: search,
                $options: "i",
              },
            },
          ],
        },
      });
    }

    pipeline.push(
      {
        $sort: {
          lastOrderDate: -1,
        },
      },
      {
        $facet: {
          customers: [
            {
              $skip: (page - 1) * limit,
            },
            {
              $limit: limit,
            },
          ],

          total: [
            {
              $count: "count",
            },
          ],
        },
      }
    );

    const result = await Order.aggregate(pipeline);

    const customers = result[0].customers;

    const totalCustomers =
      result[0].total.length > 0
        ? result[0].total[0].count
        : 0;

    return res.status(200).json({
      success: true,
      currentPage: page,
      totalPages: Math.ceil(totalCustomers / limit),
      totalCustomers,
      customers,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getCustomerDetails = async (req, res) => {
  try {
    const sellerId = req.user._id;
    const customerId = req.params.customerId;

    const customer = await Customer.findById(customerId);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    const orders = await Order.find({
      "customer.customerId": customerId,
      "items.seller": sellerId,
    });

    const totalOrders = orders.length;

    const totalSpent = orders.reduce(
      (sum, order) => sum + order.pricing.total,
      0
    );

    return res.json({
      success: true,
      customer,
      stats: {
        totalOrders,
        totalSpent,
      },
      orders,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getCustomerDashboard = async (req, res) => {
  try {
    const sellerId = req.user._id;

    const totalCustomers = await Order.distinct(
      "customer.customerId",
      {
        "items.seller": sellerId,
      }
    );

    const thisMonth = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1
    );

    const newCustomers = await Order.distinct(
      "customer.customerId",
      {
        "items.seller": sellerId,
        createdAt: {
          $gte: thisMonth,
        },
      }
    );

    return res.json({
      success: true,
      dashboard: {
        totalCustomers: totalCustomers.length,
        newCustomers: newCustomers.length,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  getCustomers,
  getCustomerDetails,
  getCustomerDashboard,
};