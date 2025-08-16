import Owner from '../models/Owner.model.js';
import uploadOnCloudinary from '../config/cloudinary.js';
import {sendOtpToEmail} from '../utils/sendOtp.js';
import Otp from '../models/Otp.model.js';
import jwt from 'jsonwebtoken';

export const registerOwner = async (req, res) => {
  try {
    // --- 1. Extract Data and Files ---
    const data = req.body;
    const files = req.files;

    // --- 2. Validate Essential Data ---
    const {
      category,
      restaurantName,
      ownerName,
      email,
      primaryPhone,
      address, // Expecting JSON string
      searchCategories, // Expecting JSON string
      timing, // Expecting JSON string
      documents, // Expecting JSON string
      bankDetails, // Expecting JSON string
    } = data;

    const requiredFields = {
      category,
      restaurantName,
      ownerName,
      email,
      primaryPhone,
      address,
      timing,
      documents,
      bankDetails,
    };

    for (const [field, value] of Object.entries(requiredFields)) {
      if (!value) {
        return res.status(400).json({
          success: false,
          message: `Field '${field}' is required.`,
        });
      }
    }

    // --- 3. Check for Existing Owner ---
    const existingOwner = await Owner.findOne({ email });
    if (existingOwner) {
      return res.status(409).json({
        success: false,
        message: 'An owner with this email already exists.',
      });
    }

    // --- 4. Validate File Uploads ---
    const requiredFiles = {
        profileImage: 'Profile image',
        businessLicenseImage: 'Business license image',
        foodHygieneCertificateImage: 'Food hygiene certificate image',
        vatCertificateImage: 'VAT certificate image',
        bankDocumentImage: 'Bank document image',
        images: 'At least one restaurant image',
    };

    if (!files) {
        return res.status(400).json({ success: false, message: 'No files were uploaded.' });
    }

    for (const [field, description] of Object.entries(requiredFiles)) {
        if (!files[field] || files[field].length === 0) {
            return res.status(400).json({
                success: false,
                message: `${description} is required.`,
            });
        }
    }


    // --- 5. Upload Files to Cloudinary ---
    const uploadPromises = {};
    const addUploadPromise = (fieldName) => {
        if (files[fieldName] && files[fieldName][0]) {
            uploadPromises[fieldName] = uploadOnCloudinary(files[fieldName][0].path);
        }
    };
    
    addUploadPromise('profileImage');
    addUploadPromise('businessLicenseImage');
    addUploadPromise('foodHygieneCertificateImage');
    addUploadPromise('vatCertificateImage');
    addUploadPromise('bankDocumentImage');

    if (files.images && files.images.length > 0) {
        uploadPromises.images = Promise.all(
            files.images.map(file => uploadOnCloudinary(file.path))
        );
    }
    
    // Await all uploads simultaneously. This will contain Cloudinary responses and 'null' for failures.
    const uploadResults = await Promise.all(Object.values(uploadPromises));

    const fileUrls = Object.keys(uploadPromises).reduce((acc, key, index) => {
        const result = uploadResults[index];
        if (Array.isArray(result)) {
            // Filter out any null/undefined results from failed uploads
            acc[key] = result.map(r => r?.secure_url).filter(Boolean);
        } else {
            acc[key] = result?.secure_url;
        }
        return acc;
    }, {});
    
    // --- 6. Parse and Structure Data ---
    let parsedAddress, parsedTiming, parsedDocuments, parsedBankDetails, parsedSearchCategories;
    try {
      parsedAddress = JSON.parse(address);
      parsedTiming = JSON.parse(timing);
      parsedDocuments = JSON.parse(documents);
      parsedBankDetails = JSON.parse(bankDetails);
      parsedSearchCategories = searchCategories ? JSON.parse(searchCategories) : [];
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid JSON format for nested data (address, timing, etc.).',
      });
    }

    // --- 7. Create Owner Document Safely ---
    const ownerPayload = {
      category,
      restaurantName,
      ownerName,
      email,
      primaryPhone,
      secondaryPhone: data.secondaryPhone, // Explicitly handle optional fields
      address: parsedAddress,
      timing: parsedTiming,
      searchCategories: parsedSearchCategories,
      profileImage: fileUrls.profileImage,
      profileImagePublicID : fileUrls.profileImage.public_id,
      images: fileUrls.images,
      documents: {
        businessLicense: {
          licenseNumber: parsedDocuments?.businessLicense?.licenseNumber,
          issueDate: parsedDocuments?.businessLicense?.issueDate,
          licenseImage: fileUrls.businessLicenseImage,
        },
        foodHygieneCertificateImage: fileUrls.foodHygieneCertificateImage,
        vatCertificateImage: fileUrls.vatCertificateImage,
      },
      bankDetails: {
        beneficiaryName: parsedBankDetails?.beneficiaryName,
        sortCode: parsedBankDetails?.sortCode,
        accountNumber: parsedBankDetails?.accountNumber,
        bankAddress: parsedBankDetails?.bankAddress,
        bankDocumentImage: fileUrls.bankDocumentImage,
      },
    };

    // --- 7a. Validate Parsed JSON Content ---
    if (!ownerPayload.documents.businessLicense.licenseNumber || !ownerPayload.documents.businessLicense.issueDate) {
        return res.status(400).json({ success: false, message: 'licenseNumber and issueDate are required within the documents JSON.' });
    }
    if (!ownerPayload.bankDetails.beneficiaryName || !ownerPayload.bankDetails.accountNumber || !ownerPayload.bankDetails.sortCode) {
        return res.status(400).json({ success: false, message: 'beneficiaryName, accountNumber, and sortCode are required within the bankDetails JSON.' });
    }

    const newOwner = new Owner(ownerPayload);
    await newOwner.save();

    // --- 8. Send Success Response ---
    return res.status(201).json({
      success: true,
      message: 'Owner registered successfully. Verification pending.',
      data: newOwner,
    });

  } catch (error) {
    // This will now most likely catch errors from .save() if the schema is not met
    console.error('Error during owner registration:', error);
    return res.status(500).json({
      success: false,
      message: 'An internal server error occurred during the final save step.',
      error: error.message, // This will contain the detailed Mongoose error
    });
  }
};


