// OD_Backend/src/controllers/menuItemsController.js
import mongoose from "mongoose";
import { v2 as cloudinary } from "cloudinary";
import MenuItem from "../models/MenuItem.js";
import Restaurant from "../models/Restaurant.js";
import Category from "../models/Category.js";
import uploadOnCloudinary from "../config/cloudinary.js";
import logger from "../utils/logger.js";

// A custom error class for creating predictable, handled errors.
class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

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
    const promises = fileList.map(file => uploadOnCloudinary(file));
    const results = await Promise.all(promises);
    return results.map(r => r.secure_url);
  };

  const [displayUrls, galleryUrls] = await Promise.all([
    upload(files?.displayImage),
    upload(files?.galleryImages)
  ]);

  return { displayImageUrl: displayUrls[0] || null, galleryImageUrls: galleryUrls };
};


const getPublicIdFromUrl = (url) => {
    if (!url) return null;
    const parts = url.split("/");
    const publicIdWithExtension = parts.slice(-2).join("/");
    return publicIdWithExtension.split(".").slice(0, -1).join(".");
};


// --- Write/Modify Controllers ---

export const addMenuItem = async (req, res, next) => {
  const restaurantId = req.restaurant._id;
  const session = await mongoose.startSession();

  try {
    const { itemName, isFood, itemType, basePrice, categoryNames, description, packageType, minimumQuantity, maximumQuantity, isBestseller, variantGroups: variantGroupsJSON, addonGroups: addonGroupsJSON } = req.body;

    if (!itemName || isFood === undefined || !itemType || !basePrice) {
      throw new ApiError(400, "Missing required fields: itemName, isFood, itemType, basePrice.");
    }

    const { displayImageUrl, galleryImageUrls } = await handleImageUploads(req.files);
    let newMenuItem;

    await session.withTransaction(async () => {
      const isFoodBool = isFood === 'true';

      const [restaurant, existingItem] = await Promise.all([
        Restaurant.findById(restaurantId).session(session).lean(),
        MenuItem.findOne({ restaurantId, itemName }).session(session).lean()
      ]);

      if (!restaurant) throw new ApiError(404, "Restaurant not found.");
      if (existingItem) throw new ApiError(409, `An item named '${itemName}' already exists in your restaurant.`);
      
      if (restaurant.restaurantType === 'groceries' && isFoodBool) {
        throw new ApiError(400, "A grocery store cannot add food items.");
      }
      if ((restaurant.restaurantType === 'food_delivery' || restaurant.restaurantType === 'food_delivery_and_dining') && !isFoodBool) {
        throw new ApiError(400, "A food restaurant cannot add grocery items.");
      }

      const parsedCategoryNames = categoryNames ? JSON.parse(categoryNames) : [];
      const categoryObjectIds = await findOrCreateCategories(parsedCategoryNames, session);

      const parsedBasePrice = parseFloat(basePrice);
      const parseJsonField = (jsonString, fieldName) => { if (!jsonString) return undefined; try { return JSON.parse(jsonString); } catch (e) { throw new ApiError(400, `Invalid JSON format for field: '${fieldName}'.`); } };
      const variantGroups = parseJsonField(variantGroupsJSON, 'variantGroups');
      const addonGroups = parseJsonField(addonGroupsJSON, 'addonGroups');

      const menuItemData = new MenuItem({
        restaurantId, itemName, description, isFood: isFoodBool,
        itemType, basePrice: parsedBasePrice, packageType,
        minimumQuantity, maximumQuantity, variantGroups, addonGroups, isBestseller,
        displayImageUrl, imageUrls: galleryImageUrls, categories: categoryObjectIds,
      });

      const savedItem = await menuItemData.save({ session });
      newMenuItem = savedItem; 
    });

    return res.status(201).json({ success: true, message: "Menu item created successfully!", data: newMenuItem });

  } catch (error) {
    next(error); 
  } finally {
    session.endSession();
  }
};

