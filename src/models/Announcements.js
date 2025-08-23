import mongoose from "mongoose";
const announcementSchema = new mongoose.Schema({
    _id: mongoose.Schema.Types.ObjectId,
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" },
    announcementType: String, // 'text', 'image'
    title: String,
    content: String,
    imageUrl: String,

    targetAudience: {
        userType: String, // 'all_customers', 'frequent_customers'
        locationBased: Boolean,
        radius: Number
    },

    isActive: Boolean,
    startDate: Date,
    endDate: Date,

    createdAt: Date,
    updatedAt: Date
});
export default mongoose.model("Announcements", announcementSchema);
