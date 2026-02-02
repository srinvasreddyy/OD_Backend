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
      addressLine1: String,
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
      itemTotal: Number
  }],
  pricing: {
      subtotal: Number,
      deliveryFee: Number,
      handlingCharge: Number,
      platformFee: Number, // Added field
      discountAmount: Number,
      totalAmount: Number
  },
  paymentType: { type: String, enum: ['cash', 'card', 'wallet'], required: true },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
  acceptanceStatus: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
  status: { 
      type: String, 
      // 'awaiting_payment' is crucial for the new flow
      enum: ['awaiting_payment', 'placed', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'cancelled'], 
      default: 'awaiting_payment' 
  },
  sessionId: String,
  notes: String,
  idempotencyKey: String
}, { timestamps: true });

export default mongoose.model("Order", orderSchema);