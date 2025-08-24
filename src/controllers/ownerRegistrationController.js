import mongoose from "mongoose";
import Restaurant from "../models/Restaurant.js";
import RestaurantDocuments from "../models/RestaurantDocuments.js";
import RestaurantMedia from "../models/RestaurantMedia.js";
import RestaurantTimings from "../models/RestaurantTimings.js";
import uploadOnCloudinary from "../config/cloudinary.js"; 

// Controller: Register Owner
export const registerOwner = async (req, res) => {
  try {
    // 1. Extract data from req.body
    const {
      restaurantName,
      ownerFullName,
      email,
      phoneNumber,
      primaryContactName,
      password,
      address,
      timings // can be JSON string or object
    } = req.body;

    // 2. Create restaurantId
    const restaurantId = new mongoose.Types.ObjectId();

    // 3. Upload files to Cloudinary
    let profileImageUrl = null;
    let galleryUrls = [];
    let documents = {};

    // Profile Image
    if (req.files?.profileImage) {
      const r = await uploadOnCloudinary(req.files.profileImage[0].path);
      profileImageUrl = r?.secure_url || null;
    }

    // Gallery Images
    if (req.files?.images) {
      for (const img of req.files.images) {
        const r = await uploadOnCloudinary(img.path);
        if (r?.secure_url) galleryUrls.push(r.secure_url);
      }
    }

    // Documents
    if (req.files?.businessLicenseImage) {
      const r = await uploadOnCloudinary(req.files.businessLicenseImage[0].path);
      documents.businessLicense = {
      licenseNumber: req.body.businessLicenseNumber,
      issueDate: req.body.businessLicenseIssueDate,
      documentUrl: r?.secure_url || null
  };

    }
    if (req.files?.foodHygieneCertificateImage) {
      const r = await uploadOnCloudinary(req.files.foodHygieneCertificateImage[0].path);
      documents.foodHygieneCertificate = {
      certificateNumber: req.body.foodHygieneCertificateNumber,
      issueDate: req.body.foodHygieneCertificateIssueDate,
      imageUrl: r?.secure_url || null
  };
    }
    if (req.files?.vatCertificateImage) {
      const r = await uploadOnCloudinary(req.files.vatCertificateImage[0].path);
      documents.vatCertificate = {
      vatNumber: req.body.vatNumber,
      issueDate: req.body.vatIssueDate,
      imageUrl: r?.secure_url || null
  };
    }
    if (req.files?.bankDocumentImage) {
      const r = await uploadOnCloudinary(req.files.bankDocumentImage[0].path);
      documents.bankDetails = {
      beneficiaryName: req.body.beneficiaryName,
      sortCode: req.body.sortCode,
      accountNumber: req.body.accountNumber,
      bankAddress: req.body.bankAddress,
      bankDetailsImageUrl: r?.secure_url || null
  };
    }

    // 4. Save Restaurant
    const newRestaurant = new Restaurant({
      _id: restaurantId,
      restaurantName,
      ownerFullName,
      email,
      phoneNumber,
      primaryContactName,
      password,
      address: typeof address === "string" ? JSON.parse(address) : address,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await newRestaurant.save();

    // 5. Save Documents
    const newDocs = new RestaurantDocuments({
  _id: new mongoose.Types.ObjectId(),
  restaurantId,
  businessLicense: {
    imageUrl: documents.businessLicense?.documentUrl || null,
    isVerified: false,
  },
  foodHygieneCertificate: {
    imageUrl: documents.foodHygieneCertificate?.imageUrl || null,
    isVerified: false,
  },
  vatCertificate: {
    imageUrl: documents.vatCertificate?.imageUrl || null,
    isVerified: false,
  },
  bankDetails: {
    bankDetailsImageUrl: documents.bankDetails?.bankDetailsImageUrl || null,
    isVerified: false,
  },
  verificationStatus: "pending",
  createdAt: new Date(),
  updatedAt: new Date(),
});


    // 6. Save Media (Profile + Gallery)
    if (profileImageUrl) {
      await new RestaurantMedia({
        _id: new mongoose.Types.ObjectId(),
        restaurantId,
        mediaUrl: profileImageUrl,
        mediaType: "image",
        isProfile: true,
        uploadedAt: new Date(),
        isActive: true,
      }).save();
    }

    if (galleryUrls.length > 0) {
      for (const url of galleryUrls) {
        await new RestaurantMedia({
          _id: new mongoose.Types.ObjectId(),
          restaurantId,
          mediaUrl: url,
          mediaType: "image",
          isProfile: false,
          uploadedAt: new Date(),
          isActive: true,
        }).save();
      }
    }

    // 7. Save Timings (if provided)
    if (timings) {
      await new RestaurantTimings({
        _id: new mongoose.Types.ObjectId(),
        restaurantId,
        timings: typeof timings === "string" ? JSON.parse(timings) : timings,
        timezone: "Asia/Kolkata", // or from frontend
        lastUpdated: new Date(),
      }).save();
    }

    // 8. Return response
    res.status(201).json({
      success: true,
      message: "Owner registered successfully",
      restaurantId,
    });
  } catch (error) {
    console.error("Error in registerOwner:", error);
    res.status(500).json({
      success: false,
      message: "Registration failed",
      error: error.message,
    });
  }
};
