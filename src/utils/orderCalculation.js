import MenuItem from '../models/MenuItem.js';
import { getDistanceFromLatLonInMiles } from './locationUtils.js';

export const validateCart = (cart) => {
    if (!cart || cart.length === 0) {
        return { error: "Cannot process an empty cart.", restaurantId: null };
    }
    const restaurantId = cart[0].menuItemId.restaurantId.toString();
    const allItemsFromSameRestaurant = cart.every(item => 
        item.menuItemId.restaurantId && item.menuItemId.restaurantId.toString() === restaurantId
    );
    if (!allItemsFromSameRestaurant) {
        return { error: "All items in the cart must be from the same restaurant.", restaurantId: null };
    }
    return { error: null, restaurantId };
};

export const processOrderItems = async (cart) => {
    const itemIds = cart.map(item => item.menuItemId._id || item.menuItemId);
    const freshMenuItems = await MenuItem.find({ '_id': { $in: itemIds } }).lean();
    const freshMenuItemsMap = new Map(freshMenuItems.map(item => [item._id.toString(), item]));

    return cart.map(cartItem => {
        const itemIdString = cartItem.menuItemId._id ? cartItem.menuItemId._id.toString() : cartItem.menuItemId.toString();
        const menuItem = freshMenuItemsMap.get(itemIdString);
        
        if (!menuItem || !menuItem.isAvailable) {
            throw new Error(`Item "${menuItem?.itemName || 'Unknown'}" is currently unavailable.`);
        }
        
        const { quantity, selectedVariants, selectedAddons } = cartItem;
        
        // Start with Base Price
        let unitPrice = parseFloat(menuItem.basePrice || 0);

        // --- 1. Process Variants ---
        const variantsDetails = [];
        if (Array.isArray(selectedVariants) && selectedVariants.length > 0) {
            selectedVariants.forEach(sv => {
                // Robust ID Matching (String vs UUID)
                const group = menuItem.variantGroups?.find(g => String(g.groupId) === String(sv.groupId));
                if (group) {
                    const variant = group.variants?.find(v => String(v.variantId) === String(sv.variantId));
                    if (variant) {
                        const additionalPrice = parseFloat(variant.additionalPrice || 0);
                        unitPrice += additionalPrice;
                        
                        variantsDetails.push({ 
                            groupId: sv.groupId,
                            variantId: sv.variantId,
                            variantName: variant.variantName, 
                            additionalPrice: additionalPrice,
                            groupTitle: group.groupTitle 
                        });
                    }
                }
            });
        }

        // --- 2. Process Addons ---
        const addonsDetails = [];
        if (Array.isArray(selectedAddons) && selectedAddons.length > 0) {
            selectedAddons.forEach(addon => {
                // Robust ID Matching
                const group = menuItem.addonGroups?.find(g => String(g.groupId) === String(addon.groupId));
                if (group) {
                    const option = group.addons?.find(a => String(a.addonId) === String(addon.addonId));
                    if (option) {
                        const addonPrice = parseFloat(option.price || 0);
                        unitPrice += addonPrice;
                        
                        addonsDetails.push({ 
                            groupId: addon.groupId,
                            addonId: addon.addonId,
                            optionTitle: option.optionTitle, 
                            price: addonPrice 
                        });
                    }
                }
            });
        }
        
        return {
            itemId: menuItem._id,
            itemName: menuItem.itemName,
            basePrice: parseFloat(menuItem.basePrice),
            quantity: Number(quantity),
            selectedVariants: variantsDetails,
            selectedAddons: addonsDetails,
            itemTotal: unitPrice * Number(quantity),
        };
    });
};

export const calculateDeliveryFee = (lat1, lon1, lat2, lon2, settings) => {
    if (!settings) return 0;
    const distance = getDistanceFromLatLonInMiles(lat1, lon1, lat2, lon2);
    if (distance > settings.maxDeliveryRadius) return -1;
    if (distance <= settings.freeDeliveryRadius) return 0;
    const chargeableDistance = distance - settings.freeDeliveryRadius;
    return Math.round(chargeableDistance * settings.chargePerMile * 100) / 100;
};

export const calculateOrderPricing = (processedItems, deliveryFee, restaurant, offerDetails = null) => {
    const subtotal = processedItems.reduce((acc, item) => acc + item.itemTotal, 0);
    const handlingCharge = subtotal * ((restaurant.handlingChargesPercentage || 0) / 100);
    
    let discountAmount = 0;
    let finalDeliveryFee = Math.max(0, deliveryFee);

    if (offerDetails && subtotal >= (offerDetails.minOrderValue || 0)) {
        switch (offerDetails.discountType) {
            case 'PERCENTAGE':
                discountAmount = subtotal * (offerDetails.discountValue / 100);
                if (offerDetails.maxDiscountAmount && discountAmount > offerDetails.maxDiscountAmount) {
                    discountAmount = offerDetails.maxDiscountAmount;
                }
                break;
            case 'FLAT':
                discountAmount = offerDetails.discountValue;
                break;
            case 'FREE_DELIVERY':
                discountAmount = finalDeliveryFee;
                finalDeliveryFee = 0;
                break;
        }
    }
    
    const maxApplicableDiscount = subtotal + handlingCharge;
    if (discountAmount > maxApplicableDiscount) {
        discountAmount = maxApplicableDiscount;
    }
    
    const totalAmount = subtotal + handlingCharge + finalDeliveryFee - discountAmount;

    const pricing = { 
        subtotal: Math.round(subtotal * 100) / 100,
        deliveryFee: Math.round(finalDeliveryFee * 100) / 100,
        handlingCharge: Math.round(handlingCharge * 100) / 100, 
        discountAmount: Math.round(discountAmount * 100) / 100,
        totalAmount: Math.round(totalAmount * 100) / 100 
    };
    
    const appliedOffer = offerDetails && discountAmount > 0 ? {
        promoCode: offerDetails.promoCode,
        discountType: offerDetails.discountType,
        discountAmount: pricing.discountAmount
    } : null;

    return { pricing, appliedOffer };
};