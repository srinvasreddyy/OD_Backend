import mongoose from "mongoose";
import MenuItem from "../models/MenuItem.js";
import Restaurant from "../models/Restaurant.js";
import Category from "../models/Category.js";
import uploadOnCloudinary from "../config/cloudinary.js";

// --- Helper Functions for Maintainability ---

/**
 * Parses and validates complex array fields like variantGroups and addonGroups.
 * This function is generic and can be reused for any nested array validation.
 */
const parseAndValidateArrayField = (body, fieldName, rules) => {
  if (!body[fieldName]) return [];
  try {
    const data = typeof body[fieldName] === 'string' ? JSON.parse(body[fieldName]) : body[fieldName];
    if (!Array.isArray(data)) throw new Error(`'${fieldName}' must be an array.`);
    
    data.forEach(item => {
      for (const key of rules.required) {
        if (!item[key]) throw new Error(`Each object in '${fieldName}' must have a '${key}' property.`);
      }
    });
    return data;
  } catch (error) {
    // Re-throw with a more specific error message for better client feedback.
    throw new Error(`Invalid format for '${fieldName}': ${error.message}`);
  }
};

/**
 * Handles all file uploads in parallel for maximum efficiency.
 * It distinguishes between a single display image and multiple gallery images.
 */
const handleImageUploads = async (files) => {
  if (!files || Object.keys(files).length === 0) {
    return { displayImageUrl: null, galleryImageUrls: [] };
  }

  const upload = async (fileList) => {
    if (!fileList || fileList.length === 0) return [];
    const promises = fileList.map(file => 
      uploadOnCloudinary(file.path).catch(() => null) // Prevent one failure from stopping all uploads
    );
    const results = await Promise.all(promises);
    return results.filter(r => r?.secure_url).map(r => r.secure_url);
  };
  
  const [displayUrls, galleryUrls] = await Promise.all([
    upload(files.displayImage),
    upload(files.galleryImages)
  ]);

  return {
    displayImageUrl: displayUrls[0] || null,
    galleryImageUrls: galleryUrls
  };
};

// --- Main Controller Logic ---

export const addMenuItem = async (req, res) => {
  const { restaurantId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
    return res.status(400).json({ message: "Invalid Restaurant ID format." });
  }

  try {
    // 1. --- Input Validation and Parsing ---
    const { itemName, isFood, itemType, basePrice, gst } = req.body;
    if (!itemName || isFood === undefined || !itemType || !basePrice || !gst) {
      return res.status(400).json({ message: "Missing required fields: itemName, isFood, itemType, basePrice, gst." });
    }

    const parsedCategories = parseAndValidateArrayField(req.body, 'categories', { required: [] });
    const parsedVariantGroups = parseAndValidateArrayField(req.body, 'variantGroups', { required: ['groupTitle', 'variants'] });
    const parsedAddonGroups = parseAndValidateArrayField(req.body, 'addonGroups', { required: ['groupTitle', 'addons'] });

    // 2. --- Parallel Database Checks for Efficiency ---
    const [restaurant, categoryCount, existingItem] = await Promise.all([
      Restaurant.findById(restaurantId).lean(),
      Category.countDocuments({ _id: { $in: parsedCategories }, restaurantId }),
      MenuItem.findOne({ restaurantId, itemName }).lean()
    ]);

    if (!restaurant) return res.status(404).json({ message: "Restaurant not found." });
    if (categoryCount !== parsedCategories.length) return res.status(400).json({ message: "One or more categories are invalid or do not belong to this restaurant." });
    if (existingItem) return res.status(409).json({ message: `An item with the name '${itemName}' already exists in this restaurant.` });

    // 3. --- Handle Image Uploads ---
    const { displayImageUrl, galleryImageUrls } = await handleImageUploads(req.files);

    // 4. --- Data Preparation and Creation ---
    const finalPrice = Math.round(parseFloat(basePrice) * (1 + parseFloat(gst) / 100));

    const menuItem = new MenuItem({
      ...req.body,
      restaurantId,
      basePrice: parseFloat(basePrice),
      gst: parseFloat(gst),
      finalPrice,
      displayImageUrl,
      imageUrls: galleryImageUrls,
      categories: parsedCategories,
      variantGroups: parsedVariantGroups,
      addonGroups: parsedAddonGroups
    });

    // Mongoose's .save() will trigger the final, detailed schema-level validation.
    await menuItem.save();

    res.status(201).json({
      success: true,
      message: "Menu item created successfully!",
      data: menuItem,
    });

  } catch (error) {
    // Catch specific errors for clear client feedback.
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: "Validation failed", errors: error.errors });
    }
    if (error.message.includes('Invalid format')) {
      return res.status(400).json({ message: error.message });
    }
    console.error("Error in addMenuItem:", error);
    res.status(500).json({ message: "An unexpected server error occurred." });
  }
};