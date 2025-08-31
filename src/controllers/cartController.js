import mongoose from "mongoose";
import User from '../models/User.js';
import MenuItem from '../models/MenuItem.js';

// --- Configuration ---
const DELIVERY_FEE = 50; // This can be moved to a constants file

// --- Helper Functions for Code Clarity and Reusability ---

/**
 * Fetches a menu item and validates the requested quantity, variant, and addons against its schema.
 * @param {string} menuItemId - The ID of the menu item to validate.
 * @param {number} quantity - The desired quantity.
 * @param {object} selectedVariant - The selected variant configuration.
 * @param {Array} selectedAddons - An array of selected addon configurations.
 * @returns {Promise<object>} - A promise that resolves to the validated menu item details.
 * @throws Will throw an error if validation fails.
 */
const getAndValidateMenuItemDetails = async (menuItemId, quantity, selectedVariant, selectedAddons) => {
    if (!mongoose.Types.ObjectId.isValid(menuItemId)) {
        throw { status: 400, message: "Invalid Menu Item ID format." };
    }
    const menuItem = await MenuItem.findById(menuItemId).lean();
    if (!menuItem) {
        throw { status: 404, message: "Menu item not found." };
    }

    // 1. Validate Quantity
    const minQty = menuItem.minimumQuantity || 1;
    if (quantity < minQty) {
        throw { status: 400, message: `The minimum required quantity for this item is ${minQty}.` };
    }
    if (menuItem.maximumQuantity && quantity > menuItem.maximumQuantity) {
        throw { status: 400, message: `You can only add a maximum of ${menuItem.maximumQuantity} for this item.` };
    }

    // 2. Validate Selected Variant
    if (selectedVariant && selectedVariant.groupId && selectedVariant.variantId) {
        const group = menuItem.variantGroups.find(g => g.groupId === selectedVariant.groupId);
        if (!group || !group.variants.some(v => v.variantId === selectedVariant.variantId)) {
            throw { status: 400, message: "Invalid variant selected." };
        }
    } else {
        selectedVariant = null; // Normalize if incomplete
    }

    // 3. Validate Selected Addons
    selectedAddons = selectedAddons || [];
    if (selectedAddons.length > 0) {
        const addonMap = new Map();
        menuItem.addonGroups.forEach(g => g.addons.forEach(a => addonMap.set(a.addonId, g.groupId)));
        for (const selection of selectedAddons) {
            if (!addonMap.has(selection.addonId) || addonMap.get(selection.addonId) !== selection.groupId) {
                throw { status: 400, message: `Invalid addon selected: ${selection.addonId}.` };
            }
        }
        
        const selectionsByGroup = new Map();
        selectedAddons.forEach(sa => selectionsByGroup.set(sa.groupId, (selectionsByGroup.get(sa.groupId) || 0) + 1));

        for (const group of menuItem.addonGroups) {
            const selectionCount = selectionsByGroup.get(group.groupId) || 0;
            if ((group.customizationBehavior === 'compulsory' || group.minSelection > 0) && selectionCount < group.minSelection) {
                throw { status: 400, message: `You must select at least ${group.minSelection} addon(s) from "${group.groupTitle}".` };
            }
            if (group.maxSelection && selectionCount > group.maxSelection) {
                throw { status: 400, message: `You can select at most ${group.maxSelection} addon(s) from "${group.groupTitle}".` };
            }
        }
    }

    return {
        cartField: menuItem.isFood ? 'foodCart' : 'groceriesCart',
        restaurantId: menuItem.restaurantId.toString(),
        itemData: { menuItemId, quantity, selectedVariant, selectedAddons },
    };
};

/**
 * Processes cart items to calculate subtotal and tax for each line item.
 * @param {Array} cart - The user's cart, populated with menu item details.
 * @returns {Array} An array of processed items with calculated pricing info.
 */
const processCartItemsForSummary = (cart) => {
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

/**
 * Calculates the final pricing summary for the entire cart.
 * @param {Array} processedItems - Array of items processed by `processCartItemsForSummary`.
 * @returns {Object} An object with final pricing details.
 */
const calculatePricingSummary = (processedItems) => {
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

/**
 * @description Adds an item to the cart or increments its quantity. Enforces that all items in a cart must be from the same restaurant.
 * @access Private (User)
 */
export const addItemToCart = async (req, res) => {
    try {
        const { userId } = req.user;
        const { menuItemId, quantity = 1, selectedVariant, selectedAddons } = req.body;

        const { cartField, restaurantId, itemData } = await getAndValidateMenuItemDetails(menuItemId, quantity, selectedVariant, selectedAddons);

        const user = await User.findById(userId).populate(`${cartField}.menuItemId`, 'restaurantId');
        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }

        // Enforce Single Restaurant Rule
        const existingCart = user[cartField];
        if (existingCart.length > 0) {
            const cartRestaurantId = existingCart[0].menuItemId.restaurantId.toString();
            if (cartRestaurantId !== restaurantId) {
                return res.status(409).json({ message: "Your cart contains items from another restaurant. Please clear your cart to add items from this restaurant." });
            }
        }
        
        const itemIdentifier = {
            'item.menuItemId': new mongoose.Types.ObjectId(menuItemId),
            'item.selectedVariant': itemData.selectedVariant,
            'item.selectedAddons': { $all: itemData.selectedAddons, $size: itemData.selectedAddons.length }
        };

        // Atomically increment quantity if the exact item configuration exists
        const result = await User.updateOne(
            { _id: userId },
            { $inc: { [`${cartField}.$[item].quantity`]: quantity } },
            { arrayFilters: [itemIdentifier] }
        );

        if (result.modifiedCount > 0) {
            return res.status(200).json({ message: "Item quantity updated successfully." });
        } else {
            // If no item was incremented, add the new item to the cart
            await User.updateOne(
                { _id: userId },
                { $push: { [cartField]: itemData } }
            );
            return res.status(201).json({ message: "Item added to cart successfully." });
        }

    } catch (error) {
        return res.status(error.status || 500).json({ message: error.message || "An unexpected server error occurred." });
    }
};

/**
 * @description Retrieves and enriches the contents of the user's food and groceries carts.
 * @access Private (User)
 */
export const getCart = async (req, res) => {
    try {
        const { userId } = req.user;
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
                    if (group) {
                        enrichedItem.selectedVariant.details = group.variants.find(v => v.variantId === item.selectedVariant.variantId);
                    }
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
            message: "Carts retrieved successfully.",
            data: {
                foodCart: enrichCart(user.foodCart),
                groceriesCart: enrichCart(user.groceriesCart)
            }
        });
    } catch (error) {
        console.error("Error fetching cart:", error);
        return res.status(500).json({ message: "An unexpected server error occurred." });
    }
};

