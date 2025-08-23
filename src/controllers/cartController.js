import User from '../models/User.js';
import MenuItem from '../models/MenuItem.js';
import mongoose from 'mongoose';

// HELPER FUNCTION: VALIDATE AND PREPARE CART ITEM
// helper validates the entire item configuration against the MenuItem schema.
// It centralizes all validation logic for quantity, variants, and addons.
const getValidatedCartItem = async (menuItemId, quantity, selectedVariant, selectedAddons) => {
    const menuItem = await MenuItem.findById(menuItemId).lean();
    if (!menuItem) {
        throw { status: 404, message: "Menu item not found." };
    }

    // 1. Validate Quantity
    const min = menuItem.minimumQuantity || 1;
    const max = menuItem.maximumQuantity;

    if (quantity < min) {
        throw { status: 400, message: `The minimum required quantity for this item is ${min}.` };
    }
    if (max && quantity > max) {
        throw { status: 400, message: `You can only add a maximum of ${max} for this item.` };
    }

    // 2. Validate Selected Variant
    if (selectedVariant && selectedVariant.groupId && selectedVariant.variantId) {
        const group = menuItem.variantGroups.find(g => g.groupId === selectedVariant.groupId);
        if (!group || !group.variants.some(v => v.variantId === selectedVariant.variantId)) {
            throw { status: 400, message: "Invalid variant selected." };
        }
    } else {
        selectedVariant = null; // Normalize to null if not provided or incomplete
    }

    // 3. Validate Selected Addons
    selectedAddons = selectedAddons || []; 
    
    if (selectedAddons.length > 0) {
        const addonMap = new Map();
        menuItem.addonGroups.forEach(g => {
            g.addons.forEach(a => addonMap.set(a.addonId, g.groupId));
        });

        for (const selection of selectedAddons) {
            if (!addonMap.has(selection.addonId) || addonMap.get(selection.addonId) !== selection.groupId) {
                throw { status: 400, message: `Invalid addon selected: ${selection.addonId}.` };
            }
        }
    }
    
    // Check selection counts (min/max) for each group
    // IMPROVEMENT: This logic is more efficient (O(M+N)) than the previous nested loop (O(M*N)).
    const selectionsByGroup = new Map();
    selectedAddons.forEach(sa => {
        selectionsByGroup.set(sa.groupId, (selectionsByGroup.get(sa.groupId) || 0) + 1);
    });

    for (const group of menuItem.addonGroups) {
        const selectionCount = selectionsByGroup.get(group.groupId) || 0;
        if ((group.customizationBehavior === 'compulsory' || group.minSelection > 0) && selectionCount < group.minSelection) {
            throw { status: 400, message: `You must select at least ${group.minSelection} addon(s) from "${group.groupTitle}".` };
        }
        if (group.maxSelection && selectionCount > group.maxSelection) {
            throw { status: 400, message: `You can select at most ${group.maxSelection} addon(s) from "${group.groupTitle}".` };
        }
    }

    return {
        cartField: menuItem.isFood ? 'foodCart' : 'groceriesCart',
        itemData: {
            menuItemId,
            quantity,
            selectedVariant,
            selectedAddons,
        },
        maxQuantity: max
    };
};


// 1. ADD ITEM OR INCREMENT QUANTITY
//  It first attempts to increment
// an existing item. If that fails, it checks if the failure was due to max quantity
// limits before adding the new item. 
export const addItemToCart = async (req, res) => {
    try {
        const { userId } = req.params;
        const { menuItemId, quantity = 1, selectedVariant, selectedAddons } = req.body;

        if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(menuItemId)) {
            return res.status(400).json({ message: "Invalid ID format provided." });
        }

        const { cartField, itemData, maxQuantity } = await getValidatedCartItem(menuItemId, quantity, selectedVariant, selectedAddons);
        
        const itemIdentifier = {
            'item.menuItemId': new mongoose.Types.ObjectId(menuItemId),
            'item.selectedVariant': itemData.selectedVariant,
            'item.selectedAddons': { $all: itemData.selectedAddons, $size: itemData.selectedAddons.length }
        };

        // First, try to increment the quantity of an existing item atomically.
        const result = await User.updateOne(
            { _id: userId },
            { $inc: { [`${cartField}.$[item].quantity`]: quantity } },
            { arrayFilters: [itemIdentifier] }
        );

        if (result.modifiedCount > 0) {
            // Success: The item existed and its quantity was incremented.
            // We need to ensure the new quantity did not exceed the maximum.
            if (maxQuantity) {
                 const user = await User.findOne({ _id: userId, [`${cartField}.menuItemId`]: menuItemId }).select(cartField).lean();
                 const updatedItem = user[cartField].find(item => 
                    item.menuItemId.equals(menuItemId) &&
                    JSON.stringify(item.selectedVariant) === JSON.stringify(itemData.selectedVariant)
                 );
                 if (updatedItem && updatedItem.quantity > maxQuantity) {
                    // Revert the change if it exceeded the max quantity.
                    await User.updateOne({ _id: userId }, { $inc: { [`${cartField}.$[item].quantity`]: -quantity } }, { arrayFilters: [itemIdentifier] });
                    return res.status(400).json({ message: `Adding this would exceed the maximum quantity of ${maxQuantity}.` });
                 }
            }
            return res.status(200).json({ message: "Item quantity updated successfully." });
        } else {
            // The item was not found to increment, so we add it to the cart.
            // First, ensure the user document itself exists.
            const userExists = await User.findById(userId).select('_id');
            if (!userExists) {
                return res.status(404).json({ message: "User not found." });
            }

            await User.updateOne(
                { _id: userId },
                { $push: { [cartField]: itemData } }
            );
            return res.status(201).json({ message: "Item added to cart successfully." });
        }

    } catch (error) {
        res.status(error.status || 500).json({ message: error.message || "Server error" });
    }
};


