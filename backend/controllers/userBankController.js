const mongoose = require("mongoose");
const UserBank = require("../models/userBankModel");

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/user-banks
// ─────────────────────────────────────────────────────────────────────────────
const createUserBank = async (req, res) => {
  try {
    const { bankName, accountHolderName, accountNumber, ifscCode, branchName, accountType, isPrimary } = req.body;

    if (!bankName || !accountHolderName || !accountNumber || !ifscCode) {
      return res.status(400).json({ success: false, message: "Bank name, account holder, account number, and IFSC are required." });
    }

    const accountExists = await UserBank.findOne({ accountNumber });
    if (accountExists) {
      return res.status(409).json({ success: false, message: "Account number already exists." });
    }

    if (isPrimary) {
      await UserBank.updateMany({ customer: req.user._id }, { isPrimary: false });
    }

    const userBank = await UserBank.create({
      customer: req.user._id,
      bankName,
      accountHolderName,
      accountNumber,
      ifscCode: ifscCode.toUpperCase(),
      branchName,
      accountType,
      isPrimary: !!isPrimary,
    });

    const result = await UserBank.findById(userBank._id).populate("customer", "firstName lastName email");

    return res.status(201).json({ success: true, message: "Bank account added successfully.", userBank: result });
  } catch (error) {
    console.error("Create User Bank Error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/user-banks  (own banks)
// ─────────────────────────────────────────────────────────────────────────────
const getUserBanks = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, accountType, status, isPrimary, fromDate, toDate, sort } = req.query;

    const query = { customer: req.user._id };

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$or = [
        { accountHolderName: { $regex: escaped, $options: "i" } },
        { accountNumber: { $regex: escaped, $options: "i" } },
        { ifscCode: { $regex: escaped, $options: "i" } },
      ];
    }

    if (accountType) query.accountType = accountType;
    if (status) query.status = status;
    if (isPrimary !== undefined) query.isPrimary = isPrimary === "true";

    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) query.createdAt.$gte = new Date(fromDate);
      if (toDate) query.createdAt.$lte = new Date(toDate);
    }

    const sortMap = {
      name: { accountHolderName: 1 },
      "-name": { accountHolderName: -1 },
      createdAt: { createdAt: 1 },
    };
    const sortOption = sortMap[sort] || { createdAt: -1 };

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));

    const [total, userBanks] = await Promise.all([
      UserBank.countDocuments(query),
      UserBank.find(query)
        .populate("customer", "firstName lastName email")
        .sort(sortOption)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
    ]);

    return res.status(200).json({
      success: true,
      total,
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum),
      userBanks,
    });
  } catch (error) {
    console.error("Get User Banks Error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/user-banks/all  (admin only — enforced in route)
// ─────────────────────────────────────────────────────────────────────────────
const getAllUserBanks = async (req, res) => {
  try {
    const userBanks = await UserBank.find()
      .populate("customer", "firstName lastName email mobileNumber")
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, count: userBanks.length, userBanks });
  } catch (error) {
    console.error("Get All User Banks Error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/user-banks/:id  (own bank)
// ─────────────────────────────────────────────────────────────────────────────
const getUserBankById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid bank ID." });
    }

    const userBank = await UserBank.findOne({ _id: id, customer: req.user._id })
      .populate("customer", "firstName lastName email");

    if (!userBank) {
      return res.status(404).json({ success: false, message: "Bank account not found." });
    }

    return res.status(200).json({ success: true, userBank });
  } catch (error) {
    console.error("Get User Bank By ID Error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/user-banks/:id  (own bank)
// ─────────────────────────────────────────────────────────────────────────────
const updateUserBank = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid bank ID." });
    }

    const userBank = await UserBank.findOne({ _id: id, customer: req.user._id });
    if (!userBank) {
      return res.status(404).json({ success: false, message: "Bank account not found." });
    }

    const { bankName, accountHolderName, accountNumber, ifscCode, branchName, accountType, isPrimary, status } = req.body;

    if (accountNumber && accountNumber !== userBank.accountNumber) {
      const existing = await UserBank.findOne({ accountNumber, _id: { $ne: id } });
      if (existing) {
        return res.status(409).json({ success: false, message: "Account number already registered." });
      }
    }

    if (isPrimary === true) {
      await UserBank.updateMany({ customer: req.user._id, _id: { $ne: id } }, { isPrimary: false });
    }

    if (bankName) userBank.bankName = bankName;
    if (accountHolderName) userBank.accountHolderName = accountHolderName;
    if (accountNumber) userBank.accountNumber = accountNumber;
    if (ifscCode) userBank.ifscCode = ifscCode.toUpperCase();
    if (branchName) userBank.branchName = branchName;
    if (accountType) userBank.accountType = accountType;
    if (typeof isPrimary !== "undefined") userBank.isPrimary = isPrimary;
    if (status) userBank.status = status;

    await userBank.save();

    const updated = await UserBank.findById(userBank._id).populate("customer", "firstName lastName email");

    return res.status(200).json({ success: true, message: "Bank account updated successfully.", userBank: updated });
  } catch (error) {
    console.error("Update User Bank Error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/user-banks/:id  (own bank)
// ─────────────────────────────────────────────────────────────────────────────
const deleteUserBank = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid bank ID." });
    }

    const userBank = await UserBank.findOneAndDelete({ _id: id, customer: req.user._id });
    if (!userBank) {
      return res.status(404).json({ success: false, message: "Bank account not found." });
    }

    return res.status(200).json({ success: true, message: "Bank account deleted successfully." });
  } catch (error) {
    console.error("Delete User Bank Error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/user-banks/:id/status  (own bank)
// ─────────────────────────────────────────────────────────────────────────────
const updateUserBankStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!["Active", "Inactive"].includes(status)) {
      return res.status(400).json({ success: false, message: "Status must be Active or Inactive." });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid bank ID." });
    }

    const userBank = await UserBank.findOne({ _id: id, customer: req.user._id });
    if (!userBank) {
      return res.status(404).json({ success: false, message: "Bank account not found." });
    }

    userBank.status = status;
    await userBank.save();

    return res.status(200).json({
      success: true,
      message: `Bank account ${status === "Active" ? "activated" : "deactivated"} successfully.`,
      userBank,
    });
  } catch (error) {
    console.error("Update User Bank Status Error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/user-banks/:id/primary  (own bank)
// ─────────────────────────────────────────────────────────────────────────────
const makePrimaryBank = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid bank ID." });
    }

    const userBank = await UserBank.findOne({ _id: id, customer: req.user._id });
    if (!userBank) {
      return res.status(404).json({ success: false, message: "Bank account not found." });
    }

    await UserBank.updateMany({ customer: req.user._id }, { isPrimary: false });
    userBank.isPrimary = true;
    await userBank.save();

    return res.status(200).json({ success: true, message: "Primary bank updated successfully.", userBank });
  } catch (error) {
    console.error("Make Primary Bank Error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/user-banks/customer/:customerId  (seller or admin)
// ─────────────────────────────────────────────────────────────────────────────
const getCustomerBankDetails = async (req, res) => {
  try {
    const { customerId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({ success: false, message: "Invalid customer ID." });
    }

    const bank = await UserBank.findOne({ customer: customerId })
      .populate("customer", "firstName lastName email");

    if (!bank) {
      return res.status(404).json({ success: false, message: "Bank details not found." });
    }

    return res.status(200).json({ success: true, bank });
  } catch (error) {
    console.error("Get Customer Bank Details Error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/user-banks/seller/:id  (seller — hide from their dashboard)
// ─────────────────────────────────────────────────────────────────────────────
const removeCustomerBankFromSeller = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid bank ID." });
    }

    const userBank = await UserBank.findById(id);
    if (!userBank) {
      return res.status(404).json({ success: false, message: "Bank account not found." });
    }

    const alreadyHidden = userBank.hiddenForSellers.some(
      (sid) => sid.toString() === req.user._id.toString()
    );

    if (!alreadyHidden) {
      userBank.hiddenForSellers.push(req.user._id);
      await userBank.save();
    }

    return res.status(200).json({ success: true, message: "Bank account hidden from your dashboard." });
  } catch (error) {
    console.error("Remove Customer Bank From Seller Error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error." });
  }
};

module.exports = {
  createUserBank,
  getUserBanks,
  getAllUserBanks,
  getUserBankById,
  updateUserBank,
  deleteUserBank,
  updateUserBankStatus,
  makePrimaryBank,
  getCustomerBankDetails,
  removeCustomerBankFromSeller,
};
