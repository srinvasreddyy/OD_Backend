import mongoose from "mongoose";
import { v2 as cloudinary } from "cloudinary";
import MenuItem from "../models/MenuItem.js";
import Restaurant from "../models/Restaurant.js";
import Category from "../models/Category.js";
import uploadOnCloudinary from "../config/cloudinary.js";

// A custom error class for creating predictable, handled errors.
class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

// --- Helper Functions ---

const findOrCreateCategories = async (categoryNames, session) => {
  if (!categoryNames?.length) return [];
  const categoryPromises = categoryNames.map(name => {
    const trimmedName = name.trim();
    if (!trimmedName) return null;
    return Category.findOneAndUpdate(
      { categoryName: trimmedName },
      { $setOnInsert: { categoryName: trimmedName } },
      { upsert: true, new: true, session, lean: true }
    );
  });
  const categories = await Promise.all(categoryPromises);
  return categories.filter(Boolean).map(cat => cat._id);
};

const handleImageUploads = async (files) => {
  const upload = async (fileList) => {
    if (!fileList?.length) return [];
    const promises = fileList.map(file => uploadOnCloudinary(file).catch(() => null));
    const results = await Promise.all(promises);
    return results.filter(r => r?.secure_url).map(r => r.secure_url);
  };
  const [displayUrls, galleryUrls] = await Promise.all([
    upload(files?.displayImage),
    upload(files?.galleryImages)
  ]);
  return { displayImageUrl: displayUrls[0] || null, galleryImageUrls: galleryUrls };
};

const getPublicIdFromUrl = (url) => {
  const parts = url.split("/");
  const publicIdWithExtension = parts.slice(-2).join("/");
  return publicIdWithExtension.split(".").slice(0, -1).join(".");
};


// --- Write/Modify Controllers ---

/**
 * @description Creates a new menu item for a specific restaurant.
 * @route POST /api/menuItems/:restaurantId/addMenuItem
 * @access Private (Restaurant Owner or Admin)
 */
export const addMenuItem = async (req, res) => {
  // Takes restaurantId from the logged-in user first, or falls back to URL params.
  const restaurantId =  req.restaurant?._id || req.params.restaurantId;
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    if (!restaurantId) {
      throw new ApiError(400, "Restaurant ID is required and was not found in user session or URL parameters.");
    }
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
      throw new ApiError(400, "Invalid Restaurant ID format.");
    }
    const { itemName, isFood, itemType, basePrice, gst, categoryNames, description, packageType, minimumQuantity, maximumQuantity, isBestseller, variantGroups: variantGroupsJSON, addonGroups: addonGroupsJSON } = req.body;
    if (!itemName || isFood === undefined || !itemType || !basePrice || !gst) {
      throw new ApiError(400, "Missing required fields: itemName, isFood, itemType, basePrice, gst.");
    }
    const [restaurant, existingItem] = await Promise.all([
      Restaurant.findById(restaurantId).session(session).lean(),
      MenuItem.findOne({ restaurantId, itemName }).session(session).lean()
    ]);
    if (!restaurant) throw new ApiError(404, "Restaurant not found. Cannot add menu item.");
    if (existingItem) throw new ApiError(409, `An item named '${itemName}' already exists in this restaurant.`);
    const parsedCategoryNames = categoryNames ? JSON.parse(categoryNames) : [];
    const categoryObjectIds = await findOrCreateCategories(parsedCategoryNames, session);
    const { displayImageUrl, galleryImageUrls } = await handleImageUploads(req.files);
    const parsedBasePrice = parseFloat(basePrice);
    const parsedGst = parseFloat(gst);
    const finalPrice = Math.round(parsedBasePrice * (1 + parsedGst / 100));
    const parseJsonField = (jsonString, fieldName) => { if (!jsonString) return undefined; try { return JSON.parse(jsonString); } catch (e) { throw new ApiError(400, `Invalid JSON format for field: '${fieldName}'.`); } };
    const variantGroups = parseJsonField(variantGroupsJSON, 'variantGroups');
    const addonGroups = parseJsonField(addonGroupsJSON, 'addonGroups');
    const menuItem = new MenuItem({
      restaurantId, itemName, description, isFood: isFood === 'true',
      itemType, basePrice: parsedBasePrice, gst: parsedGst, finalPrice, packageType,
      minimumQuantity, maximumQuantity, variantGroups, addonGroups, isBestseller,
      displayImageUrl, imageUrls: galleryImageUrls, categories: categoryObjectIds,
    });
    await menuItem.save({ session });
    await session.commitTransaction();
    return res.status(201).json({ success: true, message: "Menu item created successfully!", data: menuItem });

  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    let statusCode = 500; let response = { success: false, message: "An unexpected server error occurred." }; if (error instanceof ApiError) { statusCode = error.statusCode; response.message = error.message; } else if (error.name === 'ValidationError') { statusCode = 400; response.message = "Input validation failed."; response.errors = Object.values(error.errors).reduce((acc, err) => ({ ...acc, [err.path]: err.message }), {}); } else if (error.code === 11000) { statusCode = 409; response.message = `An item named '${error.keyValue.itemName}' already exists.`; } else if (error.name === 'CastError') { statusCode = 400; response.message = `Invalid data format for the '${error.path}' field.`; } return res.status(statusCode).json(response);
  } finally {
    session.endSession();
  }
};

