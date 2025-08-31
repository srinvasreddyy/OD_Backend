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

const announcementSchema = new mongoose.Schema({
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true, index: true },
    announcementType: { type: String, enum: ['text', 'image'], required: true },
    title: { type: String, required: true },
    content: { type: String, required: true },
    imageUrl: String,
    reactions: [reactionSchema],
    reactionCount: { type: Number, default: 0 }, // For efficient stat calculation
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now, index: true },
    updatedAt: { type: Date, default: Date.now }
});

announcementSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

export default mongoose.model("Announcement", announcementSchema);