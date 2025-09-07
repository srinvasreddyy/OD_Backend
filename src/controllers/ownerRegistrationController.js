import mongoose from "mongoose";
import Restaurant from "../models/Restaurant.js";
import RestaurantDocuments from "../models/RestaurantDocuments.js";
import RestaurantMedia from "../models/RestaurantMedia.js";
import RestaurantTimings from "../models/RestaurantTimings.js";
import uploadOnCloudinary from "../config/cloudinary.js";
import logger from "../utils/logger.js";

// --- Helper Functions for a Clean and Maintainable Controller ---

const validateAndParseInput = (body) => {
  const { 
    restaurantName, ownerFullName, email, password, restaurantType, 
    address, timings, handlingChargesPercentage, stripeSecretKey, deliverySettings 
  } = body;

  const requiredFields = {
    restaurantName, ownerFullName, email, password, restaurantType, 
    handlingChargesPercentage, stripeSecretKey, deliverySettings, address
  };
  for (const [key, value] of Object.entries(requiredFields)) {
    if (!value) {
      const error = new Error(`Required field is missing: ${key}.`);
      error.statusCode = 400;
      throw error;
    }
  }

  if (password.length < 8) {
    const error = new Error("Password must be at least 8 characters long.");
    error.statusCode = 400;
    throw error;
  }

  try {
    const parsedAddress = typeof address === 'string' ? JSON.parse(address) : address;
    const parsedTimings = timings ? (typeof timings === 'string' ? JSON.parse(timings) : timings) : null;
    const parsedDeliverySettings = typeof deliverySettings === 'string' ? JSON.parse(deliverySettings) : deliverySettings;
    
    // Validate coordinates
    if (!parsedAddress.coordinates || !Array.isArray(parsedAddress.coordinates.coordinates) || parsedAddress.coordinates.coordinates.length !== 2) {
        throw new Error("Address must include valid coordinates: [longitude, latitude].");
    }

    return { ...body, parsedAddress, parsedTimings, parsedDeliverySettings };
  } catch (e) {
    const error = new Error(`Invalid JSON format or missing data in address or deliverySettings. Details: ${e.message}`);
    error.statusCode = 400;
    throw error;
  }
};

const handleFileUploads = async (files) => {
  const upload = (file) => (file ? uploadOnCloudinary(file[0]) : Promise.resolve(null));
  const uploadMultiple = (fileList) => (fileList ? Promise.all(fileList.map((f) => uploadOnCloudinary(f))) : Promise.resolve([]));

  const [
    profileImageResult,
    galleryResults,
    businessLicenseResult,
    foodHygieneResult,
    vatResult,
    bankDocResult,
  ] = await Promise.all([
    upload(files?.profileImage),
    uploadMultiple(files?.images),
    upload(files?.businessLicenseImage),
    upload(files?.foodHygieneCertificateImage),
    upload(files?.vatCertificateImage),
    upload(files?.bankDocumentImage),
  ]);

  return {
    profileImageUrl: profileImageResult?.secure_url,
    galleryUrls: galleryResults.map((r) => r?.secure_url).filter(Boolean),
    businessLicenseUrl: businessLicenseResult?.secure_url,
    foodHygieneUrl: foodHygieneResult?.secure_url,
    vatUrl: vatResult?.secure_url,
    bankDocUrl: bankDocResult?.secure_url,
  };
};
// --- Main Controller ---

export const registerOwner = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const validatedData = validateAndParseInput(req.body);
    const { email, password, parsedAddress, parsedTimings, parsedDeliverySettings, handlingChargesPercentage, stripeSecretKey } = validatedData;

    const existingRestaurant = await Restaurant.findOne({ email }).session(session);
    if (existingRestaurant) {
      const error = new Error("A restaurant with this email already exists.");
      error.statusCode = 409;
      throw error;
    }
    const uploadedUrls = await handleFileUploads(req.files);
    
    const restaurant = new Restaurant({
      ...validatedData,
      password: password, // The pre-save hook will handle hashing
      address: parsedAddress,
      deliverySettings: parsedDeliverySettings,
      handlingChargesPercentage,
      stripeSecretKey
    });
    const restaurantId = restaurant._id;

    const documents = new RestaurantDocuments({
      restaurantId,
      businessLicense: { imageUrl: uploadedUrls.businessLicenseUrl, licenseNumber: validatedData.businessLicenseNumber },
      foodHygieneCertificate: { imageUrl: uploadedUrls.foodHygieneUrl, certificateNumber: validatedData.foodHygieneCertificateNumber },
      vatCertificate: { imageUrl: uploadedUrls.vatUrl, vatNumber: validatedData.vatNumber },
      bankDetails: {
        bankDetailsImageUrl: uploadedUrls.bankDocUrl,
        beneficiaryName: validatedData.beneficiaryName,
        sortCode: validatedData.sortCode,
        accountNumber: validatedData.accountNumber,
        bankAddress: validatedData.bankAddress,
      },
    });

    const mediaToSave = uploadedUrls.galleryUrls.map(url => ({ restaurantId, mediaUrl: url, isProfile: false }));
    if (uploadedUrls.profileImageUrl) {
      mediaToSave.push({ restaurantId, mediaUrl: uploadedUrls.profileImageUrl, isProfile: true });
    }

    const dbPromises = [
      restaurant.save({ session }),
      documents.save({ session }),
    ];
    if (mediaToSave.length > 0) {
      dbPromises.push(RestaurantMedia.insertMany(mediaToSave, { session }));
    }
    
    if (parsedTimings) {
      const restaurantTimings = new RestaurantTimings({
          restaurantId,
          timings: parsedTimings,
          lastUpdated: new Date()
      });
      dbPromises.push(restaurantTimings.save({ session }));
    }
    
    await Promise.all(dbPromises);

    await session.commitTransaction();

    res.status(201).json({
      success: true,
      message: "Owner registered successfully. Your application is under review.",
      restaurantId,
    });

  } catch (error) {
    await session.abortTransaction();
    logger.error("Error in registerOwner", { error: error.message, statusCode: error.statusCode });
    next(error);
  } finally {
    session.endSession();
  }
};