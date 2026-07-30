const VendorCommission = require("../models/vendorCommissionModel");
const Category = require("../models/category");

const createVendorCommission = async (req, res) => {
  try {
    const {
      seller,
      category,
      commissionType,
      commissionValue,
      gst,
      remarks,
    } = req.body;

    if (!seller || !category || !commissionValue) {
      return res.status(400).json({
        success: false,
        message: "Please fill all required fields.",
      });
    }

    const categoryExists = await Category.findById(category);

    if (!categoryExists) {
      return res.status(404).json({
        success: false,
        message: "Category not found.",
      });
    }

    const existingCommission =
      await VendorCommission.findOne({
        seller,
        category,
      });

    if (existingCommission) {
      return res.status(400).json({
        success: false,
        message:
          "Commission already exists for this category.",
      });
    }

    const commission =
      await VendorCommission.create({
        seller,
        category,
        commissionType,
        commissionValue,
        gst,
        remarks,
      });

    const result = await VendorCommission.findById(
      commission._id
    )
      .populate(
        "seller",
        "firstName lastName email businessName"
      )
      .populate("category", "name");

    res.status(201).json({
      success: true,
      message: "Vendor commission created successfully.",
      commission: result,
    });
  } catch (error) {
    console.error("Create Commission:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getVendorCommissions = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      commissionType,
      status,
      search,
      fromDate,
      toDate,
      sort,
    } = req.query;

    const query = {};

    if (commissionType) {
      query.commissionType = commissionType;
    }

    if (status) {
      query.status = status;
    }

    if (search) {
      query.$or = [
        {
          commissionId: {
            $regex: search,
            $options: "i",
          },
        },
        {
          remarks: {
            $regex: search,
            $options: "i",
          },
        },
      ];
    }

    if (fromDate || toDate) {
      query.createdAt = {};

      if (fromDate) {
        query.createdAt.$gte = new Date(fromDate);
      }

      if (toDate) {
        query.createdAt.$lte = new Date(toDate);
      }
    }

    let sortOption = {
      createdAt: -1,
    };

    switch (sort) {
      case "commission":
        sortOption = {
          commissionValue: 1,
        };
        break;

      case "-commission":
        sortOption = {
          commissionValue: -1,
        };
        break;

      default:
        sortOption = {
          createdAt: -1,
        };
    }

    const total =
      await VendorCommission.countDocuments(query);

    const commissions =
      await VendorCommission.find(query)
        .populate(
          "seller",
          "firstName lastName email businessName"
        )
        .populate("category", "name")
        .sort(sortOption)
        .skip((page - 1) * Number(limit))
        .limit(Number(limit));

    res.status(200).json({
      success: true,
      total,
      currentPage: Number(page),
      totalPages: Math.ceil(total / limit),
      commissions,
    });
  } catch (error) {
    console.error("Get Commissions:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getVendorCommissionById = async (req, res) => {
  try {
    const commission =
      await VendorCommission.findById(req.params.id)
        .populate(
          "seller",
          "firstName lastName email businessName"
        )
        .populate("category", "name");

    if (!commission) {
      return res.status(404).json({
        success: false,
        message: "Vendor commission not found.",
      });
    }

    res.status(200).json({
      success: true,
      commission,
    });
  } catch (error) {
    console.error("Get Commission:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const updateVendorCommission = async (req, res) => {
  try {
    const { id } = req.params;

    const commission = await VendorCommission.findById(id);

    if (!commission) {
      return res.status(404).json({
        success: false,
        message: "Vendor commission not found.",
      });
    }

    const {
      seller,
      category,
      commissionType,
      commissionValue,
      gst,
      remarks,
      status,
    } = req.body;

    if (seller) commission.seller = seller;

    if (category) {
      const categoryExists = await Category.findById(category);

      if (!categoryExists) {
        return res.status(404).json({
          success: false,
          message: "Category not found.",
        });
      }

      commission.category = category;
    }

    if (commissionType)
      commission.commissionType = commissionType;

    if (commissionValue !== undefined)
      commission.commissionValue = commissionValue;

    if (gst !== undefined)
      commission.gst = gst;

    if (remarks !== undefined)
      commission.remarks = remarks;

    if (status)
      commission.status = status;

    await commission.save();

    const updatedCommission =
      await VendorCommission.findById(commission._id)
        .populate(
          "seller",
          "firstName lastName email businessName"
        )
        .populate("category", "name");

    res.status(200).json({
      success: true,
      message: "Vendor commission updated successfully.",
      commission: updatedCommission,
    });
  } catch (error) {
    console.error("Update Commission:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const deleteVendorCommission = async (req, res) => {
  try {
    const commission = await VendorCommission.findById(
      req.params.id
    );

    if (!commission) {
      return res.status(404).json({
        success: false,
        message: "Vendor commission not found.",
      });
    }

    await commission.deleteOne();

    res.status(200).json({
      success: true,
      message: "Vendor commission deleted successfully.",
    });
  } catch (error) {
    console.error("Delete Commission:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const updateVendorCommissionStatus = async (req, res) => {
  try {
    const { status } = req.body;

    const commission = await VendorCommission.findById(
      req.params.id
    );

    if (!commission) {
      return res.status(404).json({
        success: false,
        message: "Vendor commission not found.",
      });
    }

    commission.status = status;

    await commission.save();

    res.status(200).json({
      success: true,
      message: `Vendor commission ${
        status === "Active"
          ? "activated"
          : "deactivated"
      } successfully.`,
      commission,
    });
  } catch (error) {
    console.error("Update Commission Status:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  createVendorCommission,
  getVendorCommissions,
  getVendorCommissionById,
  updateVendorCommission,
  deleteVendorCommission,
  updateVendorCommissionStatus,
};