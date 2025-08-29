import mongoose from "mongoose";

const restaurantTimingsSchema = new mongoose.Schema({
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
    timings: [
        {
            day: { 
                type: String, 
                enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
                required: true 
            },
            isOpen: { type: Boolean, required: true },
            openTime: String,
            closeTime: String,
            _id: false 
        }
    ],
    lastUpdated: Date
});

export default mongoose.model("RestaurantTimings", restaurantTimingsSchema);