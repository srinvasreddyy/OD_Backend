import mongoose from "mongoose";
import Stripe from "stripe";
import Restaurant from "../models/Restaurant.js";
import Table from "../models/Table.js";
import Booking from "../models/Booking.js";
import SlotLock from "../models/SlotLock.js";
import { generateUniqueOrderNumber } from "../utils/orderUtils.js";
import logger from "../utils/logger.js";
import config from "../config/env.js";

// Helper to check continuity of time slots
const areSlotsSequential = (slots) => {
    if (!slots || slots.length < 2) return true;
    const hours = slots.map(s => parseInt(s.split(':')[0], 10)).sort((a,b) => a - b);
    for (let i = 0; i < hours.length - 1; i++) {
        if (hours[i+1] !== hours[i] + 1) return false;
    }
    return true;
};

// --- Controller Functions ---

export const getAvailableSlots = async (req, res, next) => {
    try {
        const { restaurantId } = req.params;
        const { date, guests } = req.query;

        if (!date || !guests) return res.status(400).json({ success: false, message: "Date and guests required." });

        // FIX: Ensure strict UTC Midnight matching to align with Table storage
        // Input 'date' is expected to be "YYYY-MM-DD"
        const searchDate = new Date(date);
        // Explicitly set to UTC midnight to avoid local timezone shifts
        searchDate.setUTCHours(0, 0, 0, 0);
        
        const guestCount = parseInt(guests, 10);

        // 1. Find Tables specifically created for this Date
        const availableTables = await Table.find({
            restaurantId,
            date: searchDate,
            isActive: true,
            capacity: { $gte: guestCount }
        }).lean();

        if (availableTables.length === 0) {
             return res.status(200).json({ success: true, data: [], message: "No tables available for this date." });
        }

        const tableIds = availableTables.map(t => t._id);
        
        // 2. Check Bookings & Locks
        const existingBookings = await Booking.find({
            tableId: { $in: tableIds },
            status: { $in: ['confirmed', 'pending'] }
        }).select('tableId bookedSlots bookingDate').lean();
        
        const activeLocks = await SlotLock.find({ 
            tableId: { $in: tableIds } 
        }).lean();

        // 3. Build Availability Map
        const availability = availableTables.map(table => {
            const bookedSlots = new Set();
            
            existingBookings.filter(b => b.tableId.toString() === table._id.toString()).forEach(b => {
                if(b.bookedSlots && b.bookedSlots.length > 0) {
                    b.bookedSlots.forEach(s => bookedSlots.add(s));
                } else {
                    const h = new Date(b.bookingDate).getUTCHours();
                    bookedSlots.add(`${String(h).padStart(2,'0')}:00`);
                }
            });

            activeLocks.filter(l => l.tableId.toString() === table._id.toString()).forEach(l => {
                 const h = new Date(l.bookingTime).getUTCHours(); 
                 bookedSlots.add(`${String(h).padStart(2,'0')}:00`);
            });

            const openSlots = table.availableHours.filter(slot => !bookedSlots.has(slot));

            return {
                tableId: table._id,
                tableNumber: table.tableNumber,
                capacity: table.capacity,
                area: table.area,
                bookingPrice: table.bookingPrice,
                maxBookingHours: table.maxBookingHours,
                availableSlots: openSlots
            };
        }).filter(t => t.availableSlots.length > 0);

        return res.status(200).json({ success: true, data: availability });

    } catch (error) {
        logger.error("Error fetching available slots", { error: error.message, params: req.params, query: req.query });
        next(error);
    }
};

