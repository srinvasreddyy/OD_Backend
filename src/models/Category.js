import mongoose from "mongoose";

/**
 * @description Represents a global category for menu items across all restaurants.
 */
const categorySchema = new mongoose.Schema({
  categoryName: {
    type: String,
    required: [true, "Category name is required."],
    trim: true,
    unique: true // Ensures category names are unique across the entire application.
  },
  description: {
    type: String,
    trim: true
  },
  imageUrl: {
    type: String
  },
  isActive: {
    type: Boolean,
    default: true
  },
}, {
  timestamps: true // Automatically manages createdAt and updatedAt fields.
});

export default mongoose.model("Category", categorySchema);