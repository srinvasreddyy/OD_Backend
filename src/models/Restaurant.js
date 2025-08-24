import mongoose from "mongoose";
const restaurantSchema = new mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId,
  restaurantId: String, 
  restaurantName: String,
  ownerFullName: String,
  email: String,
  phoneNumber: String,
  primaryContactName: String,
  notifications: Boolean,
  address: {
    shopNo: String,
    floor: String,
    area: String,
    city: String,
    landmark: String,
    coordinates: {
      type: "Point",
      coordinates: [Number, Number]
    }
  },
  password: String,
  isActive: Boolean,
  createdAt: Date,
  updatedAt: Date
});
export default mongoose.model("Restaurant", restaurantSchema);