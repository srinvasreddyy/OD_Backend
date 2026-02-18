import mongoose from "mongoose";
import Stripe from "stripe";
import Restaurant from "../models/Restaurant.js";
import Table from "../models/Table.js";
import Booking from "../models/Booking.js";
import SlotLock from "../models/SlotLock.js";
import { generateUniqueOrderNumber } from "../utils/orderUtils.js";
import logger from "../utils/logger.js";
import config from "../config/env.js";
import { sendNewBookingNotification, sendOrderInvoiceEmail } from "../utils/MailUtils.js";

const areSlotsSequential = (slots) => {
    if (!slots || slots.length < 2) return true;
    const hours = slots.map(s => parseInt(s.split(':')[0], 10)).sort((a,b) => a - b);
    for (let i = 0; i < hours.length - 1; i++) {
        if (hours[i+1] !== hours[i] + 1) return false;
    }
    return true;
};

export const getAvailableSlots = async (req, res, next) => {
    try {
        const { restaurantId } = req.params;
        const { date, guests } = req.query;

        if (!date || !guests) return res.status(400).json({ success: false, message: "Date and guests required." });

        const searchDate = new Date(date);
        searchDate.setUTCHours(0, 0, 0, 0);
        
        const guestCount = parseInt(guests, 10);
        
        // Use a 30-minute buffer for booking
        const now = new Date();
        const bufferTime = new Date(now.getTime() + 30 * 60000); 

        // 1. Fetch Inventory (Tables)
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
        
        // 2. Fetch Bookings (Robust Logic)
        // We only consider 'pending' bookings valid if they were created in the last 10 minutes.
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

        const existingBookings = await Booking.find({
            tableId: { $in: tableIds },
            $or: [
                { status: 'confirmed' },
                { status: 'pending', createdAt: { $gt: tenMinutesAgo } } // IGNORE STALE PENDING BOOKINGS
            ]
        }).select('tableId bookedSlots bookingDate').lean();
        
        // 3. Fetch Temporary Locks
        const activeLocks = await SlotLock.find({ 
            tableId: { $in: tableIds } 
        }).lean();

        const availability = availableTables.map(table => {
            const bookedSlots = new Set();
            
            existingBookings.filter(b => b.tableId.toString() === table._id.toString()).forEach(b => {
                if(b.bookedSlots && b.bookedSlots.length > 0) {
                    b.bookedSlots.forEach(s => bookedSlots.add(s));
                }
            });

            activeLocks.filter(l => l.tableId.toString() === table._id.toString()).forEach(l => {
                 const d = new Date(l.bookingTime);
                 const h = d.getUTCHours(); 
                 const m = d.getUTCMinutes();
                 bookedSlots.add(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
            });

            const openSlots = table.availableHours.filter(slot => {
                if (bookedSlots.has(slot)) return false;

                const [h, m] = slot.split(':').map(Number);
                const slotDateTime = new Date(table.date); 
                slotDateTime.setUTCHours(h, m, 0, 0);
                
                // STRICT CHECK: Ensure slot is in the future + buffer
                if (slotDateTime < bufferTime) return false;

                return true;
            });

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
                select: 'restaurantName stripeAccountId acceptsOnlineOrders'
            }).session(dbSession);

            if (!table) throw { statusCode: 404, message: "Table not found." };
            if (!table.restaurantId.acceptsOnlineOrders || !table.restaurantId.stripeAccountId) {
                throw { statusCode: 503, message: "This restaurant is not currently accepting online bookings." };
            }

            if (slots.length > table.maxBookingHours) {
                throw { statusCode: 400, message: `You can only book up to ${table.maxBookingHours} hours.` };
            }
            if (!areSlotsSequential(slots)) {
                throw { statusCode: 400, message: "Please select sequential time slots." };
            }

            const bookingDateObj = new Date(date);
            bookingDateObj.setUTCHours(0, 0, 0, 0); 

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

            const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
            const pricePerSlot = table.bookingPrice > 0 ? table.bookingPrice : 1; 

            const clientBaseUrl = config.clientUrls.customer;
            const successUrl = `${clientBaseUrl}/booking/success?session_id={CHECKOUT_SESSION_ID}`;
            const failureUrl = `${clientBaseUrl}/booking/failure?session_id={CHECKOUT_SESSION_ID}`;

            const sessionConfig = {
                payment_method_types: ["card"],
                line_items: [{
                    price_data: {
                        currency: "gbp",
                        product_data: {
                            name: `Booking Table ${table.tableNumber} - ${table.restaurantId.restaurantName}`,
                            description: `Date: ${date} | Slots: ${slots.join(', ')} | Guests: ${guests}`,
                        },
                        unit_amount: Math.round(pricePerSlot * 100), 
                    },
                    quantity: slots.length, 
                }],
                mode: "payment",
                payment_intent_data: {
                    transfer_data: {
                        destination: table.restaurantId.stripeAccountId,
                    },
                },
                success_url: successUrl,
                cancel_url: failureUrl,
                customer_email: req.user.email,
                metadata: {
                    customerId: customerId.toString(),
                    tableId,
                    slots: JSON.stringify(slots),
                    date
                }
            };

            const stripeSession = await stripe.checkout.sessions.create(sessionConfig);
            const totalFee = pricePerSlot * slots.length;

            const pendingBooking = new Booking({
                bookingNumber: generateUniqueOrderNumber(),
                restaurantId: table.restaurantId._id,
                customerId,
                tableId,
                bookingDate: bookingDateObj,
                bookedSlots: slots,
                guests,
                status: 'pending', 
                paymentDetails: {
                    sessionId: stripeSession.id,
                    paymentStatus: 'pending', 
                    bookingFee: totalFee 
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
            const booking = await Booking.findOne({ 'paymentDetails.sessionId': sessionId })
                .populate({
                    path: 'restaurantId',
                    select: '+stripeAccountId email restaurantName ownerFullName'
                })
                .populate('customerId', 'fullName phoneNumber email')
                .populate('tableId', 'tableNumber')
                .session(dbSession);
            
            if (!booking) throw { statusCode: 404, message: "Booking not found." };
            
            if (booking.status === 'confirmed' && booking.paymentDetails.paymentStatus === 'paid') {
                confirmedBooking = booking;
                return;
            }

            const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
            const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId);

            if (checkoutSession.payment_status !== 'paid') {
                throw { statusCode: 402, message: "Payment not completed." };
            }
            
            booking.status = 'confirmed';
            booking.paymentDetails.paymentStatus = 'paid';
            confirmedBooking = await booking.save({ session: dbSession });

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
        });
        
        if (confirmedBooking) {
            await sendOrderInvoiceEmail(confirmedBooking);

            if (confirmedBooking.restaurantId?.email) {
                await sendNewBookingNotification(confirmedBooking.restaurantId.email, {
                    tableNumber: confirmedBooking.tableId.tableNumber,
                    date: confirmedBooking.bookingDate,
                    slots: confirmedBooking.bookedSlots,
                    guests: confirmedBooking.guests,
                    customerName: confirmedBooking.customerId.fullName,
                    customerPhone: confirmedBooking.customerId.phoneNumber
                });
            }
        }
        
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

            if (booking.status === 'pending') {
                booking.status = 'cancelled_by_user';
                booking.paymentDetails.paymentStatus = 'failed';
                await booking.save({ session: dbSession });

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
        
        if (status === 'upcoming') {
            const startOfToday = new Date();
            startOfToday.setUTCHours(0,0,0,0);
            query.bookingDate = { $gte: startOfToday };
            query.status = 'confirmed';
        } else if (status === 'past') {
            const startOfToday = new Date();
            startOfToday.setUTCHours(0,0,0,0);
            query.bookingDate = { $lt: startOfToday };
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
        const { status, date, startDate, endDate } = req.query;
        
        const query = { restaurantId };
        if (status) query.status = status;
        
        // SUPPORT RANGE OR SINGLE DATE
        if (startDate || endDate) {
             const dateQuery = {};
             if (startDate) {
                 const start = new Date(startDate);
                 start.setUTCHours(0, 0, 0, 0);
                 dateQuery.$gte = start;
             }
             if (endDate) {
                 const end = new Date(endDate);
                 end.setUTCHours(23, 59, 59, 999);
                 dateQuery.$lte = end;
             }
             query.bookingDate = dateQuery;
        } else if (date) {
            const start = new Date(date);
            start.setUTCHours(0, 0, 0, 0);
            const end = new Date(date);
            end.setUTCHours(23, 59, 59, 999);
            query.bookingDate = { $gte: start, $lte: end };
        }

        const bookings = await Booking.find(query)
            .populate('customerId', 'fullName email phoneNumber') // Added phoneNumber
            .populate('tableId', 'tableNumber capacity')
            .sort({ bookingDate: -1 });

        return res.status(200).json({ success: true, data: bookings });
    } catch (error) {
        logger.error("Error fetching restaurant bookings", { error: error.message, restaurantId: req.restaurant._id });
        next(error);
    }
};

export const cancelBookingByUser = async (req, res, next) => {
    return res.status(403).json({ 
        success: false, 
        message: "Confirmed bookings cannot be cancelled. Please contact the restaurant directly." 
    });
};

export const cancelBookingByOwner = async (req, res, next) => {
    return res.status(403).json({ 
        success: false, 
        message: "This booking is confirmed and paid. You cannot cancel it through the system." 
    });
};

// --- NEW MANUAL RELEASE FUNCTION ---
export const expireBooking = async (req, res, next) => {
    const { bookingId } = req.params;
    const restaurantId = req.restaurant._id;

    const dbSession = await mongoose.startSession();
    try {
        await dbSession.withTransaction(async () => {
            const booking = await Booking.findOne({ _id: bookingId, restaurantId }).session(dbSession);

            if (!booking) throw { statusCode: 404, message: "Booking not found." };
            if (booking.status !== 'pending') throw { statusCode: 400, message: "Only pending bookings can be force-released." };

            booking.status = 'cancelled_by_owner'; 
            booking.paymentDetails.paymentStatus = 'failed';
            await booking.save({ session: dbSession });

            // FORCE DELETE LOCKS
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
        });
        
        return res.status(200).json({ success: true, message: "Booking released and slots unlocked." });

    } catch (error) {
        logger.error("Error expiring booking", { error: error.message, bookingId });
        if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
        next(error);
    } finally {
        dbSession.endSession();
    }
};

export const completeBooking = async (req, res, next) => {
    const { bookingId } = req.params;
    const restaurantId = req.restaurant._id;

    try {
        const booking = await Booking.findOne({ _id: bookingId, restaurantId });

        if (!booking) return res.status(404).json({ success: false, message: "Booking not found." });
        
        if (booking.status !== 'confirmed') {
            return res.status(400).json({ success: false, message: "Only confirmed bookings can be marked as completed." });
        }

        const bookingDate = new Date(booking.bookingDate);
        const lastSlot = booking.bookedSlots[booking.bookedSlots.length - 1];
        const [h, m] = lastSlot.split(':').map(Number);
        
        bookingDate.setUTCHours(h + 1, m, 0, 0); 
        
        if (new Date() < bookingDate) {
             return res.status(400).json({ success: false, message: "Cannot mark as completed before the booking time is over." });
        }

        booking.status = 'completed';
        await booking.save();

        return res.status(200).json({ success: true, message: "Booking marked as completed.", data: booking });

    } catch (error) {
        logger.error("Error completing booking", { error: error.message, bookingId });
        next(error);
    }
};