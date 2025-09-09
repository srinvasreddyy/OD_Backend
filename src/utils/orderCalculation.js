import MenuItem from '../models/MenuItem.js';
import { getDistanceFromLatLonInMiles } from './locationUtils.js';

export const validateCart = (cart) => {
    if (!cart || cart.length === 0) {
        return { error: "Cannot process an empty cart.", restaurantId: null };
    }
    const restaurantId = cart[0].menuItemId.restaurantId.toString();
    const allItemsFromSameRestaurant = cart.every(item => item.menuItemId.restaurantId.toString() === restaurantId);
    if (!allItemsFromSameRestaurant) {
        return { error: "All items in the cart must be from the same restaurant.", restaurantId: null };
    }
    return { error: null, restaurantId };
};

export const processOrderItems = async (cart) => {
    const itemIds = cart.map(item => item.menuItemId._id);
    const freshMenuItems = await MenuItem.find({ '_id': { $in: itemIds } }).lean();
    const freshMenuItemsMap = new Map(freshMenuItems.map(item => [item._id.toString(), item]));

    return cart.map(cartItem => {
        const menuItem = freshMenuItemsMap.get(cartItem.menuItemId._id.toString());
        if (!menuItem || !menuItem.isAvailable) {
            throw new Error(`Item "${cartItem.menuItemId.itemName}" is currently unavailable.`);
        }
        
        const { quantity, selectedVariant, selectedAddons } = cartItem;
        let lineItemSubtotalBeforeQuantity = menuItem.basePrice;

        const variantsDetails = [];
        if (selectedVariant?.variantId) {
            const group = menuItem.variantGroups.find(g => g.groupId === selectedVariant.groupId);
            const variant = group?.variants.find(v => v.variantId === selectedVariant.variantId);
            if (variant) {
                lineItemSubtotalBeforeQuantity += (variant.additionalPrice || 0);
                variantsDetails.push({ ...selectedVariant, variantName: variant.variantName, additionalPrice: variant.additionalPrice });
            }
        }

        const addonsDetails = [];
        if (selectedAddons?.length) {
            selectedAddons.forEach(addon => {
                const group = menuItem.addonGroups.find(g => g.groupId === addon.groupId);
                const option = group?.addons.find(a => a.addonId === addon.addonId);
                if (option) {
                    lineItemSubtotalBeforeQuantity += (option.price || 0);
                    addonsDetails.push({ ...addon, optionTitle: option.optionTitle, price: option.price });
                }
            });
        }
        
        return {
            itemId: menuItem._id,
            itemName: menuItem.itemName,
            basePrice: menuItem.basePrice,
            quantity,
            selectedVariants: variantsDetails,
            selectedAddons: addonsDetails,
            itemTotal: lineItemSubtotalBeforeQuantity * quantity,
        };
    });
};

export const calculateDeliveryFee = (lat1, lon1, lat2, lon2, settings) => {
    const distance = getDistanceFromLatLonInMiles(lat1, lon1, lat2, lon2);
    if (distance > settings.maxDeliveryRadius) {
        return -1; 
    }
    if (distance <= settings.freeDeliveryRadius) {
        return 0;
    }
    const chargeableDistance = distance - settings.freeDeliveryRadius;
    return Math.round(chargeableDistance * settings.chargePerMile * 100) / 100;
};

export const calculateOrderPricing = (processedItems, deliveryFee, restaurant, offerDetails = null) => {
    const subtotal = processedItems.reduce((acc, item) => acc + item.itemTotal, 0);
    const handlingCharge = subtotal * (restaurant.handlingChargesPercentage / 100);
    let discountAmount = 0;
    let finalDeliveryFee = deliveryFee;

    if (offerDetails && subtotal >= offerDetails.minOrderValue) {
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
                discountAmount = deliveryFee;
                finalDeliveryFee = 0;
                break;
        }
    }
    
    // Ensure discount does not exceed the subtotal + handling charge
    if (discountAmount > subtotal + handlingCharge) {
        discountAmount = subtotal + handlingCharge;
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