/**
 * @description Updates an existing menu item's details. Handles partial updates.
 * @route POST /api/menuItems/:restaurantId/:itemId/updateMenuItem
 * @access Private (Restaurant Owner or Admin)
 */
export const updateMenuItem = async (req, res) => {
  const { itemId } = req.params;
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      throw new ApiError(400, "The provided menu item ID is not valid.");
    }

    const menuItem = await MenuItem.findById(itemId).session(session);
    if (!menuItem) {
      throw new ApiError(404, "Menu item not found with the given ID.");
    }

    const actorRestaurantId =  req.restaurant?._id || req.params.restaurantId;
    if (!actorRestaurantId || menuItem.restaurantId.toString() !== actorRestaurantId.toString()) {
      throw new ApiError(403, "Forbidden: You do not have permission to update this menu item.");
    }

    const updates = {}; const body = req.body;
    const simpleFields = ['description', 'packageType', 'isBestseller', 'isAvailable']; simpleFields.forEach(field => { if (body[field] !== undefined) { updates[field] = (field === 'isBestseller' || field === 'isAvailable') ? body[field] === 'true' : body[field]; } }); let newBasePrice = menuItem.basePrice, newGst = menuItem.gst, priceChanged = false; if (body.basePrice !== undefined) { newBasePrice = parseFloat(body.basePrice); updates.basePrice = newBasePrice; priceChanged = true; } if (body.gst !== undefined) { newGst = parseFloat(body.gst); updates.gst = newGst; priceChanged = true; } if (priceChanged) updates.finalPrice = Math.round(newBasePrice * (1 + newGst / 100)); const parseJsonField = (jsonString, fieldName) => { if (!jsonString) return undefined; try { return JSON.parse(jsonString); } catch (e) { throw new ApiError(400, `Invalid JSON format for field: '${fieldName}'.`); } }; if (body.variantGroups) updates.variantGroups = parseJsonField(body.variantGroups, 'variantGroups'); if (body.addonGroups) updates.addonGroups = parseJsonField(body.addonGroups, 'addonGroups'); if (body.categoryNames) { const parsedCategoryNames = parseJsonField(body.categoryNames, 'categoryNames'); updates.categories = await findOrCreateCategories(parsedCategoryNames, session); } if (req.files) { if (req.files.displayImage) { const { displayImageUrl } = await handleImageUploads({ displayImage: req.files.displayImage }); if (displayImageUrl) updates.displayImageUrl = displayImageUrl; } if (req.files.galleryImages) { const { galleryImageUrls } = await handleImageUploads({ galleryImages: req.files.galleryImages }); if (galleryImageUrls.length > 0) updates.imageUrls = galleryImageUrls; } } if (Object.keys(updates).length === 0 && !req.files) throw new ApiError(400, "No fields to update were provided.");

    Object.assign(menuItem, updates);
    const updatedMenuItem = await menuItem.save({ session });
    await session.commitTransaction();

    return res.status(200).json({ success: true, message: "Menu item updated successfully!", data: updatedMenuItem });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    let statusCode = 500; let response = { success: false, message: "An unexpected server error occurred." }; if (error instanceof ApiError) { statusCode = error.statusCode; response.message = error.message; } else if (error.name === 'ValidationError') { statusCode = 400; response.message = "Input validation failed."; response.errors = Object.values(error.errors).reduce((acc, err) => ({ ...acc, [err.path]: err.message }), {}); } else if (error.name === 'CastError') { statusCode = 400; response.message = `Invalid data format for the '${error.path}' field.`; } return res.status(statusCode).json(response);
  } finally {
    session.endSession();
  }
};

/**
 * @description Deletes a menu item.
 * @route DELETE /api/menuItems/:restaurantId/:itemId/delete
 * @access Private (Restaurant Owner or Admin)
 */
