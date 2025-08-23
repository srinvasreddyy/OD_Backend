import mongoose from "mongoose";
const restaurantMediaSchema = new mongoose.Schema({
    _id: mongoose.Schema.Types.ObjectId,
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" },
    mediaUrl: String,
    mediaType: String,
    isProfile: Boolean,
    uploadedAt: Date,
    isActive: Boolean
});
export default mongoose.model("RestaurantMedia", restaurantMediaSchema);
