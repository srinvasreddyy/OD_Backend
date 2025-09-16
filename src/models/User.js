import mongoose from "mongoose";
import bcrypt from 'bcrypt';

const addressSchema = new mongoose.Schema({
  _id: false, // Prevent Mongoose from adding unnecessary _id to subdocuments
  addressId: String,
  addressType: { type: String, enum: ['home', 'work', 'other'] },
  fullAddress: String,
  landmark: String,
  coordinates: {
    type: {
      type: String,
      enum: ['Point'],
    },
    coordinates: {
      type: [Number]
    }
  },
  isDefault: { type: Boolean, default: false }
});

const cartItemSchema = new mongoose.Schema({
  cartItemKey: {
    type: String,
    required: true,
  },
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
    _id: false,
    groupId: String,
    variantId: String
  },
  selectedAddons: [{
    _id: false,
    groupId: String,
    addonId: String
  }]
}, { _id: false });


const userSchema = new mongoose.Schema({
  googleId: {
    type: String,
    unique: true,
    sparse: true
  },
  avatarUrl: {
    type: String
  },
  phoneNumber: String,
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    match: [/.+@.+\..+/, 'Invalid email address'],
  },
  password: { 
    type: String,
    select: false,
  },
  fullName: { type: String, trim: true },
  userType: {
    type: String,
    enum: ['super_admin', 'customer', 'delivery_partner'],
  },
  currentOTP: String,
  otpGeneratedAt: Date,
  isEmailVerified: { type: Boolean, default: false },
  customerProfile: {
    dateOfBirth: Date,
    gender: { type: String, enum: ['male', 'female', 'other'] },
    addresses: [addressSchema]
  },
  foodCart: [cartItemSchema],
  groceriesCart: [cartItemSchema],
  deliveryPartnerProfile: {
    vehicleType: String,
    vehicleNumber: String,
    isAvailable: Boolean,
    rating: Number
    // The `currentLocation` field has been removed.
  },
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

userSchema.index({ "foodCart.cartItemKey": 1 });
userSchema.index({ "groceriesCart.cartItemKey": 1 });

// --- Password hashing middleware ---
userSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) {
    return next();
  }
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

export default mongoose.model("User", userSchema);