// 2. GET CART CONTENTS
export const getCart = async (req, res) => {
    try {
        const { userId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ message: "Invalid User ID format provided." });
        }

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
                
                if (item.selectedVariant && item.selectedVariant.variantId) {
                    const group = item.menuItemId.variantGroups.find(g => g.groupId === item.selectedVariant.groupId);
                    if (group) {
                        enrichedItem.selectedVariant.details = group.variants.find(v => v.variantId === item.selectedVariant.variantId);
                    }
                }

                if (item.selectedAddons && item.selectedAddons.length > 0) {
                    enrichedItem.selectedAddons = item.selectedAddons.map(sa => {
                        const group = item.menuItemId.addonGroups.find(g => g.groupId === sa.groupId);
                        if (group) {
                            const addon = group.addons.find(a => a.addonId === sa.addonId);
                            return { ...sa, details: addon };
                        }
                        return sa;
                    });
                }
                return enrichedItem;
            }).filter(Boolean);
        };

        res.status(200).json({
            message: "Carts retrieved successfully.",
            data: {
                foodCart: enrichCart(user.foodCart),
                groceriesCart: enrichCart(user.groceriesCart)
            }
        });

    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};


// 3. UPDATE ITEM QUANTITY
export const updateItemQuantity = async (req, res) => {
    try {
        const { userId } = req.params;
        const { menuItemId, quantity, selectedVariant, selectedAddons } = req.body;

        if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(menuItemId)) {
            return res.status(400).json({ message: "Invalid ID format provided." });
        }
        if (typeof quantity === 'undefined') {
            return res.status(400).json({ message: "Quantity is required." });
        }

        const menuItem = await MenuItem.findById(menuItemId).select('isFood minimumQuantity maximumQuantity').lean();
        if (!menuItem) {
            return res.status(404).json({ message: "Menu item not found." });
        }

        const cartField = menuItem.isFood ? 'foodCart' : 'groceriesCart';
        
        const itemToUpdate = {
            menuItemId: new mongoose.Types.ObjectId(menuItemId),
            selectedVariant: selectedVariant || null,
            selectedAddons: selectedAddons || []
        };
        
        if (quantity === 0) {
            const result = await User.updateOne(
                { _id: userId },
                { $pull: { [cartField]: { 
                    menuItemId: itemToUpdate.menuItemId,
                    selectedVariant: itemToUpdate.selectedVariant,
                    selectedAddons: itemToUpdate.selectedAddons
                }}}
            );
            if (result.modifiedCount === 0) {
                 return res.status(404).json({ message: "Item with the specified configuration not found in cart." });
            }
            return res.status(200).json({ message: "Item removed from cart." });
        }

        if (quantity < (menuItem.minimumQuantity || 1)) {
            return res.status(400).json({ message: `The minimum required quantity is ${menuItem.minimumQuantity || 1}.` });
        }
        if (menuItem.maximumQuantity && quantity > menuItem.maximumQuantity) {
            return res.status(400).json({ message: `The maximum allowed quantity is ${menuItem.maximumQuantity}.` });
        }
        
        const result = await User.updateOne(
            { _id: userId },
            { $set: { [`${cartField}.$[item].quantity`]: quantity } },
            { 
                arrayFilters: [{ 
                    'item.menuItemId': itemToUpdate.menuItemId, 
                    'item.selectedVariant': itemToUpdate.selectedVariant, 
                    'item.selectedAddons': { $all: itemToUpdate.selectedAddons, $size: itemToUpdate.selectedAddons.length } 
                }] 
            }
        );
        
        if (result.matchedCount === 0) {
            return res.status(404).json({ message: "Item with the specified configuration not found in cart." });
        }

        res.status(200).json({ message: "Item quantity updated successfully." });

    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};


// 4. REMOVE A SINGLE ITEM
export const removeItemFromCart = async (req, res) => {
    try {
        const { userId } = req.params;
        const { menuItemId, selectedVariant, selectedAddons } = req.body;

        if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(menuItemId)) {
            return res.status(400).json({ message: "Invalid ID format provided." });
        }
        
        const menuItem = await MenuItem.findById(menuItemId).select('isFood').lean();
        if (!menuItem) {
            return res.status(404).json({ message: "Menu item not found." });
        }

        const cartField = menuItem.isFood ? 'foodCart' : 'groceriesCart';
        
        const itemToRemove = {
            menuItemId: new mongoose.Types.ObjectId(menuItemId),
            selectedVariant: selectedVariant || null,
            selectedAddons: selectedAddons || []
        };
        
        const result = await User.updateOne(
            { _id: userId },
            { $pull: { [cartField]: itemToRemove } }
        );

        if (result.modifiedCount === 0) {
            return res.status(404).json({ message: "Item with the specified configuration not found in cart." });
        }

        res.status(200).json({ message: "Item removed from cart successfully." });

    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};


// 5. CLEAR AN ENTIRE CART
export const clearCart = async (req, res) => {
    try {
        const { userId } = req.params;
        const { cartType } = req.body;

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ message: "Invalid User ID format provided." });
        }

        if (!['food', 'groceries'].includes(cartType)) {
            return res.status(400).json({ message: "A valid cartType ('food' or 'groceries') is required." });
        }

        const cartField = cartType === 'food' ? 'foodCart' : 'groceriesCart';

        const result = await User.updateOne(
            { _id: userId },
            { $set: { [cartField]: [] } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ message: "User not found." });
        }

        res.status(200).json({ message: `Your ${cartType} cart has been cleared.` });

    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};