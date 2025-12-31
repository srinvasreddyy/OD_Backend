import mongoose from "mongoose";
import User from '../models/User.js';
import MenuItem from '../models/MenuItem.js';
import Restaurant from "../models/Restaurant.js";
import Announcement from "../models/Announcements.js";
import logger from "../utils/logger.js";
import { calculateOrderPricing, processOrderItems, calculateDeliveryFee } from "../utils/orderCalculation.js";

// --- Helper Functions ---

const generateCartItemKey = ({ menuItemId, selectedVariants, selectedAddons }) => {
    // Robust Key Generation: Sorts IDs to ensure uniqueness regardless of order
    const variantPart = (Array.isArray(selectedVariants) ? selectedVariants : [])
        .map(v => `${v.groupId}:${v.variantId}`)
        .sort()
        .join('-');
        
    const addonsPart = (Array.isArray(selectedAddons) ? selectedAddons : [])
        .map(a => a.addonId)
        .sort()
        .join('-');
        
    return `${menuItemId}_${variantPart || 'novar'}_${addonsPart || 'noaddons'}`;
};

const getAndValidateMenuItemDetails = async (menuItemId, quantity, selectedVariants, selectedAddons) => {
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

    // --- Validate Variants (Ensure Array) ---
    const normalizedVariants = Array.isArray(selectedVariants) ? selectedVariants : [];
    if (normalizedVariants.length > 0) {
        for (const selection of normalizedVariants) {
             // Robust String Comparison
             const group = menuItem.variantGroups?.find(g => String(g.groupId) === String(selection.groupId));
             if (!group) throw { status: 400, message: "Invalid variant group selected." };
             
             const variant = group.variants?.find(v => String(v.variantId) === String(selection.variantId));
             if (!variant) throw { status: 400, message: `Invalid variant option selected.` };
        }
    }

    // --- Validate Addons (Ensure Array) ---
    const normalizedAddons = Array.isArray(selectedAddons) ? selectedAddons : [];
    if (normalizedAddons.length > 0) {
        const addonMap = new Map();
        // Map AddonID -> GroupID for validation
        menuItem.addonGroups?.forEach(g => g.addons.forEach(a => addonMap.set(String(a.addonId), String(g.groupId))));
        
        for (const selection of normalizedAddons) {
            const sAddonId = String(selection.addonId);
            const sGroupId = String(selection.groupId);
            
            if (!addonMap.has(sAddonId) || addonMap.get(sAddonId) !== sGroupId) {
                throw { status: 400, message: `Invalid addon selected: ${selection.addonId}.` };
            }
        }
        
        // Check Min/Max/Compulsory constraints
        menuItem.addonGroups?.forEach(group => {
            const selectedCountForGroup = normalizedAddons.filter(a => String(a.groupId) === String(group.groupId)).length;
            
            if (group.customizationBehavior === 'compulsory' && selectedCountForGroup === 0) {
                 throw { status: 400, message: `Selection required for: ${group.groupTitle}` };
            }
            if (group.minSelection && selectedCountForGroup < group.minSelection) {
                 throw { status: 400, message: `Please select at least ${group.minSelection} options for ${group.groupTitle}` };
            }
            if (group.maxSelection && selectedCountForGroup > group.maxSelection) {
                 throw { status: 400, message: `You can only select up to ${group.maxSelection} options for ${group.groupTitle}` };
            }
        });
    }

    return {
        menuItem,
        cartField: menuItem.isFood ? 'foodCart' : 'groceriesCart',
        restaurantId: menuItem.restaurantId.toString(),
        itemData: { 
            menuItemId, 
            quantity, 
            selectedVariants: normalizedVariants, 
            selectedAddons: normalizedAddons
        },
    };
};

const clearAppliedPromo = (user) => {
    if (user.customerProfile?.appliedPromo?.code) {
        user.customerProfile.appliedPromo = undefined;
    }
};

// --- Main Controller Functions ---

