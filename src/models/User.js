import mongoose from "mongoose";

const addressSchema = new mongoose.Schema({
  addressId: String,
  addressType: { type: String, enum: ['home', 'work', 'other'] },
  fullAddress: String,
  landmark: String,
  coordinates: {
    type: {
      type: String,
      enum: ['Point'],
      required: true
    },
    coordinates: {
      type: [Number]
    }
  },
  isDefault: Boolean
});

const cartItemSchema = new mongoose.Schema({
    menuItemId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'MenuItem', 
        required: true 
    },
    quantity: { 
        type: Number, 
        required: true, 
        min: 1,
        default: 1 
    },
    // Add fields to store user selections
    selectedVariant: {
        groupId: String,
        variantId: String
    },
    selectedAddons: [{
        groupId: String,
        addonId: String
    }]
}, { _id: false });


const userSchema = new mongoose.Schema({
  userId: String,
  phoneNumber: String,
  email: String,
  fullName: String,
  userType: { 
    type: String, 
    enum: ['super_admin', 'admin', 'customer', 'delivery_partner'],
    required: true
  },

  // OTP
  currentOTP: String,
  otpGeneratedAt: Date,
  isPhoneVerified: Boolean,

  // Customer Profile
  customerProfile: {
    dateOfBirth: Date,
    gender: { type: String, enum: ['male', 'female', 'other'] },
    addresses: [addressSchema]
  },

  foodCart: [cartItemSchema],
  groceriesCart: [cartItemSchema],

  // Delivery Partner Profile
  deliveryPartnerProfile: {
    vehicleType: String,
    vehicleNumber: String,
    isAvailable: Boolean,
    currentLocation: {
      type: {
        type: String,
        enum: ['Point'],
        
      },
      coordinates: {
        type: [Number],
        required: true
      }
    },
    rating: Number
  },

  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" },

  isActive: { type: Boolean, default: true }
}, { timestamps: true });

export default mongoose.model("User", userSchema);