export const verifyLoginOtp = async (req, res) => {
  const { email, otp } = req.body;

  try {
    const record = await Otp.findOne({ email, otp });

    if (!record) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    if (record.expiresAt < new Date()) {
      return res.status(400).json({ message: "OTP expired" });
    }

    await Otp.deleteMany({ email }); // clean up OTPs

    const owner = await Owner.findOne({ email });
    if (!owner) {
      return res.status(404).json({ message: "Owner not found" });
    }

    // Generate JWT
    const token = jwt.sign(
      { id: owner._id, role: owner.role || "owner" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Send token in cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production", // send only over HTTPS in production
      sameSite: "Strict",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.status(200).json({
      message: "OTP verified and login successful",
      login: true,
      owner,
    });
  } catch (err) {
    console.error("Verify OTP Error:", err);
    res.status(500).json({ message: "Server error verifying OTP" });
  }
};


export const requestLoginOtp = async (req, res) => {
  const { email } = req.body;
  try {
    const owner = await Owner.findOne({ email });
    if (!owner) {
      return res.status(404).json({ message: "Owner not found" });
    }

    await sendOtpToEmail(email);
    res.status(200).json({ message: "OTP sent successfully to email" });
  } catch (err) {
    console.error("OTP Error:", err);
    res.status(500).json({ message: "Error sending OTP" });
  }
};

export const getCurrentOwner = async (req, res) => {
  try {
    // req.user contains the decoded JWT payload
    const ownerId = req.user.id;
    const owner = await Owner.findById(ownerId).select("-password");
    if (!owner) {
      return res.status(404).json({ message: "Owner not found" });
    }
    res.json({ owner });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};


export const logoutOwner = (req, res) => {
  res.cookie("token", "", {
    httpOnly: true,
    expires: new Date(0), // expire immediately
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
  });
  return res.status(200).json({ message: "Logged out successfully" });
};


export const getFoodDeliveryOwners = async (req, res) => {
  try {
    const categories = ['food_delivery_dining', 'food_delivery_only'];
    const owners = await Owner.find({ 
      category: { $in: categories },
      isVerified : true
    }).select('-bankDetails -role -documents');  // exclude these fields
    
    res.json({ success: true, owners });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};


export const getGroceryStoreOwners = async (req, res) => {
  try {
    const categories = ['grocery_store_only'];
    const owners = await Owner.find({ 
      category: { $in: categories }, 
      isVerified: true 
    }).select('-bankDetails -role -documents');  // exclude these fields
    
    res.json({ success: true, owners });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};