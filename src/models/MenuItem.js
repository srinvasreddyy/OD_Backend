import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

/**
 * @description Represents a single menu item belonging to a specific restaurant.
 */
const menuItemSchema = new mongoose.Schema({
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true, index: true },
  itemName: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  displayImageUrl: { type: String },
  imageUrls: [String],
  categories: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category" }],
  isFood: { type: Boolean, required: true },
  itemType: { type: String, enum: ['veg', 'non-veg', 'egg'], required: true },
  basePrice: { type: Number, required: true, min: 0 },
  gst: { type: Number, required: true, min: 0 },
  finalPrice: { type: Number, required: true, min: 0 },
  packageType: String,
  minimumQuantity: { type: Number, default: 1, min: 1 },
  maximumQuantity: { type: Number, min: 1 },
  variantGroups: [{
    _id: false,
    groupId: { type: String, default: uuidv4 },
    groupTitle: { type: String, required: true, trim: true },
    variants: [{
      _id: false,
      variantId: { type: String, default: uuidv4 },
      variantName: { type: String, required: true, trim: true },
      additionalPrice: { type: Number, required: true, default: 0 }
    }]
  }],
  addonGroups: [{
    _id: false,
    groupId: { type: String, default: uuidv4 },
    groupTitle: { type: String, required: true, trim: true },
    customizationBehavior: { type: String, enum: ["compulsory", "optional"], default: "optional" },
    minSelection: { type: Number, default: 0 },
    maxSelection: Number,
    addons: [{
      _id: false,
      addonId: { type: String, default: uuidv4 },
      optionTitle: { type: String, required: true, trim: true },
      price: { type: Number, required: true, default: 0 },
    }]
  }],
  isAvailable: { type: Boolean, default: true },
}, {
  timestamps: true
});

// Ensures that no two menu items in the same restaurant can have the same name.
menuItemSchema.index({ itemName: 1, restaurantId: 1 }, { unique: true });

export default mongoose.model("MenuItem", menuItemSchema);