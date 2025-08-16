import Owner from '../models/Owner.model.js';
import uploadOnCloudinary from '../config/cloudinary.js';

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
