import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
const menuItemSchema = new mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId,
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
  itemName: {
    type: String,
    required: true
  },
  categories: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category" }],
  isFood: { type: Boolean, required: true },
  itemType: { type: String, enum : ['veg', 'non-veg','egg'], required: true },
  description: String,
  basePrice: { type: Number, required: true },
  gst: { type: Number, required: true },
  finalPrice: { type: Number, required: true },
  packageType: String,
  minimumQuantity: { type: Number , default: 1},
  maximumQuantity: Number,
  
  variantGroups: [{
    groupId: { type: String, default: uuidv4 },
    groupTitle: String,
    description: String,
    variants: [{
      variantId: { type: String, default: uuidv4 },
      variantName: String,
      variantType: String,
      additionalPrice: Number
    }]
  }],
  
  addonGroups: [{
    groupId: { type: String, default: uuidv4 },
    groupTitle: String,
    groupDescription: String,
    customizationBehavior: {
      type: String,
      enum: ["compulsory", "optional"]
    }, 
    minSelection: Number,
    maxSelection: Number,
    addons: [{
      addonId: { type: String, default: uuidv4 },
      optionTitle: String,
      price: Number,
      gst: Number,
      itemType: String
    }]
  }],
  
  imageUrls: [String],
  isAvailable: Boolean,
  createdAt: Date,
  updatedAt: Date
});
export default mongoose.model("MenuItem", menuItemSchema);
