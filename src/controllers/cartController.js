import mongoose from "mongoose";
import User from '../models/User.js';
import MenuItem from '../models/MenuItem.js';
import logger from "../utils/logger.js";
import { DELIVERY_FEE } from "../../constants.js";

// --- Helper Functions ---

/**
 * Generates a consistent, unique key for a given menu item configuration.
 * @param {object} itemConfig - Object containing menuItemId, selectedVariant, and selectedAddons.
 * @returns {string} A unique string key.
 */
const generateCartItemKey = ({ menuItemId, selectedVariant, selectedAddons }) => {
    const variantPart = selectedVariant?.variantId || 'novariant';
    const addonsPart = (selectedAddons || [])
        .map(a => a.addonId)
        .sort()
        .join('-');
    return `${menuItemId}_${variantPart}_${addonsPart || 'noaddons'}`;
};

const getAndValidateMenuItemDetails = async (menuItemId, quantity, selectedVariant, selectedAddons) => {
    if (!mongoose.Types.ObjectId.isValid(menuItemId)) {
        throw { status: 400, message: "Invalid Menu Item ID format." };
    }
    const menuItem = await MenuItem.findById(menuItemId).lean();
    if (!menuItem) {
        throw { status: 404, message: "Menu item not found." };
    }
    if (!menuItem.isAvailable) {
        throw { status: 400, message: `${menuItem.itemName} is currently unavailable.`};
    }

    const minQty = menuItem.minimumQuantity || 1;
    if (quantity < minQty) {
        throw { status: 400, message: `The minimum required quantity for this item is ${minQty}.` };
    }
    if (menuItem.maximumQuantity && quantity > menuItem.maximumQuantity) {
        throw { status: 400, message: `You can only add a maximum of ${menuItem.maximumQuantity} for this item.` };
    }

    const normalizedVariant = (selectedVariant && selectedVariant.groupId && selectedVariant.variantId) ? selectedVariant : null;
    const normalizedAddons = selectedAddons || [];

    if (normalizedVariant) {
        const group = menuItem.variantGroups.find(g => g.groupId === normalizedVariant.groupId);
        if (!group || !group.variants.some(v => v.variantId === normalizedVariant.variantId)) {
            throw { status: 400, message: "Invalid variant selected." };
        }
    }

    if (normalizedAddons.length > 0) {
        const addonMap = new Map();
        menuItem.addonGroups.forEach(g => g.addons.forEach(a => addonMap.set(a.addonId, g.groupId)));
        for (const selection of normalizedAddons) {
            if (!addonMap.has(selection.addonId) || addonMap.get(selection.addonId) !== selection.groupId) {
                throw { status: 400, message: `Invalid addon selected: ${selection.addonId}.` };
            }
        }
    }

    return {
        menuItem,
        cartField: menuItem.isFood ? 'foodCart' : 'groceriesCart',
        restaurantId: menuItem.restaurantId.toString(),
        itemData: { 
            menuItemId, 
            quantity, 
            selectedVariant: normalizedVariant, 
            selectedAddons: normalizedAddons
        },
    };
};

const processCartItemsForSummary = (cart) => {
    // This function remains the same
    return cart.map(cartItem => {
        const { menuItemId: menuItem, quantity, selectedVariant, selectedAddons } = cartItem;
        let lineItemSubtotal = menuItem.basePrice;
        if (selectedVariant?.variantId) {
            const group = menuItem.variantGroups.find(g => g.groupId === selectedVariant.groupId);
            const variant = group?.variants.find(v => v.variantId === selectedVariant.variantId);
            if (variant) lineItemSubtotal += (variant.additionalPrice || 0);
        }
        if (selectedAddons?.length) {
            selectedAddons.forEach(addon => {
                const group = menuItem.addonGroups.find(g => g.groupId === addon.groupId);
                const option = group?.addons.find(a => a.addonId === addon.addonId);
                if (option) lineItemSubtotal += (option.price || 0);
            });
        }
        const itemTotal = lineItemSubtotal * quantity;
        const itemTax = itemTotal * (menuItem.gst / 100);
        return { itemTotal, itemTax };
    });
};