export const updateMenuItem = async (req, res, next) => {
  const { itemId } = req.params;
  const restaurantId = req.restaurant._id;
  const session = await mongoose.startSession();

  try {
    let updatedMenuItem;

    await session.withTransaction(async () => {
      if (!mongoose.Types.ObjectId.isValid(itemId)) {
        throw new ApiError(400, "The provided menu item ID is not valid.");
      }

      const menuItem = await MenuItem.findById(itemId).session(session);
      if (!menuItem) {
        throw new ApiError(404, "Menu item not found with the given ID.");
      }

      if (menuItem.restaurantId.toString() !== restaurantId.toString()) {
        throw new ApiError(403, "Forbidden: You do not have permission to update this menu item.");
      }

      const updates = {};
      const body = req.body;

      const simpleFields = ['description', 'packageType', 'isBestseller', 'isAvailable'];
      simpleFields.forEach(field => {
          if (body[field] !== undefined) {
              const isBooleanField = ['isBestseller', 'isAvailable'].includes(field);
              updates[field] = isBooleanField ? body[field] === 'true' : body[field];
          }
      });
      
      if (body.basePrice !== undefined) {
          updates.basePrice = parseFloat(body.basePrice);
      }
      
      const parseJsonField = (jsonString, fieldName) => {
          if (!jsonString) return undefined;
          try {
              return JSON.parse(jsonString);
          } catch (e) {
              throw new ApiError(400, `Invalid JSON format for field: '${fieldName}'.`);
          }
      };
      
      if (body.variantGroups) updates.variantGroups = parseJsonField(body.variantGroups, 'variantGroups');
      if (body.addonGroups) updates.addonGroups = parseJsonField(body.addonGroups, 'addonGroups');
      if (body.categoryNames) {
          const parsedCategoryNames = parseJsonField(body.categoryNames, 'categoryNames');
          updates.categories = await findOrCreateCategories(parsedCategoryNames, session);
      }

      if (req.files) {
          if (req.files.displayImage) {
              const { displayImageUrl } = await handleImageUploads({ displayImage: req.files.displayImage });
              if (displayImageUrl) updates.displayImageUrl = displayImageUrl;
          }
          if (req.files.galleryImages) {
              const { galleryImageUrls } = await handleImageUploads({ galleryImages: req.files.galleryImages });
              if (galleryImageUrls.length > 0) updates.imageUrls = galleryImageUrls;
          }
      }
      
      if (Object.keys(updates).length === 0 && !req.files) {
          throw new ApiError(400, "No fields to update were provided.");
      }

      Object.assign(menuItem, updates);
      updatedMenuItem = await menuItem.save({ session });
    });

    return res.status(200).json({ success: true, message: "Menu item updated successfully!", data: updatedMenuItem });
  } catch (error) {
    next(error);
  } finally {
    session.endSession();
  }
};

export const deleteMenuItem = async (req, res, next) => {
    const { itemId } = req.params;
    const restaurantId = req.restaurant._id;
    const session = await mongoose.startSession();

    try {
        let menuItemToDelete;
        await session.withTransaction(async () => {
            if (!mongoose.Types.ObjectId.isValid(itemId)) {
                throw new ApiError(400, "The provided menu item ID is not valid.");
            }

            const menuItem = await MenuItem.findOne({ _id: itemId, restaurantId }).session(session);
            if (!menuItem) {
                throw new ApiError(404, "Menu item not found or you do not have permission to delete it.");
            }
            menuItemToDelete = menuItem;
            await MenuItem.findByIdAndDelete(itemId, { session });
        });

        if (menuItemToDelete) {
            const imageUrlsToDelete = [menuItemToDelete.displayImageUrl, ...menuItemToDelete.imageUrls].filter(Boolean);
            if (imageUrlsToDelete.length > 0) {
                const publicIds = imageUrlsToDelete.map(getPublicIdFromUrl).filter(Boolean);
                if (publicIds.length > 0) {
                    const deletionPromises = publicIds.map(id => cloudinary.uploader.destroy(id));
                    await Promise.allSettled(deletionPromises);
                }
            }
        }

        return res.status(200).json({ success: true, message: "Menu item deleted successfully." });
    } catch (error) {
        next(error);
    } finally {
        session.endSession();
    }
};


export const getAllMenuItems = async (req, res, next) => {
    try {
        const { page, limit, skip } = getPaginationParams(req.query);

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
        next(error);
    }
};

export const getMenuItemById = async (req, res, next) => {
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
        next(error);
    }
};

export const getMenuByRestaurantId = async (req, res, next) => {
    try {
        const { restaurantId } = req.params;
        const { isAvailable } = req.query;
        const { page, limit, skip } = getPaginationParams(req.query);
        

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
        next(error);
    }
};

export const getAllCategories = async (req, res, next) => {
    try {
        const categories = await Category.find({}).sort({ categoryName: 1 });
        res.status(200).json({
            success: true,
            count: categories.length,
            data: categories,
        });
    } catch (error) {
        next(error);
    }
};