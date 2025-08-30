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
      },
      coordinates: {
        type: [Number],
      }
    }
  },
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
  }
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