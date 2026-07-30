const mongoose = require("mongoose");

/**
 * Atomic auto-increment counter.
 * Uses findOneAndUpdate with upsert to avoid race conditions.
 * Each model that needs a sequential ID gets its own counter document.
 */
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // e.g. "Bank", "UserBank"
  seq: { type: Number, default: 0 },
});

counterSchema.statics.nextSeq = async function (name) {
  const doc = await this.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" }
  );
  return doc.seq;
};

module.exports = mongoose.model("Counter", counterSchema);
