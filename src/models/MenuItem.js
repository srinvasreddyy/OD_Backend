import mongoose from "mongoose";
const menuItemSchema = new mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId,
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" },
   itemId: String,
  itemName: String,
  categories: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category" }],
  itemType: String,
  description: String,
  basePrice: Number,
  gst: Number,
  finalPrice: Number,
  packageType: String,
  
  variantGroups: [{
    groupId: String,
    groupTitle: String,
    description: String,
    variants: [{
      variantId: String,
      variantName: String,
      variantType: String,
      additionalPrice: Number
    }]
  }],
  
  addonGroups: [{
    groupId: String,
    groupTitle: String,
    groupDescription: String,
    customizationBehavior: String, // 'compulsory', 'optional'
    minSelection: Number,
    maxSelection: Number,
    addons: [{
      addonId: String,
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
