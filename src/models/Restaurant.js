import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

const restaurantSchema = new mongoose.Schema({
  // Mongoose adds _id automatically, so it's removed from here.
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
    lowercase: true, // Store emails consistently
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
    // CORRECT GeoJSON structure
    coordinates: {
      type: {
        type: String,
        enum: ['Point'],
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
      }
    }
  },
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

// Create a 2dsphere index for efficient geospatial queries
restaurantSchema.index({ 'address.coordinates': '2dsphere' });

// Middleware to hash the password before saving a new restaurant document
restaurantSchema.pre('save', async function(next) {
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