import Stripe from "stripe";
import User from '../models/User.js';
import { DELIVERY_FEE } from "../../constants.js";
import logger from "../utils/logger.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const processCartItemsForSummary = (cart) => {
    return cart.map(cartItem => {
        const { menuItemId: menuItem, quantity, selectedVariant, selectedAddons } = cartItem;
        if (!menuItem) {
            // This case can happen if a menu item was deleted after being added to a cart.
            // We'll filter these out later.
            return null; 
        }
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
    }).filter(Boolean); // Filter out any null items
};

const calculatePricingSummary = (processedItems) => {
    if (processedItems.length === 0) {
        return { subtotal: 0, tax: 0, deliveryFee: 0, totalAmount: 0 };
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

// --- Controller ---
export const createOrderCheckoutSession = async (req, res, next) => {
    try {
        const userId = req.user._id;
        const { cartType } = req.body; // Client specifies 'food' or 'groceries'

        if (!cartType || !['food', 'groceries'].includes(cartType)) {
            return res.status(400).json({ success: false, message: "A valid cartType ('food' or 'groceries') is required." });
        }
        
        const cartField = cartType === 'food' ? 'foodCart' : 'groceriesCart';

        // 1. Fetch user and the specific cart with fresh menu item data
        const user = await User.findById(userId).populate(`${cartField}.menuItemId`).lean();
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        const cart = user[cartField];
        if (!cart || cart.length === 0) {
            return res.status(400).json({ success: false, message: "Cannot create a checkout session for an empty cart." });
        }

        // 2. Securely recalculate the total price on the backend
        const processedItems = processCartItemsForSummary(cart);
        const { totalAmount } = calculatePricingSummary(processedItems);

        if (totalAmount <= 0) {
            return res.status(400).json({ success: false, message: "Cart total must be greater than zero." });
        }

        // 3. Create Stripe line items and session
        const line_items = [{
            price_data: {
                currency: "inr",
                product_data: {
                    name: `Total Order for ${cart[0].menuItemId.restaurantId}`,
                    description: `Payment for ${cartType} cart.`
                },
                unit_amount: totalAmount * 100, // Convert to smallest currency unit (e.g., paise)
            },
            quantity: 1,
        }];

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items,
            mode: "payment",
            success_url: process.env.CLIENT_SUCCESS_REDIRECT_URL, 
            cancel_url: process.env.CLIENT_FAILURE_REDIRECT_URL,  
            customer_email: user.email, 
            metadata: {
                userId: userId.toString(),
                cartType: cartField
            }
        });

        res.status(200).json({ success: true, url: session.url, sessionId: session.id });

    } catch (error) {
        logger.error("Error creating Stripe checkout session", { error: error.message, userId: req.user?._id });
        next(error);
    }
};