import mongoose from "mongoose";

// --- NEW: Sub-schema for Applied Offer Details ---
const appliedOfferSchema = new mongoose.Schema({
  promoCode: { type: String, required: true },
  discountType: { type: String, enum: ['PERCENTAGE', 'FLAT', 'FREE_DELIVERY'], required: true },
  discountAmount: { type: Number, required: true, min: 0 }
}, { _id: false });


const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, unique: true, required: true },
  billNumber: String,
  sessionId: { type: String, index: true },
  idempotencyKey: { type: String, unique: true, sparse: true }, 
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
      coordinates: { type: [Number] } // [longitude, latitude]
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
    handlingCharge: Number,
    discountAmount: { type: Number, default: 0 },
    totalAmount: Number
  },
  appliedOffer: {
    type: appliedOfferSchema,
    default: null
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