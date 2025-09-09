import mongoose from "mongoose";
import Stripe from "stripe";
import Restaurant from "../models/Restaurant.js";
import RestaurantTimings from "../models/RestaurantTimings.js";
import Table from "../models/Table.js";
import Booking from "../models/Booking.js";
import SlotLock from "../models/SlotLock.js";
import { generateUniqueOrderNumber } from "../utils/orderUtils.js";
import logger from "../utils/logger.js";
import config from "../config/env.js";

// --- Helper Functions ---
const getDayOfWeek = (date) => {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return days[date.getUTCDay()];
};

const generateTimeSlots = (start, end, intervalMinutes = 60) => {
    const slots = [];
    const [startHour, startMinute] = start.split(':').map(Number);
    const [endHour, endMinute] = end.split(':').map(Number);

    let currentHour = startHour;
    let currentMinute = startMinute;

    while (currentHour < endHour || (currentHour === endHour && currentMinute < endMinute)) {
        slots.push(`${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`);
        currentMinute += intervalMinutes;
        if (currentMinute >= 60) {
            currentHour += Math.floor(currentMinute / 60);
            currentMinute %= 60;
        }
    }
    return slots;
};


// --- Controller Functions ---

export const getAvailableSlots = async (req, res, next) => {
    try {
        const { restaurantId } = req.params;
        const { date, guests } = req.query;

        if (!date || !guests) {
            return res.status(400).json({ success: false, message: "Date and number of guests are required." });
        }

        const requestedDate = new Date(date);
        if (isNaN(requestedDate.getTime())) {
            return res.status(400).json({ success: false, message: "Invalid date format." });
        }
        
        requestedDate.setUTCHours(0, 0, 0, 0);

        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);

        const maxDate = new Date(today);
        maxDate.setUTCDate(today.getUTCDate() + 2);

        if (requestedDate < today || requestedDate > maxDate) {
            return res.status(400).json({ success: false, message: "Bookings are only available for today and the next 2 days." });
        }

        const dayOfWeek = getDayOfWeek(requestedDate);
        const guestCount = parseInt(guests, 10);
        
        if (isNaN(guestCount) || guestCount <= 0) {
            return res.status(400).json({ success: false, message: "Invalid number of guests." });
        }

        const restaurantTimings = await RestaurantTimings.findOne({ restaurantId });
        const dailyTimings = restaurantTimings?.timings.find(t => t.day === dayOfWeek && t.isOpen);

        if (!dailyTimings) {
            return res.status(200).json({ success: true, data: [], message: "The restaurant is closed on the selected date." });
        }

        const potentialSlots = generateTimeSlots(dailyTimings.openTime, dailyTimings.closeTime);

        const availableTables = await Table.find({
            restaurantId,
            isActive: true,
            capacity: { $gte: guestCount }
        }).lean();

        if (availableTables.length === 0) {
             return res.status(200).json({ success: true, data: [], message: "No tables available for the selected party size." });
        }

        const dateStart = new Date(requestedDate);
        const dateEnd = new Date(requestedDate);
        dateEnd.setUTCDate(dateEnd.getUTCDate() + 1);

        const existingBookings = await Booking.find({
            restaurantId,
            status: 'confirmed',
            bookingDate: { $gte: dateStart, $lt: dateEnd }
        }).select('tableId bookingDate').lean();
        
        const activeLocks = config.featureFlags.enableBookingLocks 
            ? await SlotLock.find({ tableId: { $in: availableTables.map(t => t._id) } }).lean() 
            : [];

        const bookedOrLockedSlotsMap = new Map();
        existingBookings.forEach(b => {
            const time = `${String(b.bookingDate.getUTCHours()).padStart(2, '0')}:${String(b.bookingDate.getUTCMinutes()).padStart(2, '0')}`;
            const key = `${b.tableId}-${time}`;
            bookedOrLockedSlotsMap.set(key, true);
        });
        activeLocks.forEach(lock => {
            const time = `${String(lock.bookingTime.getUTCHours()).padStart(2, '0')}:${String(lock.bookingTime.getUTCMinutes()).padStart(2, '0')}`;
            const key = `${lock.tableId}-${time}`;
            bookedOrLockedSlotsMap.set(key, true);
        });


        const availability = availableTables.map(table => {
            const openSlots = potentialSlots.filter(slot => {
                const key = `${table._id}-${slot}`;
                return !bookedOrLockedSlotsMap.has(key);
            });
            return {
                tableId: table._id,
                tableNumber: table.tableNumber,
                capacity: table.capacity,
                area: table.area,
                availableSlots: openSlots
            };
        }).filter(table => table.availableSlots.length > 0);

        return res.status(200).json({ success: true, data: availability });

    } catch (error) {
        logger.error("Error fetching available slots", { error: error.message, params: req.params, query: req.query });
        next(error);
    }
};

