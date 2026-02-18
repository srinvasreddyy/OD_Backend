import mongoose from "mongoose";

const SLOT_LOCK_TTL_SECONDS = 600; // Updated to 10 minutes

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
  // Automatically delete document after 10 minutes
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + SLOT_LOCK_TTL_SECONDS * 1000),
    expires: SLOT_LOCK_TTL_SECONDS
  }
});

slotLockSchema.index({ tableId: 1, bookingTime: 1 }, { unique: true });

export default mongoose.model("SlotLock", slotLockSchema);