export const addItemToCart = async (req, res, next) => {
    try {
        const userId = req.user?._id;
        const { menuItemId, quantity = 1, selectedVariants, selectedAddons } = req.body;

        const { menuItem, cartField, restaurantId, itemData } = await getAndValidateMenuItemDetails(menuItemId, quantity, selectedVariants, selectedAddons);

        const user = await User.findById(userId).populate({
            path: `${cartField}.menuItemId`,
            select: 'restaurantId'
        });
        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }

        const existingCart = user[cartField];
        if (existingCart.length > 0 && existingCart[0].menuItemId) {
            const cartRestaurantId = existingCart[0].menuItemId.restaurantId.toString();
            if (cartRestaurantId !== restaurantId) {
                clearAppliedPromo(user); 
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
                
                // Enrich Variants (Safely handle potentially missing arrays)
                if (Array.isArray(item.selectedVariants) && item.selectedVariants.length > 0) {
                    enrichedItem.selectedVariants = item.selectedVariants.map(sv => {
                        const group = item.menuItemId.variantGroups?.find(g => String(g.groupId) === String(sv.groupId));
                        if (group) {
                            const variant = group.variants?.find(v => String(v.variantId) === String(sv.variantId));
                            if (variant) {
                                return { ...sv, details: variant, groupTitle: group.groupTitle };
                            }
                        }
                        return null;
                    }).filter(Boolean);
                }

                // Enrich Addons
                if (Array.isArray(item.selectedAddons) && item.selectedAddons.length > 0) {
                    enrichedItem.selectedAddons = item.selectedAddons.map(sa => {
                        const group = item.menuItemId.addonGroups?.find(g => String(g.groupId) === String(sa.groupId));
                        if (group) {
                            const addon = group.addons?.find(a => String(a.addonId) === String(sa.addonId));
                            if (addon) {
                                return { ...sa, details: addon };
                            }
                        }
                        return null;
                    }).filter(Boolean);
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
    try {
        const userId = req.user?._id;
        const { cartType, lat, lng, mode } = req.query; // Added mode for pickup

        if (!['foodCart', 'groceriesCart'].includes(cartType)) {
            return res.status(400).json({ message: "A valid cartType ('foodCart' or 'groceriesCart') is required." });
        }
        
        const user = await User.findById(userId).populate(`${cartType}.menuItemId`);
        if (!user) return res.status(404).json({ message: "User not found." });

        const cart = user[cartType];
        if (cart.length === 0) {
            clearAppliedPromo(user); 
            await user.save();
            return res.status(200).json({ success: true, data: { itemCount: 0, subtotal: 0, handlingCharge: 0, deliveryFee: null, totalAmount: 0 } });
        }
        
        const restaurantId = cart[0].menuItemId.restaurantId;
        const restaurant = await Restaurant.findById(restaurantId).lean();
        if(!restaurant) return res.status(404).json({ message: "Restaurant for items in cart not found." });
        
        const processedItems = await processOrderItems(cart);
        
        // --- Promo Logic ---
        let offerDetails = null;
        const appliedPromo = user.customerProfile?.appliedPromo;

        if (appliedPromo?.code && appliedPromo.cartType === cartType) {
            const offer = await Announcement.findOne({
                'offerDetails.promoCode': appliedPromo.code,
                isActive: true,
                'offerDetails.validUntil': { $gte: new Date() }
            }).lean();

            if (offer && offer.restaurantId.toString() === restaurant._id.toString()) {
                offerDetails = offer.offerDetails;
            } else {
                clearAppliedPromo(user);
                await user.save();
            }
        }
        
        // --- Calculate Delivery Fee ---
        let calculatedDeliveryFee = 0;
        let deliveryError = null;

        if (mode === 'pickup') {
            calculatedDeliveryFee = 0; 
        } else if (lat && lng) {
            const [restLon, restLat] = restaurant.address.coordinates.coordinates;
            const fee = calculateDeliveryFee(restLat, restLon, parseFloat(lat), parseFloat(lng), restaurant.deliverySettings);
            
            if (fee === -1) {
                deliveryError = "Out of delivery range";
                calculatedDeliveryFee = 0; 
            } else {
                calculatedDeliveryFee = fee;
            }
        }

        const { pricing, appliedOffer } = calculateOrderPricing(processedItems, calculatedDeliveryFee, restaurant, offerDetails);
        const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);

        return res.status(200).json({ 
            success: true, 
            data: { 
                itemCount: totalItems, 
                subtotal: pricing.subtotal,
                handlingCharge: pricing.handlingCharge,
                discountAmount: pricing.discountAmount,
                appliedOffer: appliedOffer,
                deliveryFee: calculatedDeliveryFee, 
                deliveryError: deliveryError,
                totalAmount: pricing.totalAmount,
            } 
        });
    } catch (error) {
        logger.error("Error getting cart summary", { error: error.message });
        next(error);
    }
};

export const updateItemQuantity = async (req, res, next) => {
    try {
        const userId = req.user?._id;
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
        const { cartType, cartItemKey } = req.body;

        if (!['foodCart', 'groceriesCart'].includes(cartType)) {
            return res.status(400).json({ message: "A valid cartType ('foodCart' or 'groceriesCart') is required." });
        }
        if (!cartItemKey) {
            return res.status(400).json({ message: "cartItemKey is required." });
        }
        
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }

        const cart = user[cartType];
        const itemIndex = cart.findIndex(item => item.cartItemKey === cartItemKey);

        if (itemIndex === -1) {
            return res.status(404).json({ message: "Item not found in cart." });
        }
        
        cart.splice(itemIndex, 1);
        
        if (cart.length === 0) {
            clearAppliedPromo(user);
        }

        await user.save();

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
        if (!['foodCart', 'groceriesCart'].includes(cartType)) {
            return res.status(400).json({ message: "A valid cartType ('foodCart' or 'groceriesCart') is required." });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }
        
        user[cartType] = [];
        clearAppliedPromo(user); 
        await user.save();

        return res.status(200).json({ message: `Your ${cartType} has been cleared.` });
    } catch (error) {
        logger.error("Error clearing cart", { error: error.message });
        next(error);
    }
};