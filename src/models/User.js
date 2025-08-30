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
  
  // Additions for Google OAuth
  googleId: { 
    type: String, 
    unique: true, 
    sparse: true // Allows multiple nulls but enforces uniqueness for actual values
  },
  avatarUrl: {
    type: String
  },

  phoneNumber: String,
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  fullName: String,
  userType: { 
    type: String, 
    enum: ['super_admin', 'customer', 'delivery_partner'],
  },

  // OTP
  currentOTP: String,
  otpGeneratedAt: Date,
  isPhoneVerified: { type: Boolean, default: false },

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

// Ensures emails are unique for documents where the email field exists
userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: "string" } } });

export default mongoose.model("User", userSchema);