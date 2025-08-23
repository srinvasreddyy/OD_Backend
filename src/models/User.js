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
      type: [Number], // [longitude, latitude]
      required: true
    }
  },
  isDefault: Boolean
});



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

  foodCart: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "MenuItem"
  }],
  grocariesCart: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "MenuItem"
  }],

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
