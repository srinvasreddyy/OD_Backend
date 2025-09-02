import mongoose from "mongoose";
const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, unique: true, required: true },
  billNumber: String,
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true, index: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  customerDetails: {
    name: String,
    phoneNumber: String
  },
  orderType: { type: String, enum: ['delivery', 'pickup', 'dine-in'], required: true },
  deliveryAddress: {
    fullAddress: String,
    landmark: String,
    coordinates: {
      type: { type: String, enum: ['Point'] },
      coordinates: { type: [Number] }
    }
  },
  orderedItems: [{
    _id: false,
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: "MenuItem" },
    itemName: String,
    basePrice: Number,
    quantity: Number,
    selectedVariants: [{ _id: false, groupId: String, variantId: String, variantName: String, additionalPrice: Number }],
    selectedAddons: [{ _id: false, groupId: String, addonId: String, optionTitle: String, price: Number }],
    itemTotal: Number
  }],
  pricing: {
    subtotal: Number,
    deliveryFee: Number,
    tax: Number,
    totalAmount: Number
  },
  paymentType: { type: String, enum: ['cash', 'card', 'upi'], required: true },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'refunded'],
    default: 'pending',
    required: true
  },
  status: {
    type: String,
    enum: ['placed', 'out_for_delivery', 'delivered', 'cancelled'],
    default: 'placed',
    required: true
  },
  acceptanceStatus: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
  assignedDeliveryPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  deliveryDate: Date,
  deliveryTime: Date,
  review: {
    rating: Number,
    comment: String,
    reviewDate: Date
  },
  notes: { type: String, trim: true },
}, { timestamps: true }); 

export default mongoose.model("Order", orderSchema);