const calculatePricingSummary = (processedItems) => {
    // This function remains the same
    if (processedItems.length === 0) {
        return { subtotal: 0, tax: 0, deliveryFee: 0, totalAmount: 0, itemCount: 0 };
    }
    const subtotal = processedItems.reduce((acc, item) => acc + item.itemTotal, 0);
    const tax = processedItems.reduce((acc, item) => acc + item.itemTax, 0);
    const totalAmount = subtotal + tax + DELIVERY_FEE;
    return {
        subtotal: Math.round(subtotal * 100) / 100,
        tax: Math.round(tax * 100) / 100,
        deliveryFee: DELIVERY_FEE,
        totalAmount: Math.round(totalAmount * 100) / 100,
    };
};

// --- Main Controller Functions ---

export const addItemToCart = async (req, res, next) => {
    try {
        const userId = req.user?._id;
        const { menuItemId, quantity = 1, selectedVariant, selectedAddons } = req.body;

        const { menuItem, cartField, restaurantId, itemData } = await getAndValidateMenuItemDetails(menuItemId, quantity, selectedVariant, selectedAddons);

        const user = await User.findById(userId).populate(`${cartField}.menuItemId`, 'restaurantId');
        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }

        const existingCart = user[cartField];
        if (existingCart.length > 0 && existingCart[0].menuItemId) {
            const cartRestaurantId = existingCart[0].menuItemId.restaurantId.toString();
            if (cartRestaurantId !== restaurantId) {
                return res.status(409).json({ message: "Your cart contains items from another restaurant. Please clear your cart to add items from this restaurant." });
            }
        }

        const cartItemKey = generateCartItemKey(itemData);
        const existingItem = existingCart.find(item => item.cartItemKey === cartItemKey);

        if (existingItem) {
            const newQuantity = existingItem.quantity + quantity;
            if (menuItem.maximumQuantity && newQuantity > menuItem.maximumQuantity) {
                return res.status(400).json({ success: false, message: `This would exceed the maximum allowed quantity (${menuItem.maximumQuantity}) for this item.` });
            }
            existingItem.quantity = newQuantity;
        } else {
            existingCart.push({ ...itemData, cartItemKey });
        }

        await user.save();
        return res.status(200).json({ success: true, message: "Item added to cart successfully." });
    } catch (error) {
        logger.error("Error in addItemToCart", { error: error.message, status: error.status });
        next(error);
    }
};

export const getCart = async (req, res, next) => {
    // This function remains largely the same but returns the cartItemKey now.
    try {
        const userId = req.user?._id;
        const user = await User.findById(userId)
            .populate({ path: 'foodCart.menuItemId' })
            .populate({ path: 'groceriesCart.menuItemId' })
            .lean();

        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }
        
        const enrichCart = (cart) => {
            if (!cart || cart.length === 0) return [];
            return cart.map(item => {
                if (!item.menuItemId) return null;
                const enrichedItem = { ...item };
                if (item.selectedVariant?.variantId) {
                    const group = item.menuItemId.variantGroups.find(g => g.groupId === item.selectedVariant.groupId);
                    if (group) enrichedItem.selectedVariant.details = group.variants.find(v => v.variantId === item.selectedVariant.variantId);
                }
                if (item.selectedAddons?.length > 0) {
                    enrichedItem.selectedAddons = item.selectedAddons.map(sa => {
                        const group = item.menuItemId.addonGroups.find(g => g.groupId === sa.groupId);
                        if (group) {
                            const addon = group.addons.find(a => a.addonId === sa.addonId);
                            return { ...sa, details: addon };
                        }
                        return sa;
                    }).filter(sa => sa.details);
                }
                return enrichedItem;
            }).filter(Boolean);
        };

        return res.status(200).json({
            success: true, message: "Carts retrieved successfully.",
            data: {
                foodCart: enrichCart(user.foodCart),
                groceriesCart: enrichCart(user.groceriesCart)
            }
        });
    } catch (error) {
        logger.error("Error fetching cart", { error: error.message });
        next(error);
    }
};

