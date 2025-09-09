import mongoose from "mongoose";

const SLOT_LOCK_TTL_SECONDS = 300; // 5 minutes

const slotLockSchema = new mongoose.Schema({
  tableId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Table',
    required: true
  },
  bookingTime: {
    type: Date,
    required: true
  },
  // This field is used by MongoDB's TTL index to automatically delete the document
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + SLOT_LOCK_TTL_SECONDS * 1000),
    expires: SLOT_LOCK_TTL_SECONDS
  }
});

// Create a compound index to quickly find locks for a specific table and time
slotLockSchema.index({ tableId: 1, bookingTime: 1 }, { unique: true });

export default mongoose.model("SlotLock", slotLockSchema);