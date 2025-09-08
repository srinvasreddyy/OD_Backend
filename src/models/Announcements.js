import mongoose from "mongoose";

const reactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  reaction: {
    type: String,
    enum: ["👍", "❤️", "😂", "😢", "😡"],
    required: true,
  },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

// --- NEW: Sub-schema for Offer Details ---
const offerDetailsSchema = new mongoose.Schema({
  promoCode: {
    type: String,
    trim: true,
    uppercase: true,
    sparse: true, // Allows multiple null values, but unique if present
    unique: true, // Ensures no two announcements can have the same promo code
    index: true,
  },
  discountType: {
    type: String,
    enum: ['PERCENTAGE', 'FLAT', 'FREE_DELIVERY'],
    required: true
  },
  discountValue: {
    type: Number,
    required: true,
    min: 0,
    description: "The percentage or flat amount of the discount."
  },
  minOrderValue: {
    type: Number,
    default: 0,
    min: 0,
    description: "The minimum subtotal required to avail the offer."
  },
  maxDiscountAmount: {
    type: Number,
    min: 0,
    description: "For percentage discounts, the maximum discount amount applicable."
  },
  validUntil: {
    type: Date,
    required: true
  }
}, { _id: false });


const announcementSchema = new mongoose.Schema({
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true, index: true },
    announcementType: { type: String, enum: ['text', 'image', 'offer'], default: 'text' }, // Added 'offer' type
    title: { type: String, required: true },
    content: { type: String, required: true },
    imageUrl: String,
    reactions: [reactionSchema],
    reactionCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    offerDetails: { // <-- NEW FIELD
      type: offerDetailsSchema,
      default: null,
    }
}, { timestamps: true }); 

export default mongoose.model("Announcement", announcementSchema);