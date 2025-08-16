// models/Owner.js
import mongoose from 'mongoose';

const addressSchema = new mongoose.Schema({
  shopNumber: {
    type: String,
    required: true,
  },
  floor: {
    type: String,
    required: true,
  },
  area: {
    type: String,
    required: true,
  },
  city: {
    type: String,
    required: true,
  },
  landmark: String, // optional
});

const timingSchema = new mongoose.Schema({
  openTime: { type: String, required: true },  // e.g., "09:00 AM"
  closeTime: { type: String, required: true }, // e.g., "11:00 PM"
  openDays: [String], // e.g., ["Monday", "Tuesday", ...]
});

const businessLicenseSchema = new mongoose.Schema({
  licenseNumber: { type: String, required: true },
  issueDate: { type: Date, required: true },
  licenseImage: { type: String, required: true }, // URL to Cloudinary
});

const documentsSchema = new mongoose.Schema({
  businessLicense: businessLicenseSchema,
  foodHygieneCertificateImage: { type: String, required: true },
  vatCertificateImage: { type: String, required: true },
});

const bankDetailsSchema = new mongoose.Schema({
  beneficiaryName: { type: String, required: true },
  sortCode: { type: String, required: true },
  accountNumber: { type: String, required: true },
  bankAddress: { type: String, required: true },
  bankDocumentImage: { type: String, required: true }, // URL
});

const ownerSchema = new mongoose.Schema({
  category: {
    type: String,
    enum: [
      'food_delivery_dining',
      'food_delivery_only',
      'grocery_store_only',
    ],
    required:true
  },
  restaurantName: { type: String, required: true },
  ownerName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  primaryPhone: { type: String, required: true },
  secondaryPhone: { type: String }, // optional

  address: addressSchema,
  images: [String], // multiple restaurant/store images (URLs)
  profileImage: String, // single profile image (URL)

  searchCategories: {
    type: [String],
    validate: v => v.length <= 4,
  },

  timing: timingSchema,

  documents: documentsSchema,
  bankDetails: bankDetailsSchema,

  isVerified: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
   role: {
    type: String,
    default: 'owner',
  }
}, {
  timestamps: true,
});

export default mongoose.model('Owner', ownerSchema);