export const getCartSummary = async (req, res, next) => {
    // This function remains the same
    try {
        const userId = req.user?._id;
        const { cartType } = req.query;
        if (!['food', 'groceries'].includes(cartType)) {
            return res.status(400).json({ message: "A valid cartType ('food' or 'groceries') is required." });
        }
        const cartField = cartType === 'food' ? 'foodCart' : 'groceriesCart';
        const user = await User.findById(userId).populate(`${cartField}.menuItemId`).lean();
        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }
        const cart = user[cartField];
        const processedItems = processCartItemsForSummary(cart);
        const pricingSummary = calculatePricingSummary(processedItems);
        const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
        return res.status(200).json({ success: true, data: { itemCount: totalItems, ...pricingSummary } });
    } catch (error) {
        logger.error("Error getting cart summary", { error: error.message });
        next(error);
    }
};

export const updateItemQuantity = async (req, res, next) => {
    try {
        const userId = req.user?._id;
        // **API CHANGE**: Now uses cartItemKey
        const { cartType, cartItemKey, quantity } = req.body;

        if (!['foodCart', 'groceriesCart'].includes(cartType)) {
            return res.status(400).json({ message: "A valid cartType ('foodCart' or 'groceriesCart') is required." });
        }
        if (!cartItemKey || typeof quantity === 'undefined') {
            return res.status(400).json({ message: "cartItemKey and quantity are required." });
        }

        if (quantity === 0) {
            return removeItemFromCart(req, res, next);
        }

        // We need to fetch the user to validate min/max quantity against the specific item
        const user = await User.findById(userId).populate(`${cartType}.menuItemId`);
        const cart = user[cartType];
        const itemToUpdate = cart.find(item => item.cartItemKey === cartItemKey);

        if (!itemToUpdate) {
            return res.status(404).json({ message: "Item not found in cart." });
        }

        const menuItem = itemToUpdate.menuItemId;
        if (quantity < (menuItem.minimumQuantity || 1)) {
            return res.status(400).json({ message: `The minimum required quantity is ${menuItem.minimumQuantity || 1}.` });
        }
        if (menuItem.maximumQuantity && quantity > menuItem.maximumQuantity) {
            return res.status(400).json({ message: `The maximum allowed quantity is ${menuItem.maximumQuantity}.` });
        }

        itemToUpdate.quantity = quantity;
        await user.save();
        
        return res.status(200).json({ success: true, message: "Item quantity updated successfully." });
    } catch (error) {
        logger.error("Error updating item quantity", { error: error.message });
        next(error);
    }
};

export const removeItemFromCart = async (req, res, next) => {
    try {
        const userId = req.user?._id;
        // **API CHANGE**: Now uses cartItemKey
        const { cartType, cartItemKey } = req.body;

        if (!['foodCart', 'groceriesCart'].includes(cartType)) {
            return res.status(400).json({ message: "A valid cartType ('foodCart' or 'groceriesCart') is required." });
        }
        if (!cartItemKey) {
            return res.status(400).json({ message: "cartItemKey is required." });
        }

        const result = await User.updateOne(
            { _id: userId },
            { $pull: { [cartType]: { cartItemKey: cartItemKey } } }
        );

        if (result.modifiedCount === 0) {
            return res.status(404).json({ message: "Item not found in cart." });
        }

        return res.status(200).json({ success: true, message: "Item removed from cart successfully." });
    } catch (error) {
        logger.error("Error removing item from cart", { error: error.message });
        next(error);
    }
};

export const clearCart = async (req, res, next) => {
    try {
        const userId = req.user?._id;
        const { cartType } = req.body;
        if (!['food', 'groceries'].includes(cartType)) {
            return res.status(400).json({ message: "A valid cartType ('food' or 'groceries') is required." });
        }
        const cartField = cartType === 'food' ? 'foodCart' : 'groceriesCart';
        await User.updateOne({ _id: userId }, { $set: { [cartField]: [] } });
        return res.status(200).json({ message: `Your ${cartType} cart has been cleared.` });
    } catch (error) {
        logger.error("Error clearing cart", { error: error.message });
        next(error);
    }
};