export const createBookingCheckoutSession = async (req, res, next) => {
    const { tableId, date, time, guests } = req.body;
    const customerId = req.user._id;

    const dbSession = await mongoose.startSession();
    try {
        let checkoutUrl, sessionId;
        await dbSession.withTransaction(async () => {
            if (!tableId || !date || !time || !guests) {
                throw { statusCode: 400, message: "tableId, date, time, and guests are required." };
            }

            const [hour, minute] = time.split(':');
            const bookingDate = new Date(date);
            bookingDate.setUTCHours(hour, minute, 0, 0);

            const table = await Table.findById(tableId).populate({
                path: 'restaurantId',
                select: 'restaurantName stripeSecretKey'
            }).session(dbSession);

            if (!table) throw { statusCode: 404, message: "Table not found." };
            if (!table.restaurantId.stripeSecretKey) {
                throw { statusCode: 503, message: "This restaurant is not currently accepting online bookings." };
            }
            
            if (config.featureFlags.enableBookingLocks) {
                const existingLock = await SlotLock.findOne({ tableId, bookingTime: bookingDate }).session(dbSession);
                if (existingLock) {
                    throw { statusCode: 409, message: "This time slot is currently being booked by another user. Please try again in a few minutes." };
                }
                const newLock = new SlotLock({ tableId, bookingTime: bookingDate });
                await newLock.save({ session: dbSession });
            }

            const stripe = new Stripe(table.restaurantId.stripeSecretKey);
            const bookingFee = 1; // UPDATED: Set to 1 for £1.00

            const stripeSession = await stripe.checkout.sessions.create({
                payment_method_types: ["card"],
                line_items: [{
                    price_data: {
                        currency: "gbp", // UPDATED: Changed from "inr" to "gbp"
                        product_data: {
                            name: `Booking for ${table.restaurantId.restaurantName}`,
                            description: `Table ${table.tableNumber} for ${guests} guests on ${date} at ${time}`,
                        },
                        unit_amount: bookingFee * 100, // This correctly becomes 100 pence
                    },
                    quantity: 1,
                }],
                mode: "payment",
                success_url: `${config.clientUrls.successRedirect}?booking_session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${config.clientUrls.failureRedirect}?booking_cancelled=true`,
                customer_email: req.user.email,
                metadata: {
                    customerId: customerId.toString(),
                    restaurantId: table.restaurantId._id.toString(),
                    tableId,
                    date,
                    time,
                    guests,
                    bookingFee
                }
            });
            
            const pendingBooking = new Booking({
                bookingNumber: generateUniqueOrderNumber(),
                restaurantId: table.restaurantId._id,
                customerId,
                tableId,
                bookingDate,
                guests,
                status: 'pending',
                paymentDetails: {
                    sessionId: stripeSession.id,
                    paymentStatus: 'paid',
                    bookingFee: bookingFee
                }
            });
            await pendingBooking.save({ session: dbSession });
            
            checkoutUrl = stripeSession.url;
            sessionId = stripeSession.id;
        });

        res.json({ success: true, url: checkoutUrl, sessionId });

    } catch (error) {
        logger.error("Error creating booking checkout session", { error: error.message });
        if (error.statusCode) {
            return res.status(error.statusCode).json({ success: false, message: error.message });
        }
        next(error);
    } finally {
        dbSession.endSession();
    }
};

