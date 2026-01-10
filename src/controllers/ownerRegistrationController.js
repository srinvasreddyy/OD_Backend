import mongoose from "mongoose";
import Stripe from "stripe"; 
import Restaurant from "../models/Restaurant.js";
import RestaurantDocuments from "../models/RestaurantDocuments.js";
import RestaurantMedia from "../models/RestaurantMedia.js";
import RestaurantTimings from "../models/RestaurantTimings.js";
import uploadOnCloudinary from "../config/cloudinary.js";
import logger from "../utils/logger.js";
import config from "../config/env.js";

// Initialize Stripe with Platform Secret Key
const stripe = new Stripe(config.stripe.secretKey);

// --- Helper Functions ---

const validateAndParseInput = (body) => {
  const { 
    restaurantName, ownerFullName, email, password, restaurantType, phoneNumber,
    address, timings, handlingChargesPercentage, deliverySettings 
  } = body;

  const requiredFields = {
    restaurantName, ownerFullName, email, password, restaurantType, phoneNumber,
    handlingChargesPercentage, deliverySettings, address
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
    
    if (!parsedAddress.coordinates || !Array.isArray(parsedAddress.coordinates.coordinates) || parsedAddress.coordinates.coordinates.length !== 2) {
        throw new Error("Address must include valid coordinates: [longitude, latitude].");
    }
    
    if (parsedDeliverySettings.freeDeliveryRadius === undefined || parsedDeliverySettings.chargePerMile === undefined || parsedDeliverySettings.maxDeliveryRadius === undefined) {
        throw new Error("Delivery settings must include freeDeliveryRadius, chargePerMile, and maxDeliveryRadius.");
    }
    
    return { ...body, parsedAddress, parsedTimings, parsedDeliverySettings };
  } catch (e) {
    const error = new Error(`Invalid JSON format or missing data in address, timings, or deliverySettings. Details: ${e.message}`);
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

// --- Main Controllers ---

/**
 * @description Registers a new restaurant owner and creates a Stripe Connect Express account.
 * @route POST /api/ownerRegistration/register
 * @access Public
 */
export const registerOwner = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const validatedData = validateAndParseInput(req.body);
    const { email, password, parsedAddress, parsedTimings, parsedDeliverySettings, handlingChargesPercentage, phoneNumber } = validatedData;

    const existingRestaurant = await Restaurant.findOne({ $or: [{ email }, { phoneNumber }] }).session(session);
    if (existingRestaurant) {
      const error = new Error("A restaurant with this email or phone number already exists.");
      error.statusCode = 409;
      throw error;
    }
    
    // 1. Create Stripe Express Account
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'GB', // Defaulting to UK based on phone regex in model
      email: email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });

    const uploadedUrls = await handleFileUploads(req.files);
    
    const restaurant = new Restaurant({
      ...validatedData,
      password: password,
      address: parsedAddress,
      deliverySettings: parsedDeliverySettings,
      handlingChargesPercentage,
      stripeAccountId: account.id, // Save Connect Account ID
      stripeAccountStatus: 'pending',
      phoneNumber
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
        if (!Array.isArray(parsedTimings) || parsedTimings.length === 0) {
            const error = new Error("Invalid timings format. Expected an array of day objects.");
            error.statusCode = 400;
            throw error;
        }
      const restaurantTimings = new RestaurantTimings({
          restaurantId,
          timings: parsedTimings,
          lastUpdated: new Date()
      });
      dbPromises.push(restaurantTimings.save({ session }));
    }
    
    await Promise.all(dbPromises);
    await session.commitTransaction();

    // 2. Generate Account Link for Onboarding
    // Note: clientUrls.restaurant should point to the frontend restaurant dashboard
    const refreshUrl = `${config.clientUrls.restaurant}/onboarding-refresh`;
    const returnUrl = `${config.clientUrls.restaurant}/onboarding-complete`;

    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });

    res.status(201).json({
      success: true,
      message: "Owner registered successfully. Please complete Stripe onboarding.",
      restaurantId,
      stripeOnboardingUrl: accountLink.url // Frontend should redirect user here
    });

  } catch (error) {
    await session.abortTransaction();
    logger.error("Error in registerOwner", { error: error.message, statusCode: error.statusCode });
    next(error);
  } finally {
    session.endSession();
  }
};