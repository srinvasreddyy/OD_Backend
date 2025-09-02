import mongoose from "mongoose";
const restaurantMediaSchema = new mongoose.Schema({
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", index: true },
    mediaUrl: { type: String, required: true },
    mediaType: String,
    isProfile: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true }
}, { timestamps: true }); // Added timestamps and removed manual date

export default mongoose.model("RestaurantMedia", restaurantMediaSchema);