// OD_Backend/src/models/RestaurantDocuments.js
import mongoose from "mongoose";
const restaurantDocumentsSchema = new mongoose.Schema({
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true, unique: true },
   businessLicense: {
    licenseNumber: String,
    issueDate: Date,
    imageUrl: String,
    isVerified: { type: Boolean, default: false }
  },
  foodHygieneCertificate: {
    certificateNumber: String,
    issueDate: Date,
    imageUrl: String,
    isVerified: { type: Boolean, default: false }
  },
  vatCertificate: {
    vatNumber: String,
    issueDate: Date,
    imageUrl: String,
    isVerified: { type: Boolean, default: false }
  },
  bankDetails: {
    beneficiaryName: String,
    sortCode: String,
    accountNumber: String,
    bankAddress: String,
    bankDetailsImageUrl: String,
    isVerified: { type: Boolean, default: false }
  },
  verificationStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  remarks: { type: String, trim: true }, // Admin feedback, e.g., reason for rejection
}, { timestamps: true }); // Added timestamps

export default mongoose.model("RestaurantDocuments", restaurantDocumentsSchema);