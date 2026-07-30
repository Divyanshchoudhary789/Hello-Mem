const ExcelJS = require("exceljs");
const slugify = require("slugify");

const Product = require("../models/productModel");
const Category = require("../models/category");
const UploadHistory = require("../models/UploadHistory");

// ─────────────────────────────────────────────────────────────────────────────
// Helper: ExcelJS cell values can be plain scalars, RichText objects, or
// formula objects. This normalises all of them to a trimmed string.
// ─────────────────────────────────────────────────────────────────────────────
function cellToString(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if (Array.isArray(value.richText))
      return value.richText.map((r) => r.text ?? "").join("").trim();
    if (value.text !== undefined) return String(value.text).trim();
    if (value.result !== undefined) return String(value.result).trim();
    return "";
  }
  return String(value).trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalise any incoming column header to a canonical key regardless of the
// casing or spacing used in the uploaded file.
//
// Maps lowercase/trimmed header → canonical key used throughout the controller.
// This makes the upload work with:
//   • PascalCase  : "Name", "SKU", "TaxType"
//   • camelCase   : "name", "sku", "taxType"
//   • snake_case  : "short_description", "discount_price"
//   • spaced      : "Short Description", "Discount Price"
// ─────────────────────────────────────────────────────────────────────────────
const HEADER_ALIAS_MAP = {
  // Name
  name: "Name",
  // Description variants
  description: "Description",
  discription: "Description",   // common typo in older sample files
  desc: "Description",
  // ShortDescription
  shortdescription: "ShortDescription",
  short_description: "ShortDescription",
  "short description": "ShortDescription",
  // Category
  category: "Category",
  // Brand
  brand: "Brand",
  // Seller (ignored during insert — we use req.user._id — but mapped so no errors)
  seller: "Seller",
  // Price
  price: "Price",
  // DiscountPrice
  discountprice: "DiscountPrice",
  discount_price: "DiscountPrice",
  "discount price": "DiscountPrice",
  // MRP
  mrp: "MRP",
  // CostPrice
  costprice: "CostPrice",
  cost_price: "CostPrice",
  "cost price": "CostPrice",
  // GST
  gst: "GST",
  // TaxType
  taxtype: "TaxType",
  tax_type: "TaxType",
  "tax type": "TaxType",
  // Stock
  stock: "Stock",
  // SKU
  sku: "SKU",
  // Barcode
  barcode: "Barcode",
  // Warehouse
  warehouse: "Warehouse",
  // MinimumStockAlert
  minimumstockalert: "MinimumStockAlert",
  minimum_stock_alert: "MinimumStockAlert",
  "minimum stock alert": "MinimumStockAlert",
  minstockalert: "MinimumStockAlert",
  // StockStatus (informational — we derive it from Stock)
  stockstatus: "StockStatus",
  stock_status: "StockStatus",
  "stock status": "StockStatus",
  // Slug (informational — we auto-generate)
  slug: "Slug",
  // Thumbnail / Images (informational — not stored in this flow)
  thumbnail: "Thumbnail",
  images: "Images",
  // Shipping / Specifications / Variants / Tags / SEO / flags (informational)
  shipping: "Shipping",
  specifications: "Specifications",
  variants: "Variants",
  tags: "Tags",
  seo: "SEO",
  isfeatured: "IsFeatured",
  is_featured: "IsFeatured",
  isactive: "IsActive",
  is_active: "IsActive",
  rating: "Rating",
  numreviews: "NumReviews",
  num_reviews: "NumReviews",
  "num reviews": "NumReviews",
};

/**
 * Normalise a raw Excel column header to the canonical key used in this
 * controller. Falls back to the original value (trimmed) if no alias found,
 * so truly unknown columns pass through unchanged.
 */
function normaliseHeader(raw) {
  const key = String(raw).trim().toLowerCase().replace(/\s+/g, " ");
  return HEADER_ALIAS_MAP[key] ?? raw.trim();
}

