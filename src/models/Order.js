import mongoose from "mongoose";
const orderSchema = new mongoose.Schema({
  orderNumber: String,
  billNumber: String,
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  customerDetails: {
    name: String,
    phoneNumber: String
  },

  orderType: String, // 'delivery', 'pickup', 'dine-in'

  deliveryAddress: {
    fullAddress: String,
    landmark: String,
    coordinates: {
      type: {
        type: String,
        enum: ['Point'],
      },
      coordinates: {
        type: [Number],
      }
    }
  },

  orderedItems: [{
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: "MenuItem" },
    itemName: String,
    basePrice: Number,
    quantity: Number,
    selectedVariants: [{
      groupId: String,
      variantId: String,
      variantName: String,
      additionalPrice: Number
    }],
    selectedAddons: [{
      groupId: String,
      addonId: String,
      optionTitle: String,
      price: Number
    }],
    itemTotal: Number
  }],

  pricing: {
    subtotal: Number,
    deliveryFee: Number,
    tax: Number,
    totalAmount: Number
  },

  paymentType: String, // 'cash', 'card', 'upi'
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'refunded'],
    default: 'pending',
    required: true
  }, // 'pending', 'paid', 'failed'

  status: {
    type: String,
    enum: ['placed', 'out_for_delivery', 'delivered', 'cancelled'],
    default: 'placed',
    required: true
  }, // 'placed', 'out_for_delivery', 'delivered', 'cancelled'
  acceptanceStatus: String, // 'pending', 'accepted', 'rejected'

  assignedDeliveryPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  deliveryDate: Date,
  deliveryTime: Date,

  review: {
    rating: Number,
    comment: String,
    reviewDate: Date
  },

  notes: String,
  createdAt: Date,
  updatedAt: Date
});
export default mongoose.model("Order", orderSchema);