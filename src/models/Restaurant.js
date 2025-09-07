import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

const restaurantSchema = new mongoose.Schema({
  restaurantName: {
    type: String,
    required: [true, 'Restaurant name is required.'],
    trim: true
  },
  ownerFullName: {
    type: String,
    required: true,
    trim: true
  },
  restaurantType: {
    type: String,
    enum: ['food_delivery_and_dining', 'groceries', 'food_delivery'],
    required: [true, 'Restaurant type is required.']
  },
  email: {
    type: String,
    required: [true, 'Email is required.'],
    unique: true,
    lowercase: true,
    trim: true
  },
  phoneNumber: {
    type: String,
    required: [true, 'Phone number is required.'],
    unique: true
  },
  primaryContactName: {
    type: String,
    trim: true
  },
  notifications: {
    type: Boolean,
    default: true
  },
  address: {
    shopNo: String,
    floor: String,
    area: String,
    city: String,
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
    }
  },
  handlingChargesPercentage: {
    type: Number,
    required: [true, 'Handling charges percentage is required.'],
    min: 0,
    default: 0
  },
  stripeSecretKey: {
    type: String,
    required: [true, 'Stripe secret key is required.'],
    trim: true,
    select: false // Prevent key from being sent in queries by default
  },
  deliverySettings: {
    freeDeliveryRadius: { // In miles
      type: Number,
      required: [true, 'Free delivery radius is required.'],
      min: 0,
      default: 0
    },
    chargePerMile: { // Cost per mile after free radius
      type: Number,
      required: [true, 'Charge per mile is required.'],
      min: 0,
      default: 0
    },
    maxDeliveryRadius: { // In miles
      type: Number,
      required: [true, 'Maximum delivery radius is required.'],
      min: 0
    }
  },
  // --- END NEW FIELDS ---
  isEmailVerified: { type: Boolean, default: false },
  currentOTP: String,
  otpGeneratedAt: Date,
  password: {
    type: String,
    required: [true, 'Password is required.'],
  },
  isActive: {
    type: Boolean,
    default: true
  },
  acceptsDining: { 
    type: Boolean,
    default: false
  },
  deliveryPartners: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
}, {
  timestamps: true
});

restaurantSchema.index({ 'address.coordinates': '2dsphere' });

restaurantSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
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

export default mongoose.model("Restaurant", restaurantSchema);