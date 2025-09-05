import mongoose from "mongoose";
import Stripe from "stripe";
import Restaurant from "../models/Restaurant.js";
import RestaurantTimings from "../models/RestaurantTimings.js";
import Table from "../models/Table.js";
import Booking from "../models/Booking.js";
import { generateUniqueOrderNumber } from "../utils/orderUtils.js";
import logger from "../utils/logger.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// --- Helper Functions ---

const getDayOfWeek = (date) => {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return days[date.getDay()];
};

const generateTimeSlots = (start, end, intervalMinutes = 60) => {
    const slots = [];
    const [startHour, startMinute] = start.split(':').map(Number);
    const [endHour, endMinute] = end.split(':').map(Number);

    let currentHour = startHour;
    let currentMinute = startMinute;

    while (currentHour < endHour || (currentHour === endHour && currentMinute <= endMinute)) {
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

/**
 * @description Get available tables and slots for a given date and party size.
 * @route GET /api/restaurants/:restaurantId/availability
 * @access Public
 */
export const getAvailableSlots = async (req, res, next) => {
    try {
        const { restaurantId } = req.params;
        const { date, guests } = req.query;

        if (!date || !guests) {
            return res.status(400).json({ success: false, message: "Date and number of guests are required." });
        }

        const requestedDate = new Date(date);
        requestedDate.setHours(0, 0, 0, 0);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const maxDate = new Date(today);
        maxDate.setDate(today.getDate() + 2);

        if (requestedDate < today || requestedDate > maxDate) {
            return res.status(400).json({ success: false, message: "Bookings are only available for today and the next 2 days." });
        }

        const dayOfWeek = getDayOfWeek(requestedDate);
        const guestCount = parseInt(guests, 10);

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

        const dateStart = new Date(date);
        const dateEnd = new Date(date);
        dateEnd.setDate(dateEnd.getDate() + 1);

        const existingBookings = await Booking.find({
            restaurantId,
            status: 'confirmed',
            bookingDate: { $gte: dateStart, $lt: dateEnd }
        }).select('tableId bookingDate').lean();

        const bookedSlotsMap = new Map(); // "tableId-HH:MM" -> true
        existingBookings.forEach(b => {
            const time = `${String(b.bookingDate.getHours()).padStart(2, '0')}:${String(b.bookingDate.getMinutes()).padStart(2, '0')}`;
            const key = `${b.tableId}-${time}`;
            bookedSlotsMap.set(key, true);
        });

        const availability = availableTables.map(table => {
            const openSlots = potentialSlots.filter(slot => {
                const key = `${table._id}-${slot}`;
                return !bookedSlotsMap.has(key);
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

/**
 * @description Creates a Stripe Checkout session for table booking.
 * @route POST /api/bookings/create-checkout-session
 * @access Private (User)
 */
export const createBookingCheckoutSession = async (req, res, next) => {
    try {
        const { tableId, date, time, guests } = req.body;
        const customerId = req.user._id;

        if (!tableId || !date || !time || !guests) {
            return res.status(400).json({ success: false, message: "tableId, date, time, and guests are required." });
        }

        const table = await Table.findById(tableId).populate('restaurantId', 'restaurantName');
        if (!table) {
            return res.status(404).json({ success: false, message: "Table not found." });
        }

        const bookingFee = 100;

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [{
                price_data: {
                    currency: "inr",
                    product_data: {
                        name: `Booking for ${table.restaurantId.restaurantName}`,
                        description: `Table ${table.tableNumber} for ${guests} guests on ${date} at ${time}`,
                    },
                    unit_amount: bookingFee * 100,
                },
                quantity: 1,
            }],
            mode: "payment",
            success_url: `${process.env.CLIENT_SUCCESS_REDIRECT_URL}?booking_session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.CLIENT_FAILURE_REDIRECT_URL}?booking_cancelled=true`,
            customer_email: req.user.email,
            metadata: {
                customerId,
                restaurantId: table.restaurantId._id.toString(),
                tableId,
                date,
                time,
                guests,
                bookingFee
            }
        });

        res.json({ success: true, url: session.url, sessionId: session.id });

    } catch (error) {
        logger.error("Error creating booking checkout session", { error: error.message });
        next(error);
    }
};

/**
 * @description Confirms a booking after successful payment.
 * @route POST /api/bookings/confirm-booking
 * @access Private (User)
 */
export const confirmBooking = async (req, res, next) => {
    const { sessionId } = req.body;
    if (!sessionId) {
        return res.status(400).json({ success: false, message: "Stripe session ID is required." });
    }

    const dbSession = await mongoose.startSession();
    try {
        let newBooking;
        await dbSession.withTransaction(async () => {
            const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId);
            if (checkoutSession.payment_status !== 'paid') {
                throw new Error("Payment not completed for this session.");
            }

            const existingBooking = await Booking.findOne({ 'paymentDetails.sessionId': sessionId }).session(dbSession);
            if (existingBooking) {
                newBooking = existingBooking;
                return;
            }

            const { tableId, date, time, guests, restaurantId, customerId, bookingFee } = checkoutSession.metadata;
            if (!mongoose.Types.ObjectId.isValid(tableId)) {
                 throw new Error("Invalid Table ID found in session metadata.");
            }
            const [hour, minute] = time.split(':');
            const bookingDate = new Date(date);
            bookingDate.setHours(hour, minute, 0, 0);

            const doubleBookingCheck = await Booking.findOne({
                tableId: new mongoose.Types.ObjectId(tableId),
                bookingDate: bookingDate,
                status: 'confirmed'
            }).session(dbSession);

            if (doubleBookingCheck) {
                throw new Error("This time slot has just been booked by another user. Your payment will be refunded.");
            }

            const booking = new Booking({
                bookingNumber: generateUniqueOrderNumber(),
                restaurantId,
                customerId,
                tableId,
                bookingDate,
                guests,
                paymentDetails: {
                    sessionId: sessionId,
                    paymentStatus: 'paid',
                    bookingFee: checkoutSession.amount_total / 100
                }
            });
            newBooking = await booking.save({ session: dbSession });
        });
        
        return res.status(newBooking._id ? 201 : 200).json({
            success: true,
            message: newBooking.isNew ? "Booking confirmed successfully!" : "Booking was already confirmed.",
            data: newBooking
        });

    } catch (error) {
        logger.error("Error confirming booking", { error: error.message, sessionId });
        if (error.message.includes("time slot has just been booked")) {
            return res.status(409).json({ success: false, message: error.message });
        }
        next(error);
    } finally {
        dbSession.endSession();
    }
};

/**
 * @description Get bookings for the logged-in customer.
 * @route GET /api/bookings/my-bookings
 * @access Private (User)
 */
export const getCustomerBookings = async (req, res, next) => {
    try {
        const customerId = req.user._id;
        const { status } = req.query; // 'upcoming' or 'past'
        
        const query = { customerId };
        const now = new Date();

        if (status === 'upcoming') {
            query.bookingDate = { $gte: now };
            query.status = 'confirmed';
        } else if (status === 'past') {
            query.bookingDate = { $lt: now };
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

/**
 * @description Get all bookings for the logged-in restaurant owner.
 * @route GET /api/bookings/restaurant
 * @access Private (Restaurant Owner)
 */
export const getRestaurantBookings = async (req, res, next) => {
    try {
        const restaurantId = req.restaurant._id;
        const { status } = req.query;
        
        const query = { restaurantId };
        if (status) {
            query.status = status;
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

/**
 * @description Allows a customer to cancel their booking.
 * @route PATCH /api/bookings/:bookingId/cancel
 * @access Private (User)
 */
export const cancelBookingByUser = async (req, res, next) => {
    const { bookingId } = req.params;
    const customerId = req.user._id;

    const dbSession = await mongoose.startSession();
    try {
        let updatedBooking;
        await dbSession.withTransaction(async () => {
            const booking = await Booking.findOne({ _id: bookingId, customerId }).session(dbSession);

            if (!booking) {
                throw { statusCode: 404, message: "Booking not found or you do not have permission to cancel it." };
            }
            if (booking.status !== 'confirmed') {
                throw { statusCode: 400, message: `This booking cannot be cancelled as its status is '${booking.status}'.` };
            }

            const now = new Date();
            const bookingTime = new Date(booking.bookingDate);
            const hoursDifference = (bookingTime - now) / (1000 * 60 * 60);

            if (hoursDifference < 5) {
                throw { statusCode: 403, message: "Booking cannot be cancelled within 5 hours of the scheduled time." };
            }

            if (booking.paymentDetails.paymentStatus === 'paid') {
                const checkoutSession = await stripe.checkout.sessions.retrieve(booking.paymentDetails.sessionId);
                if (checkoutSession.payment_intent) {
                    await stripe.refunds.create({ payment_intent: checkoutSession.payment_intent });
                    booking.paymentDetails.paymentStatus = 'refunded';
                }
            }

            booking.status = 'cancelled_by_user';
            updatedBooking = await booking.save({ session: dbSession });
        });
        
        return res.status(200).json({ success: true, message: "Booking cancelled and refunded successfully.", data: updatedBooking });
    } catch (error) {
        logger.error("Error cancelling booking by user", { error: error.message, bookingId });
        next(error);
    } finally {
        dbSession.endSession();
    }
};

/**
 * @description Allows a restaurant owner to cancel a booking.
 * @route PATCH /api/bookings/restaurant/:bookingId/cancel
 * @access Private (Restaurant Owner)
 */
export const cancelBookingByOwner = async (req, res, next) => {
    const { bookingId } = req.params;
    const restaurantId = req.restaurant._id;

    const dbSession = await mongoose.startSession();
    try {
        let updatedBooking;
        await dbSession.withTransaction(async () => {
            const booking = await Booking.findOne({ _id: bookingId, restaurantId }).session(dbSession);

            if (!booking) {
                throw { statusCode: 404, message: "Booking not found or it does not belong to your restaurant." };
            }
            if (booking.status !== 'confirmed') {
                throw { statusCode: 400, message: `This booking cannot be cancelled as its status is '${booking.status}'.` };
            }

            if (booking.paymentDetails.paymentStatus === 'paid') {
                 const checkoutSession = await stripe.checkout.sessions.retrieve(booking.paymentDetails.sessionId);
                if (checkoutSession.payment_intent) {
                    await stripe.refunds.create({ payment_intent: checkoutSession.payment_intent });
                    booking.paymentDetails.paymentStatus = 'refunded';
                }
            }

            booking.status = 'cancelled_by_owner';
            updatedBooking = await booking.save({ session: dbSession });
        });

        // TODO: In a real system, we would also trigger a notification email to the customer here.
        
        return res.status(200).json({ success: true, message: "Booking cancelled and refunded successfully. The customer will be notified.", data: updatedBooking });
    } catch (error) {
        logger.error("Error cancelling booking by owner", { error: error.message, bookingId });
        next(error);
    } finally {
        dbSession.endSession();
    }
};