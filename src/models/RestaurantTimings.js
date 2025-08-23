import mongoose from "mongoose";
const restaurantTimingsSchema = new mongoose.Schema({
    _id: mongoose.Schema.Types.ObjectId,
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" },
    timings: [
        {
            day: { type: String, enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] },
            isOpen: Boolean,
            openTime: String,
            closeTime: String
        }
    ],
    timezone: String,
    lastUpdated: Date
});
export default mongoose.model("RestaurantTimings", restaurantTimingsSchema);