export const confirmBooking = async (req, res, next) => {
    const { sessionId } = req.body;
    if (!sessionId) {
        return res.status(400).json({ success: false, message: "Stripe session ID is required." });
    }

    const dbSession = await mongoose.startSession();
    try {
        let confirmedBooking;
        await dbSession.withTransaction(async () => {
            const pendingBooking = await Booking.findOne({ 'paymentDetails.sessionId': sessionId, status: 'pending' }).session(dbSession);
            
            if (!pendingBooking) {
                const alreadyConfirmed = await Booking.findOne({ 'paymentDetails.sessionId': sessionId, status: 'confirmed' }).session(dbSession);
                if (alreadyConfirmed) {
                    confirmedBooking = alreadyConfirmed;
                    return;
                }
                throw { statusCode: 404, message: "No pending booking found for this session. It may have expired or already been confirmed." };
            }

            const restaurant = await Restaurant.findById(pendingBooking.restaurantId).select('+stripeSecretKey').session(dbSession);
            if (!restaurant || !restaurant.stripeSecretKey) throw new Error("Restaurant payment configuration not found.");

            const stripe = new Stripe(restaurant.stripeSecretKey);
            const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId);

            if (checkoutSession.payment_status !== 'paid') {
                throw { statusCode: 402, message: "Payment not completed for this session." };
            }
            
            const doubleBookingCheck = await Booking.findOne({
                tableId: pendingBooking.tableId,
                bookingDate: pendingBooking.bookingDate,
                status: 'confirmed',
                _id: { $ne: pendingBooking._id }
            }).session(dbSession);

            if (doubleBookingCheck) {
                if (checkoutSession.payment_intent) {
                    await stripe.refunds.create({ payment_intent: checkoutSession.payment_intent });
                }
                pendingBooking.status = 'cancelled_by_owner';
                await pendingBooking.save({ session: dbSession });
                throw { statusCode: 409, message: "This time slot was booked by another user just moments ago. Your payment will be refunded." };
            }
            
            pendingBooking.status = 'confirmed';
            confirmedBooking = await pendingBooking.save({ session: dbSession });

            if (config.featureFlags.enableBookingLocks) {
                await SlotLock.deleteOne({
                    tableId: confirmedBooking.tableId,
                    bookingTime: confirmedBooking.bookingDate
                }).session(dbSession);
            }
        });
        
        return res.status(200).json({
            success: true,
            message: "Booking confirmed successfully!",
            data: confirmedBooking
        });

    } catch (error) {
        logger.error("Error confirming booking", { error: error.message, sessionId });
        if (error.statusCode) {
            return res.status(error.statusCode).json({ success: false, message: error.message });
        }
        next(error);
    } finally {
        dbSession.endSession();
    }
};

export const getCustomerBookings = async (req, res, next) => {
    try {
        const customerId = req.user._id;
        const { status } = req.query;
        
        const query = { customerId };
        const now = new Date();

        if (status === 'upcoming') {
            query.bookingDate = { $gte: now };
            query.status = 'confirmed';
        } else if (status === 'past') {
            query.bookingDate = { $lt: now };
        } else if (status) {
            query.status = status;
        }


        const bookings = await Booking.find(query)
            .populate('restaurantId', 'restaurantName address')
            .populate('tableId', 'tableNumber area')
            .sort({ bookingDate: status === 'upcoming' ? 1 : -1 });

        return res.status(200).json({ success: true, data: bookings });
    } catch (error) {
        logger.error("Error fetching customer bookings", { error: error.message, customerId: req.user._id });
        next(error);
    }
};

