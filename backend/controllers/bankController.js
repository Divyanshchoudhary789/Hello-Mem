const Bank = require("../models/bankModel");

// Escape user input before using in regex to prevent ReDoS
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ==============================
// CREATE BANK
// ==============================

const createBank = async (req, res) => {
  try {
    const {
      bankName,
      ifscCode,
      country,
      branches,
      status,
    } = req.body;

    if (!bankName || !ifscCode) {
      return res.status(400).json({
        success: false,
        message: "Bank name and IFSC Code are required.",
      });
    }

    const existingBank = await Bank.findOne({
      $or: [
        {
          bankName: {
            $regex: `^${escapeRegex(bankName)}$`,
            $options: "i",
          },
        },
        {
          ifscCode: ifscCode.toUpperCase(),
        },
      ],
    });

    if (existingBank) {
      return res.status(400).json({
        success: false,
        message: "Bank already exists.",
      });
    }

    const bank = await Bank.create({
      bankName,
      ifscCode: ifscCode.toUpperCase(),
      country,
      branches,
      status,
    });

    res.status(201).json({
      success: true,
      message: "Bank created successfully.",
      bank,
    });
  } catch (error) {
    console.error("Create Bank Error:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==============================
// GET ALL BANKS
// ==============================

const getBanks = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      bankId,
      bankName,
      ifscCode,
      country,
      status,
      fromDate,
      toDate,
      sort,
    } = req.query;

    const query = {};

    if (search) {
      query.$or = [
        {
          bankName: {
            $regex: search,
            $options: "i",
          },
        },
        {
          bankId: {
            $regex: search,
            $options: "i",
          },
        },
        {
          ifscCode: {
            $regex: search,
            $options: "i",
          },
        },
      ];
    }

    if (bankId) {
      query.bankId = {
        $regex: bankId,
        $options: "i",
      };
    }

    if (bankName) {
      query.bankName = {
        $regex: bankName,
        $options: "i",
      };
    }

    if (ifscCode) {
      query.ifscCode = {
        $regex: ifscCode,
        $options: "i",
      };
    }

    if (country) {
      query.country = {
        $regex: country,
        $options: "i",
      };
    }

    if (status) {
      query.status = status;
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
      case "bankName":
        sortOption = {
          bankName: 1,
        };
        break;

      case "-bankName":
        sortOption = {
          bankName: -1,
        };
        break;

      case "branches":
        sortOption = {
          branches: 1,
        };
        break;

      case "-branches":
        sortOption = {
          branches: -1,
        };
        break;

      default:
        sortOption = {
          createdAt: -1,
        };
    }

    const total = await Bank.countDocuments(query);

    const banks = await Bank.find(query)
      .sort(sortOption)
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.status(200).json({
      success: true,
      total,
      currentPage: Number(page),
      totalPages: Math.ceil(total / limit),
      banks,
    });
  } catch (error) {
    console.error("Get Banks Error:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==============================
// GET SINGLE BANK
// ==============================

const getBankById = async (req, res) => {
  try {
    const bank = await Bank.findById(req.params.id);

    if (!bank) {
      return res.status(404).json({
        success: false,
        message: "Bank not found.",
      });
    }

    res.status(200).json({
      success: true,
      bank,
    });
  } catch (error) {
    console.error("Get Bank Error:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const updateBank = async (req, res) => {
  try {
    const { id } = req.params;

    const bank = await Bank.findById(id);

    if (!bank) {
      return res.status(404).json({
        success: false,
        message: "Bank not found.",
      });
    }

    if (req.body.bankName) {
      const existing = await Bank.findOne({
        bankName: {
          $regex: `^${escapeRegex(req.body.bankName)}$`,
          $options: "i",
        },
        _id: { $ne: id },
      });

      if (existing) {
        return res.status(400).json({
          success: false,
          message: "Bank name already exists.",
        });
      }
    }

    if (req.body.ifscCode) {
      const existingIfsc = await Bank.findOne({
        ifscCode: req.body.ifscCode.toUpperCase(),
        _id: {
          $ne: id,
        },
      });

      if (existingIfsc) {
        return res.status(400).json({
          success: false,
          message: "IFSC already exists.",
        });
      }

      req.body.ifscCode = req.body.ifscCode.toUpperCase();
    }

    const updatedBank = await Bank.findByIdAndUpdate(
      id,
      req.body,
      {
        new: true,
        runValidators: true,
      }
    );

    res.status(200).json({
      success: true,
      message: "Bank updated successfully.",
      bank: updatedBank,
    });
  } catch (error) {
  console.error(error.stack);

  res.status(500).json({
    success: false,
    message: error.message,
  });
}
};

const deleteBank = async (req, res) => {
  try {
    const bank = await Bank.findById(req.params.id);

    if (!bank) {
      return res.status(404).json({
        success: false,
        message: "Bank not found.",
      });
    }

    await bank.deleteOne();

    res.status(200).json({
      success: true,
      message: "Bank deleted successfully.",
    });
  } catch (error) {
    console.error("Delete Bank Error:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const updateBankStatus = async (req, res) => {
  try {
    const { status } = req.body;

    const bank = await Bank.findById(req.params.id);

    if (!bank) {
      return res.status(404).json({
        success: false,
        message: "Bank not found.",
      });
    }

    bank.status = status;

    await bank.save();

    res.status(200).json({
      success: true,
      message: `Bank ${
        status === "Active"
          ? "activated"
          : "deactivated"
      } successfully.`,
      bank,
    });
  } catch (error) {
    console.error("Update Bank Status Error:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  createBank,
  getBanks,
  getBankById,
  updateBank,
  deleteBank,
  updateBankStatus,
};