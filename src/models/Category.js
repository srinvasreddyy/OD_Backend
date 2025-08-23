import mongoose from "mongoose";
const categorySchema = new mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId,
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" },
  categoryId: String,
  categoryName: String,
  description: String,
  imageUrl: String,
  isActive: Boolean,
  sortOrder: Number,
  createdAt: Date,
  updatedAt: Date
});
export default mongoose.model("Category", categorySchema);