export const getRestaurantBookings = async (req, res, next) => {
    try {
        const restaurantId = req.restaurant._id;
        const { status, date } = req.query;
        
        const query = { restaurantId };
        if (status) {
            query.status = status;
        }
        
        if (date) {
            const startDate = new Date(date);
            startDate.setUTCHours(0, 0, 0, 0);
            const endDate = new Date(date);
            endDate.setUTCHours(23, 59, 59, 999);
            query.bookingDate = { $gte: startDate, $lte: endDate };
        }


        const bookings = await Booking.find(query)
            .populate('customerId', 'fullName email')
            .populate('tableId', 'tableNumber capacity')
            .sort({ bookingDate: -1 });

        return res.status(200).json({ success: true, data: bookings });
    } catch (error) {
        logger.error("Error fetching restaurant bookings", { error: error.message, restaurantId: req.restaurant._id });
        next(error);
    }
};

const cancelAndRefundBooking = async (booking, dbSession, statusToSet) => {
    const restaurant = await Restaurant.findById(booking.restaurantId).select('+stripeSecretKey').session(dbSession);
    if (!restaurant || !restaurant.stripeSecretKey) throw new Error("Restaurant payment configuration not found.");
    
    if (booking.paymentDetails.paymentStatus === 'paid') {
        const stripe = new Stripe(restaurant.stripeSecretKey);
        const checkoutSession = await stripe.checkout.sessions.retrieve(booking.paymentDetails.sessionId);
        if (checkoutSession.payment_intent) {
            await stripe.refunds.create({ payment_intent: checkoutSession.payment_intent });
            booking.paymentDetails.paymentStatus = 'refunded';
        }
    }
    booking.status = statusToSet;
    return await booking.save({ session: dbSession });
};

export const cancelBookingByUser = async (req, res, next) => {
    const { bookingId } = req.params;
    const customerId = req.user._id;

    const dbSession = await mongoose.startSession();
    try {
        let updatedBooking;
        await dbSession.withTransaction(async () => {
            const booking = await Booking.findOne({ _id: bookingId, customerId }).session(dbSession);

            if (!booking) throw { statusCode: 404, message: "Booking not found or you do not have permission to cancel it." };
            if (booking.status !== 'confirmed') throw { statusCode: 400, message: `This booking cannot be cancelled as its status is '${booking.status}'.` };

            const now = new Date();
            const bookingTime = new Date(booking.bookingDate);
            const hoursDifference = (bookingTime - now) / (1000 * 60 * 60);

            if (hoursDifference < 5) throw { statusCode: 403, message: "Booking cannot be cancelled within 5 hours of the scheduled time." };
            
            updatedBooking = await cancelAndRefundBooking(booking, dbSession, 'cancelled_by_user');
        });
        
        return res.status(200).json({ success: true, message: "Booking cancelled and refunded successfully.", data: updatedBooking });
    } catch (error) {
        logger.error("Error cancelling booking by user", { error: error.message, bookingId });
        res.status(error.statusCode || 500).json({ success: false, message: error.message || "An unexpected server error occurred." });
    } finally {
        dbSession.endSession();
    }
};

export const cancelBookingByOwner = async (req, res, next) => {
    const { bookingId } = req.params;
    const restaurantId = req.restaurant._id;

    const dbSession = await mongoose.startSession();
    try {
        let updatedBooking;
        await dbSession.withTransaction(async () => {
            const booking = await Booking.findOne({ _id: bookingId, restaurantId }).session(dbSession);

            if (!booking) throw { statusCode: 404, message: "Booking not found or it does not belong to your restaurant." };
            if (booking.status !== 'confirmed') throw { statusCode: 400, message: `This booking cannot be cancelled as its status is '${booking.status}'.` };

            updatedBooking = await cancelAndRefundBooking(booking, dbSession, 'cancelled_by_owner');
        });
        
        return res.status(200).json({ success: true, message: "Booking cancelled and refunded successfully.", data: updatedBooking });
    } catch (error) {
        logger.error("Error cancelling booking by owner", { error: error.message, bookingId });
        res.status(error.statusCode || 500).json({ success: false, message: error.message || "An unexpected server error occurred." });
    } finally {
        dbSession.endSession();
    }
};