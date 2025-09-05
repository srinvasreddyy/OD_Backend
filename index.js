import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from 'cors';
import cookieParser from "cookie-parser";
import passport from "passport";
import rateLimit from 'express-rate-limit'; 
import DBconnection from "./src/config/db.js";
import './src/config/passport-setup.js';
import logger from "./src/utils/logger.js";

// Route Imports
import authRoutes from './src/routes/authRoutes.js';
import ownerRegistrationRoutes from "./src/routes/ownerRegistration.routes.js";
import restaurantRoutes from "./src/routes/restaurant.routes.js";
import menuItemRoutes from "./src/routes/menuItem.routes.js";
import cartRoutes from "./src/routes/cart.routes.js";
import orderRoutes from "./src/routes/order.routes.js";
import announcementRoutes from "./src/routes/announcements.routes.js";
import adminRoutes from './src/routes/admin.routes.js';
import ownerRoutes from './src/routes/owner.routes.js';
import deliveryRoutes from './src/routes/delivery.routes.js';
import paymentRoutes from "./src/routes/payment.routes.js";
import tableRoutes from './src/routes/table.routes.js';
import bookingRoutes from './src/routes/booking.routes.js'; 
const app = express();

// --- Core Middleware ---
app.set('trust proxy', 1);
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173', 
  credentials: true 
}));
app.use(passport.initialize());

// --- Security Middleware: Rate Limiting ---
const authLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 20,
	standardHeaders: true,
	legacyHeaders: false,
    message: 'Too many requests from this IP, please try again after 15 minutes.',
});

const generalApiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many requests from this IP, please try again after 15 minutes.',
});

// --- API Routes ---
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/ownerRegistration', authLimiter, ownerRegistrationRoutes);
app.use('/api/restaurants', generalApiLimiter, restaurantRoutes);
app.use('/api/menuItems', generalApiLimiter, menuItemRoutes);
app.use('/api/cart', generalApiLimiter, cartRoutes);
app.use('/api/orders', generalApiLimiter, orderRoutes);
app.use('/api/announcements', generalApiLimiter, announcementRoutes);
app.use('/api/admin', generalApiLimiter, adminRoutes);
app.use('/api/owner', generalApiLimiter, ownerRoutes);
app.use('/api/delivery', generalApiLimiter, deliveryRoutes);
app.use("/api/payment", paymentRoutes);

// --- Feature Flagged Routes ---
if (process.env.FEATURE_FLAG_TABLE_BOOKING === 'true') {
    app.use('/api/tables', generalApiLimiter, tableRoutes);
    app.use('/api/bookings', generalApiLimiter, bookingRoutes); // <-- NEW
    logger.info('Feature enabled: Table Booking');
}

// --- Health Check Route ---
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'Server is healthy.' });
});

// --- Global Error Handling Middleware ---
app.use((err, req, res, next) => {
  logger.error(err.message, { stack: err.stack, path: req.path });
  const statusCode = err.statusCode || 500;
  const message = err.message || "An unexpected server error occurred.";
  const errorResponse = {
    success: false,
    message: message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  };
  res.status(statusCode).json(errorResponse);
});

// --- Server Initialization ---
const PORT = process.env.PORT || 3000;
DBconnection()
.then(() => {
  app.listen(PORT, () => {
    logger.info(`Server is running on port ${PORT}`);
  });
})
.catch((error) => {
  logger.error("MongoDB connection error:", { error: error.message });
  process.exit(1);
});