/**
 * @description Retrieves a summary of the cart including item count and final pricing.
 * @access Private (User)
 */
export const getCartSummary = async (req, res) => {
    try {
        const { userId } = req.user;
        const { cartType } = req.query; // Expects 'food' or 'groceries'

        if (!['food', 'groceries'].includes(cartType)) {
            return res.status(400).json({ message: "A valid cartType ('food' or 'groceries') is required in query params." });
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

        return res.status(200).json({
            success: true,
            data: {
                itemCount: totalItems,
                ...pricingSummary
            }
        });
    } catch (error) {
        console.error("Error getting cart summary:", error);
        return res.status(500).json({ message: "An unexpected server error occurred." });
    }
};

/**
 * @description Updates the quantity of a specific item configuration in the cart. Removes the item if quantity is 0.
 * @access Private (User)
 */
export const updateItemQuantity = async (req, res) => {
    try {
        const { userId } = req.user;
        const { cartType, menuItemId, quantity, selectedVariant, selectedAddons } = req.body;

        if (!['foodCart', 'groceriesCart'].includes(cartType)) {
            return res.status(400).json({ message: "A valid cartType ('foodCart' or 'groceriesCart') is required." });
        }
        if (typeof quantity === 'undefined') {
            return res.status(400).json({ message: "Quantity is required." });
        }

        const menuItem = await MenuItem.findById(menuItemId).select('minimumQuantity maximumQuantity').lean();
        if (!menuItem) {
            return res.status(404).json({ message: "Menu item not found." });
        }
        
        if (quantity === 0) {
            // Forward to removeItemFromCart logic
            return removeItemFromCart(req, res);
        }

        if (quantity < (menuItem.minimumQuantity || 1)) {
            return res.status(400).json({ message: `The minimum required quantity is ${menuItem.minimumQuantity || 1}.` });
        }
        if (menuItem.maximumQuantity && quantity > menuItem.maximumQuantity) {
            return res.status(400).json({ message: `The maximum allowed quantity is ${menuItem.maximumQuantity}.` });
        }
        
        const result = await User.updateOne(
            { _id: userId },
            { $set: { [`${cartType}.$[item].quantity`]: quantity } },
            { 
                arrayFilters: [{ 
                    'item.menuItemId': new mongoose.Types.ObjectId(menuItemId), 
                    'item.selectedVariant': selectedVariant || null, 
                    'item.selectedAddons': { $all: selectedAddons || [], $size: (selectedAddons || []).length } 
                }] 
            }
        );
        
        if (result.matchedCount === 0) {
            return res.status(404).json({ message: "Item with the specified configuration not found in cart." });
        }

        return res.status(200).json({ message: "Item quantity updated successfully." });
    } catch (error) {
        console.error("Error updating item quantity:", error);
        return res.status(500).json({ message: "An unexpected server error occurred." });
    }
};

/**
 * @description Removes a specific item configuration from the cart.
 * @access Private (User)
 */
export const removeItemFromCart = async (req, res) => {
    try {
        const { userId } = req.user;
        const { cartType, menuItemId, selectedVariant, selectedAddons } = req.body;

        if (!['foodCart', 'groceriesCart'].includes(cartType)) {
            return res.status(400).json({ message: "A valid cartType ('foodCart' or 'groceriesCart') is required." });
        }
        
        const result = await User.updateOne(
            { _id: userId },
            { $pull: { [cartType]: { 
                menuItemId: new mongoose.Types.ObjectId(menuItemId),
                selectedVariant: selectedVariant || null,
                selectedAddons: selectedAddons || []
            }}}
        );

        if (result.modifiedCount === 0) {
            return res.status(404).json({ message: "Item with the specified configuration not found in cart." });
        }

        return res.status(200).json({ message: "Item removed from cart successfully." });
    } catch (error) {
        console.error("Error removing item from cart:", error);
        return res.status(500).json({ message: "An unexpected server error occurred." });
    }
};

/**
 * @description Clears all items from either the food or groceries cart.
 * @access Private (User)
 */
export const clearCart = async (req, res) => {
    try {
        const { userId } = req.user;
        const { cartType } = req.body;

        if (!['food', 'groceries'].includes(cartType)) {
            return res.status(400).json({ message: "A valid cartType ('food' or 'groceries') is required." });
        }
        const cartField = cartType === 'food' ? 'foodCart' : 'groceriesCart';

        await User.updateOne(
            { _id: userId },
            { $set: { [cartField]: [] } }
        );

        return res.status(200).json({ message: `Your ${cartType} cart has been cleared.` });
    } catch (error) {
        console.error("Error clearing cart:", error);
        return res.status(500).json({ message: "An unexpected server error occurred." });
    }
};