// Safe number parser — returns fallback for anything that is not a finite number
function toNumber(val, fallback = 0) {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bulk-upload
// ─────────────────────────────────────────────────────────────────────────────
exports.bulkUploadProducts = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please upload an Excel file (.xlsx or .xls).",
      });
    }

    // ── Parse workbook ──────────────────────────────────────────────────────
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);

    const worksheet = workbook.worksheets[0];

    if (!worksheet || worksheet.rowCount < 2) {
      return res.status(400).json({
        success: false,
        message: "Excel file is empty or has no data rows.",
      });
    }

    // ── Extract headers from row 1 ──────────────────────────────────────────
    // normaliseHeader maps any casing / spelling variant to the canonical key
    // used throughout the controller (e.g. "name" → "Name", "discription" → "Description")
    const headers = {};
    worksheet.getRow(1).eachCell((cell, colNumber) => {
      const raw = cellToString(cell.value);
      if (raw) headers[colNumber] = normaliseHeader(raw);
    });

    // ── Build row objects ───────────────────────────────────────────────────
    const rows = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const rowData = {};
      row.eachCell((cell, colNumber) => {
        const key = headers[colNumber];
        if (key) rowData[key] = cellToString(cell.value);
      });

      // Skip entirely blank rows
      if (Object.values(rowData).some((v) => v !== "")) {
        rows.push(rowData);
      }
    });

    if (!rows.length) {
      return res.status(400).json({
        success: false,
        message: "No data rows found in the Excel file.",
      });
    }

    // ── Pre-fetch all existing SKUs in one DB call ──────────────────────────
    const rawSkus = rows.map((r) => cellToString(r.SKU)).filter(Boolean);

    const existingSkuDocs = await Product.find(
      { sku: { $in: rawSkus } },
      { sku: 1 }
    ).lean();
    const existingSkus = new Set(existingSkuDocs.map((d) => d.sku));

    // ── Pre-fetch all unique categories mentioned in the file ───────────────
    const categoryNames = [
      ...new Set(
        rows.map((r) => cellToString(r.Category)).filter(Boolean)
      ),
    ];
    // Escape any regex special characters in the category name before building
    // the case-insensitive match regex (e.g. "personal-care" has a "-" which
    // is special inside a character class and breaks the RegExp constructor).
    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const categoryDocs = await Category.find({
      name: {
        $in: categoryNames.map((n) => new RegExp(`^${escapeRegex(n)}$`, "i")),
      },
      isActive: true,
    })
      .select("_id name")
      .lean();

    // Build a lowercase lookup map for fast category resolution
    const categoryMap = new Map(
      categoryDocs.map((c) => [c.name.toLowerCase(), c._id])
    );

    // ── Process rows ────────────────────────────────────────────────────────
    // productsToInsert holds validated, ready-to-insert objects
    // rowIndexMap maps productsToInsert index → original Excel row number
    // (needed to correlate DB errors back to rows)
    const productsToInsert = [];
    const rowIndexMap = [];
    const failedRows = [];

    // Track SKUs seen in this batch to catch intra-file duplicates
    const batchSkus = new Set();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // row 1 is header

      try {
        const name = cellToString(row.Name);
        const categoryName = cellToString(row.Category);
        const skuRaw = cellToString(row.SKU);
        const priceRaw = cellToString(row.Price);

        // ── Required field validation ───────────────────────────────────────
        const missing = [];
        if (!name) missing.push("Name");
        if (!categoryName) missing.push("Category");
        if (!skuRaw) missing.push("SKU");
        if (!priceRaw) missing.push("Price");

        if (missing.length) {
          failedRows.push({
            row: rowNum,
            product: name || "(unnamed)",
            reason: `Required fields missing: ${missing.join(", ")}.`,
          });
          continue;
        }

        // ── Price validation ────────────────────────────────────────────────
        const price = toNumber(priceRaw);
        if (price <= 0) {
          failedRows.push({
            row: rowNum,
            product: name,
            reason: "Price must be a positive number.",
          });
          continue;
        }

        // ── SKU duplicate check: DB ─────────────────────────────────────────
        if (existingSkus.has(skuRaw)) {
          failedRows.push({
            row: rowNum,
            product: name,
            reason: `SKU "${skuRaw}" already exists in the database.`,
          });
          continue;
        }

        // ── SKU duplicate check: this file ──────────────────────────────────
        if (batchSkus.has(skuRaw)) {
          failedRows.push({
            row: rowNum,
            product: name,
            reason: `SKU "${skuRaw}" appears more than once in this file.`,
          });
          continue;
        }

        // ── Category lookup ─────────────────────────────────────────────────
        const categoryId = categoryMap.get(categoryName.toLowerCase());
        if (!categoryId) {
          failedRows.push({
            row: rowNum,
            product: name,
            reason: `Category "${categoryName}" not found or inactive.`,
          });
          continue;
        }

        // ── Build unique slug (name + SKU suffix avoids slug collisions) ────
        const slug = `${slugify(name, { lower: true, strict: true })}-${skuRaw.toLowerCase()}`;

        // ── Parse numeric fields ────────────────────────────────────────────
        const stock = toNumber(row.Stock);
        const taxType = cellToString(row.TaxType) === "Exclusive"
          ? "Exclusive"
          : "Inclusive";

        batchSkus.add(skuRaw);

        rowIndexMap.push(rowNum);
        productsToInsert.push({
          name,
          slug,
          description: cellToString(row.Description),
          shortDescription: cellToString(row.ShortDescription),
          category: categoryId,
          brand: cellToString(row.Brand),
          seller: req.user._id,
          price,
          discountPrice: toNumber(row.DiscountPrice),
          mrp: toNumber(row.MRP),
          costPrice: toNumber(row.CostPrice),
          gst: toNumber(row.GST),
          taxType,
          stock,
          sku: skuRaw,
          barcode: cellToString(row.Barcode),
          warehouse: cellToString(row.Warehouse),
          minimumStockAlert: toNumber(row.MinimumStockAlert, 5),
          stockStatus: stock > 0 ? "In Stock" : "Out of Stock",
        });
      } catch (err) {
        failedRows.push({
          row: rowNum,
          product: cellToString(row.Name) || "(unnamed)",
          reason: err.message,
        });
      }
    }

    // ── Bulk insert ─────────────────────────────────────────────────────────
    // KEY FIXES:
    //  • rawResult: true  → gives us the actual insertedCount from MongoDB
    //  • ordered: false   → inserts all valid docs even if some fail
    //  • throwOnValidationError: true → Mongoose validation errors surface as
    //    MongooseBulkWriteError with .validationErrors[] instead of silent []
    let successCount = 0;

    if (productsToInsert.length > 0) {
      try {
        const result = await Product.insertMany(productsToInsert, {
          ordered: false,
          rawResult: true,
          throwOnValidationError: true,
        });

        // result.insertedCount is the authoritative number of docs saved to DB
        successCount = result.insertedCount ?? productsToInsert.length;
      } catch (bulkErr) {
        // ── Mongoose validation errors (MongooseBulkWriteError) ─────────────
        // throwOnValidationError:true causes Mongoose to throw this when one or
        // more docs fail Mongoose-level validation. .validationErrors[] holds
        // individual errors; .rawResult.insertedCount tells us what succeeded.
        if (bulkErr.name === "MongooseBulkWriteError" && bulkErr.validationErrors) {
          // Docs that passed Mongoose validation were still inserted (ordered:false)
          successCount = bulkErr.rawResult?.insertedCount ?? 0;

          for (const ve of bulkErr.validationErrors) {
            const excelRow = rowIndexMap[ve.index] ?? "?";
            const docName = productsToInsert[ve.index]?.name ?? "(unknown)";
            failedRows.push({
              row: excelRow,
              product: docName,
              reason: `Validation: ${ve.message}`,
            });
          }
        }
        // ── MongoDB write errors (duplicate key, etc.) ──────────────────────
        else if (bulkErr.writeErrors?.length) {
          // Some docs inserted, some didn't (e.g. slug/sku unique violation)
          successCount =
            bulkErr.result?.nInserted ??
            bulkErr.result?.insertedCount ??
            (productsToInsert.length - bulkErr.writeErrors.length);

          for (const we of bulkErr.writeErrors) {
            const excelRow = rowIndexMap[we.index] ?? "?";
            const docName = productsToInsert[we.index]?.name ?? "(unknown)";
            failedRows.push({
              row: excelRow,
              product: docName,
              reason: we.errmsg ?? we.err?.errmsg ?? "Database write error.",
            });
          }
        }
        // ── Unknown / full-batch failure ────────────────────────────────────
        else {
          console.error("insertMany unexpected error:", bulkErr);
          throw bulkErr;
        }
      }
    }

    const failedCount = failedRows.length;
    const totalRows = rows.length;

    // ── Determine status ────────────────────────────────────────────────────
    let status = "Success";
    if (successCount === 0) status = "Failed";
    else if (failedCount > 0) status = "Partial";

    // ── Save upload history ─────────────────────────────────────────────────
    await UploadHistory.create({
      seller: req.user._id,
      fileName: req.file.originalname,
      totalProducts: totalRows,
      successCount,
      failedCount,
      status,
      failedRows,
    });

    return res.status(201).json({
      success: true,
      message:
        successCount > 0
          ? `${successCount} product(s) uploaded successfully.`
          : "No products were uploaded.",
      data: {
        totalProducts: totalRows,
        successCount,
        failedCount,
        status,
        failedRows,
      },
    });
  } catch (error) {
    console.error("Bulk upload error:", error);
    return res.status(500).json({
      success: false,
      message: "Bulk upload failed. Please try again.",
      error: error.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bulk-upload/history
// ─────────────────────────────────────────────────────────────────────────────
exports.getUploadHistory = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    const [history, total] = await Promise.all([
      UploadHistory.find({ seller: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      UploadHistory.countDocuments({ seller: req.user._id }),
    ]);

    return res.status(200).json({
      success: true,
      data: history,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Upload history fetch error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch upload history.",
      error: error.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bulk-upload/sample
// ─────────────────────────────────────────────────────────────────────────────
exports.downloadSampleFile = async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "HelloMaam";
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet("Products");

    worksheet.columns = [
      { header: "Name", key: "name", width: 30 },
      { header: "Description", key: "description", width: 40 },
      { header: "ShortDescription", key: "shortDescription", width: 30 },
      { header: "Category", key: "category", width: 25 },
      { header: "Brand", key: "brand", width: 20 },
      { header: "Price", key: "price", width: 15 },
      { header: "DiscountPrice", key: "discountPrice", width: 18 },
      { header: "MRP", key: "mrp", width: 15 },
      { header: "CostPrice", key: "costPrice", width: 15 },
      { header: "GST", key: "gst", width: 10 },
      { header: "TaxType", key: "taxType", width: 15 },
      { header: "Stock", key: "stock", width: 15 },
      { header: "SKU", key: "sku", width: 20 },
      { header: "Barcode", key: "barcode", width: 20 },
      { header: "Warehouse", key: "warehouse", width: 20 },
      { header: "MinimumStockAlert", key: "minimumStockAlert", width: 20 },
    ];

    // Style header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4F46E5" },
    };
    headerRow.alignment = { vertical: "middle", horizontal: "center" };
    headerRow.height = 20;

    // Sample data rows
    worksheet.addRow({
      name: "Apple iPhone 16",
      description: "Latest Apple smartphone with A18 chip",
      shortDescription: "iPhone 16 128GB",
      category: "Mobiles",
      brand: "Apple",
      price: 79999,
      discountPrice: 74999,
      mrp: 79999,
      costPrice: 70000,
      gst: 18,
      taxType: "Inclusive",
      stock: 20,
      sku: "APL-IP16-001",
      barcode: "1234567890123",
      warehouse: "Warehouse A",
      minimumStockAlert: 5,
    });

    worksheet.addRow({
      name: "Samsung Galaxy S24",
      description: "Samsung flagship smartphone",
      shortDescription: "Galaxy S24 256GB",
      category: "Mobiles",
      brand: "Samsung",
      price: 74999,
      discountPrice: 69999,
      mrp: 74999,
      costPrice: 65000,
      gst: 18,
      taxType: "Inclusive",
      stock: 15,
      sku: "SAM-GS24-001",
      barcode: "9876543210123",
      warehouse: "Warehouse A",
      minimumStockAlert: 5,
    });

    // Field Guide sheet
    const notesSheet = workbook.addWorksheet("Field Guide");
    notesSheet.columns = [
      { header: "Field", key: "field", width: 22 },
      { header: "Required", key: "required", width: 12 },
      { header: "Type", key: "type", width: 15 },
      { header: "Notes", key: "notes", width: 60 },
    ];
    notesSheet.getRow(1).font = { bold: true };

    [
      { field: "Name", required: "Yes", type: "Text", notes: "Product display name" },
      { field: "Description", required: "No", type: "Text", notes: "Full product description" },
      { field: "ShortDescription", required: "No", type: "Text", notes: "Brief summary shown on listing pages" },
      { field: "Category", required: "Yes", type: "Text", notes: "Must match an active category name exactly (case-insensitive)" },
      { field: "Brand", required: "No", type: "Text", notes: "Manufacturer / brand name" },
      { field: "Price", required: "Yes", type: "Number", notes: "Selling price — must be greater than 0" },
      { field: "DiscountPrice", required: "No", type: "Number", notes: "Discounted / offer price (0 if none)" },
      { field: "MRP", required: "No", type: "Number", notes: "Maximum retail price printed on product" },
      { field: "CostPrice", required: "No", type: "Number", notes: "Your purchase / cost price" },
      { field: "GST", required: "No", type: "Number", notes: "GST percentage e.g. 18 for 18%" },
      { field: "TaxType", required: "No", type: "Text", notes: '"Inclusive" or "Exclusive". Defaults to Inclusive.' },
      { field: "Stock", required: "No", type: "Number", notes: "Available inventory quantity. Defaults to 0." },
      { field: "SKU", required: "Yes", type: "Text", notes: "Unique Stock Keeping Unit — must be unique across all products in the system" },
      { field: "Barcode", required: "No", type: "Text", notes: "EAN / UPC barcode number" },
      { field: "Warehouse", required: "No", type: "Text", notes: "Warehouse or storage location name" },
      { field: "MinimumStockAlert", required: "No", type: "Number", notes: "Low-stock alert threshold. Defaults to 5." },
    ].forEach((g) => notesSheet.addRow(g));

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="sample-products.xlsx"'
    );

    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    console.error("Sample file download error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate sample file.",
      error: error.message,
    });
  }
};
