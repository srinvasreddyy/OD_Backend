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

const app = express();

// --- Core Middleware ---
app.set('trust proxy', 1); // <-- NEW: Trust the first proxy (needed for production deployment behind a reverse proxy/load balancer)
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
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 20, // Limit each IP to 20 requests per window
	standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
	legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: 'Too many requests from this IP, please try again after 15 minutes.',
});

const generalApiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many requests from this IP, please try again after 15 minutes.',
});

// --- API Routes ---
// Apply strict rate limiting to authentication and registration routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/ownerRegistration', authLimiter, ownerRegistrationRoutes);

// Apply general rate limiting to all other routes
app.use('/api/restaurants', generalApiLimiter, restaurantRoutes);
app.use('/api/menuItems', generalApiLimiter, menuItemRoutes);
app.use('/api/cart', generalApiLimiter, cartRoutes);
app.use('/api/orders', generalApiLimiter, orderRoutes);
app.use('/api/announcements', generalApiLimiter, announcementRoutes);


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