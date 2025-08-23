import mongoose from "mongoose";
const restaurantDocumentsSchema = new mongoose.Schema({
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" },
   businessLicense: {
    licenseNumber: String,
    issueDate: Date,
    imageUrl: String,
    isVerified: Boolean
  },
  foodHygieneCertificate: {
    certificateNumber: String,
    issueDate: Date,
    imageUrl: String,
    isVerified: Boolean
  },
  vatCertificate: {
    vatNumber: String,
    issueDate: Date,
    imageUrl: String,
    isVerified: Boolean
  },
  bankDetails: {
    beneficiaryName: String,
    sortCode: String,
    accountNumber: String,
    bankAddress: String,
    bankDetailsImageUrl: String,
    isVerified: Boolean
  },
  verificationStatus: String,
  createdAt: Date,
  updatedAt: Date
});
export default mongoose.model("RestaurantDocuments", restaurantDocumentsSchema);