export const deleteMenuItem = async (req, res) => {
  const { itemId } = req.params;
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      throw new ApiError(400, "The provided menu item ID is not valid.");
    }

    const menuItem = await MenuItem.findById(itemId).session(session);
    if (!menuItem) {
      throw new ApiError(404, "Menu item not found with the given ID.");
    }

    const actorRestaurantId = req.restaurant?._id || req.params.restaurantId;
    if (!actorRestaurantId || menuItem.restaurantId.toString() !== actorRestaurantId.toString()) {
      throw new ApiError(403, "Forbidden: You do not have permission to delete this menu item.");
    }

    await MenuItem.findByIdAndDelete(itemId, { session });
    await session.commitTransaction();

    const imageUrlsToDelete = [menuItem.displayImageUrl, ...menuItem.imageUrls].filter(Boolean);
    if (imageUrlsToDelete.length > 0) {
      const publicIds = imageUrlsToDelete.map(getPublicIdFromUrl);
      const deletionPromises = publicIds.map(id => cloudinary.uploader.destroy(id));
      await Promise.allSettled(deletionPromises);
    }

    return res.status(200).json({ success: true, message: "Menu item deleted successfully." });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    let statusCode = 500; let response = { success: false, message: "An unexpected server error occurred." }; if (error instanceof ApiError) { statusCode = error.statusCode; response.message = error.message; } else if (error.name === 'CastError') { statusCode = 400; response.message = `Invalid data format for the '${error.path}' field.`; } return res.status(statusCode).json(response);
  } finally {
    session.endSession();
  }
};


// --- Read (GET) Controllers ---

/**
 * @description Get a paginated list of all available menu items from all restaurants.
 * @route GET /api/menuItems/all
 * @access Public
 */
export const getAllMenuItems = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const menuItems = await MenuItem.find({ isAvailable: true })
            .populate('restaurantId', 'restaurantName address.city')
            .populate('categories', 'categoryName')
            .skip(skip)
            .limit(limit);

        const totalItems = await MenuItem.countDocuments({ isAvailable: true });

        res.status(200).json({
            success: true,
            data: menuItems,
            pagination: { totalItems, totalPages: Math.ceil(totalItems / limit), currentPage: page }
        });
    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ success: false, message: error.message || "An unexpected server error occurred." });
    }
};

/**
 * @description Get a single menu item by its ID.
 * @route GET /api/menuItems/:itemId
 * @access Public
 */
export const getMenuItemById = async (req, res) => {
    try {
        const { itemId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(itemId)) {
            return res.status(400).json({ success: false, message: "Invalid menu item ID format." });
        }
        const menuItem = await MenuItem.findById(itemId)
            .populate('restaurantId', 'restaurantName address')
            .populate('categories', 'categoryName');
        if (!menuItem) {
            return res.status(404).json({ success: false, message: "Menu item not found." });
        }
        res.status(200).json({ success: true, data: menuItem });
    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ success: false, message: error.message || "An unexpected server error occurred." });
    }
};


/**
 * @description Get all menu items for a specific restaurant.
 * @route GET /api/menuItems/restaurant/:restaurantId
 * @access Public
 */
export const getMenuByRestaurantId = async (req, res) => {
    try {
        const { restaurantId } = req.params;
        const { page = 1, limit = 20, isAvailable } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
            return res.status(400).json({ success: false, message: "Invalid restaurant ID format." });
        }
        const filter = { restaurantId };
        if (isAvailable === 'true') {
            filter.isAvailable = true;
        }
        const menuItems = await MenuItem.find(filter)
            .populate('categories', 'categoryName')
            .skip(skip)
            .limit(parseInt(limit));
        const totalItems = await MenuItem.countDocuments(filter);
        if (totalItems === 0) {
            return res.status(200).json({ success: true, data: [], message: "No menu items found for this restaurant." });
        }
        res.status(200).json({
            success: true, data: menuItems,
            pagination: { totalItems, totalPages: Math.ceil(totalItems / parseInt(limit)), currentPage: parseInt(page) }
        });
    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ success: false, message: error.message || "An unexpected server error occurred." });
    }
};

/**
 * @description Get a list of all categories from the database, sorted alphabetically.
 * @route GET /api/menuItems/categories
 * @access Public
 */
export const getAllCategories = async (req, res) => {
    try {
        // Find all documents in the Category collection without any filter.
        const categories = await Category.find({}).sort({ categoryName: 1 });

        // The result from .find() is already an array.
        res.status(200).json({
            success: true,
            count: categories.length,
            data: categories,
        });
    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch categories." });
    }
};