//
import mongoose from "mongoose";

const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true, unique: true },
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  customerDetails: {
      name: String,
      phoneNumber: String
  },
  orderType: { 
      type: String, 
      enum: ['delivery', 'pickup', 'dine_in'], 
      required: true 
  },
  deliveryAddress: {
      fullAddress: String, // New Format
      addressLine1: String, // RESTORED: Legacy Format
      landmark: String,
      city: String,
      coordinates: {
          type: { type: String, enum: ['Point'], default: 'Point' },
          coordinates: [Number] 
      }
  },
  assignedDeliveryPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  orderedItems: [{
      itemId: { type: mongoose.Schema.Types.ObjectId, ref: "MenuItem" },
      itemName: String,
      basePrice: Number,
      quantity: Number,
      selectedVariants: [],
      selectedAddons: [],
      instructions: String, // NEW: Added instructions field
      itemTotal: Number
  }],
  pricing: {
      subtotal: Number,
      deliveryFee: Number,
      handlingCharge: Number,
      platformFee: Number,
      discountAmount: Number,
      totalAmount: Number
  },
  paymentType: { type: String, enum: ['cash', 'card', 'wallet'], required: true },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
  acceptanceStatus: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
  status: { 
      type: String, 
      enum: ['awaiting_payment', 'placed', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'cancelled'], 
      default: 'awaiting_payment' 
  },
  sessionId: String,
  notes: String,
  idempotencyKey: String
}, { timestamps: true });

export default mongoose.model("Order", orderSchema);