const mongoose = require("mongoose");
const Category = require("../models/category");
const slugify = require("slugify");

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/categories  (admin only)
// ─────────────────────────────────────────────────────────────────────────────
const createCategory = async (req, res) => {
  try {
    const { name, description, parentCategory, displayOrder, isFeatured } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: "Category name is required." });
    }

    if (parentCategory && !mongoose.Types.ObjectId.isValid(parentCategory)) {
      return res.status(400).json({ success: false, message: "Invalid parent category ID." });
    }

    const slug = slugify(name.trim(), { lower: true, strict: true });

    const existingCategory = await Category.findOne({ slug });
    if (existingCategory) {
      return res.status(409).json({ success: false, message: "A category with this name already exists." });
    }

    const category = await Category.create({
      name: name.trim(),
      slug,
      description: description?.trim() || "",
      parentCategory: parentCategory || null,
      displayOrder: displayOrder || 0,
      isFeatured: !!isFeatured,
      // createdBy is admin — stored as null since admin has no ObjectId in DB
      createdBy: null,
    });

    return res.status(201).json({ success: true, message: "Category created successfully.", data: category });
  } catch (error) {
    console.error("Create Category Error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/categories  (public)
// ─────────────────────────────────────────────────────────────────────────────
const getAllCategories = async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true })
      .populate("parentCategory", "name slug")
      .sort({ displayOrder: 1, createdAt: -1 });

    return res.status(200).json({ success: true, count: categories.length, data: categories });
  } catch (error) {
    console.error("Get Categories Error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/categories/:id  (public)
// ─────────────────────────────────────────────────────────────────────────────
const getCategoryById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid category ID." });
    }

    const category = await Category.findById(id).populate("parentCategory", "name slug");

    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found." });
    }

    return res.status(200).json({ success: true, data: category });
  } catch (error) {
    console.error("Get Category Error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/categories/:id  (admin only)
// ─────────────────────────────────────────────────────────────────────────────
const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid category ID." });
    }

    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found." });
    }

    const { name, description, parentCategory, displayOrder, isFeatured, isActive } = req.body;

    if (name && name.trim() !== category.name) {
      const slug = slugify(name.trim(), { lower: true, strict: true });

      const existing = await Category.findOne({ slug, _id: { $ne: id } });
      if (existing) {
        return res.status(409).json({ success: false, message: "A category with this name already exists." });
      }

      category.name = name.trim();
      category.slug = slug;
    }

    if (description !== undefined) category.description = description.trim();
    if (parentCategory !== undefined) {
      if (parentCategory && !mongoose.Types.ObjectId.isValid(parentCategory)) {
        return res.status(400).json({ success: false, message: "Invalid parent category ID." });
      }
      category.parentCategory = parentCategory || null;
    }
    if (displayOrder !== undefined) category.displayOrder = displayOrder;
    if (isFeatured !== undefined) category.isFeatured = isFeatured;
    if (isActive !== undefined) category.isActive = isActive;

    await category.save();

    return res.status(200).json({ success: true, message: "Category updated successfully.", data: category });
  } catch (error) {
    console.error("Update Category Error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error." });
  }
};

module.exports = { createCategory, getAllCategories, getCategoryById, updateCategory };