export const createBookingCheckoutSession = async (req, res, next) => {
    const { tableId, date, slots, guests } = req.body; 
    const customerId = req.user._id;

    const dbSession = await mongoose.startSession();
    try {
        let checkoutUrl, sessionId;
        await dbSession.withTransaction(async () => {
            if (!tableId || !date || !slots || !slots.length || !guests) {
                throw { statusCode: 400, message: "Missing required fields." };
            }

            const table = await Table.findById(tableId).populate({
                path: 'restaurantId',
                select: 'restaurantName stripeSecretKey'
            }).session(dbSession);

            if (!table) throw { statusCode: 404, message: "Table not found." };
            if (!table.restaurantId.stripeSecretKey) {
                throw { statusCode: 503, message: "This restaurant is not currently accepting online bookings." };
            }

            if (slots.length > table.maxBookingHours) {
                throw { statusCode: 400, message: `You can only book up to ${table.maxBookingHours} hours.` };
            }
            if (!areSlotsSequential(slots)) {
                throw { statusCode: 400, message: "Please select sequential time slots." };
            }

            // FIX: Robust Date Construction for Locks
            const bookingDateObj = new Date(date);
            bookingDateObj.setUTCHours(0, 0, 0, 0); // Align base to UTC Midnight

            const locksToCheck = slots.map(slot => {
                const [h, m] = slot.split(':');
                const d = new Date(bookingDateObj);
                d.setUTCHours(parseInt(h), parseInt(m), 0, 0);
                return d;
            });

            const existingLocks = await SlotLock.find({ 
                tableId, 
                bookingTime: { $in: locksToCheck } 
            }).session(dbSession);

            if (existingLocks.length > 0) {
                throw { statusCode: 409, message: "Selected slots are temporarily locked by another user." };
            }

            await SlotLock.insertMany(locksToCheck.map(time => ({
                tableId,
                bookingTime: time
            })), { session: dbSession });

            const stripe = new Stripe(table.restaurantId.stripeSecretKey);
            const price = table.bookingPrice > 0 ? table.bookingPrice : 1; 
            const origin = req.headers.origin; 

            const sessionConfig = {
                payment_method_types: ["card"],
                line_items: [{
                    price_data: {
                        currency: "gbp",
                        product_data: {
                            name: `Booking Table ${table.tableNumber} - ${table.restaurantId.restaurantName}`,
                            description: `Date: ${date} | Slots: ${slots.join(', ')} | Guests: ${guests}`,
                        },
                        unit_amount: Math.round(price * 100), 
                    },
                    quantity: 1, 
                }],
                mode: "payment",
                success_url: `${origin}/booking/success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${origin}/booking/failure?session_id={CHECKOUT_SESSION_ID}`,
                customer_email: req.user.email,
                metadata: {
                    customerId: customerId.toString(),
                    tableId,
                    slots: JSON.stringify(slots),
                    date
                }
            };

            const stripeSession = await stripe.checkout.sessions.create(sessionConfig);
            
            const primaryTime = locksToCheck[0]; 

            const pendingBooking = new Booking({
                bookingNumber: generateUniqueOrderNumber(),
                restaurantId: table.restaurantId._id,
                customerId,
                tableId,
                bookingDate: primaryTime,
                bookedSlots: slots,
                guests,
                status: 'pending', 
                paymentDetails: {
                    sessionId: stripeSession.id,
                    paymentStatus: 'pending', 
                    bookingFee: price
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
            const booking = await Booking.findOne({ 'paymentDetails.sessionId': sessionId }).session(dbSession);
            
            if (!booking) throw { statusCode: 404, message: "Booking not found." };
            
            // Idempotency check
            if (booking.status === 'confirmed' && booking.paymentDetails.paymentStatus === 'paid') {
                confirmedBooking = booking;
                return;
            }

            const restaurant = await Restaurant.findById(booking.restaurantId).select('+stripeSecretKey').session(dbSession);
            if (!restaurant || !restaurant.stripeSecretKey) throw new Error("Restaurant configuration missing.");

            const stripe = new Stripe(restaurant.stripeSecretKey);
            const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId);

            if (checkoutSession.payment_status !== 'paid') {
                throw { statusCode: 402, message: "Payment not completed." };
            }
            
            // UPDATE STATUSES
            booking.status = 'confirmed';
            booking.paymentDetails.paymentStatus = 'paid';
            confirmedBooking = await booking.save({ session: dbSession });

            // CLEANUP LOCKS
            if (booking.bookedSlots && booking.bookedSlots.length > 0) {
                 const dateBase = new Date(booking.bookingDate);
                 // bookingDate acts as primary anchor, ensure we align date parts
                 const year = dateBase.getUTCFullYear();
                 const month = dateBase.getUTCMonth();
                 const day = dateBase.getUTCDate();

                 const lockTimes = booking.bookedSlots.map(s => {
                     const [h, m] = s.split(':');
                     return new Date(Date.UTC(year, month, day, parseInt(h), parseInt(m), 0));
                 });
                 
                 await SlotLock.deleteMany({
                     tableId: booking.tableId,
                     bookingTime: { $in: lockTimes }
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

export const handleBookingFailure = async (req, res, next) => {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ success: false, message: "Session ID required." });

    const dbSession = await mongoose.startSession();
    try {
        await dbSession.withTransaction(async () => {
            const booking = await Booking.findOne({ 'paymentDetails.sessionId': sessionId }).session(dbSession);
            
            if (!booking) return; 

            // Only act if pending
            if (booking.status === 'pending') {
                booking.status = 'cancelled_by_user';
                booking.paymentDetails.paymentStatus = 'failed';
                await booking.save({ session: dbSession });

                // RELEASE LOCKS
                if (booking.bookedSlots && booking.bookedSlots.length > 0) {
                     const dateBase = new Date(booking.bookingDate);
                     const year = dateBase.getUTCFullYear();
                     const month = dateBase.getUTCMonth();
                     const day = dateBase.getUTCDate();
    
                     const lockTimes = booking.bookedSlots.map(s => {
                         const [h, m] = s.split(':');
                         return new Date(Date.UTC(year, month, day, parseInt(h), parseInt(m), 0));
                     });
                     
                     await SlotLock.deleteMany({
                         tableId: booking.tableId,
                         bookingTime: { $in: lockTimes }
                     }).session(dbSession);
                }
            }
        });

        return res.status(200).json({ success: true, message: "Booking cancelled and slots released." });

    } catch (error) {
        logger.error("Error handling booking failure", { error: error.message });
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
        if (status) query.status = status;
        
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

            if (!booking) throw { statusCode: 404, message: "Booking not found." };
            if (booking.status !== 'confirmed') throw { statusCode: 400, message: `Cannot cancel booking with status '${booking.status}'.` };

            const now = new Date();
            const bookingTime = new Date(booking.bookingDate);
            const hoursDifference = (bookingTime - now) / (1000 * 60 * 60);

            if (hoursDifference < 5) throw { statusCode: 403, message: "Booking cannot be cancelled within 5 hours of the scheduled time." };
            
            updatedBooking = await cancelAndRefundBooking(booking, dbSession, 'cancelled_by_user');
        });
        
        return res.status(200).json({ success: true, message: "Booking cancelled and refunded.", data: updatedBooking });
    } catch (error) {
        logger.error("Error cancelling booking by user", { error: error.message, bookingId });
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
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

            if (!booking) throw { statusCode: 404, message: "Booking not found." };
            if (booking.status !== 'confirmed') throw { statusCode: 400, message: `Cannot cancel booking with status '${booking.status}'.` };

            updatedBooking = await cancelAndRefundBooking(booking, dbSession, 'cancelled_by_owner');
        });
        
        return res.status(200).json({ success: true, message: "Booking cancelled and refunded.", data: updatedBooking });
    } catch (error) {
        logger.error("Error cancelling booking by owner", { error: error.message, bookingId });
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
    } finally {
        dbSession.endSession();
    }
};