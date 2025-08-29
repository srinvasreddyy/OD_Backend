import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from 'cors';
import cookieParser from "cookie-parser";
import passport from "passport"; // 1. Import Passport
import DBconnection from "./src/config/db.js";
import './src/config/passport-setup.js'; // 2. Import the passport setup to register the strategy
import authRoutes from './src/routes/authRoutes.js';
import ownerRegistrationRoutes from "./src/routes/ownerRegistration.routes.js";
import menuItemRoutes from "./src/routes/menuItem.routes.js";
const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: 'http://localhost:5173', 
  credentials: true 
}));

// 3. Initialize Passport middleware
app.use(passport.initialize());

app.use('/api/auth', authRoutes);
app.use('/api/ownerRegistration', ownerRegistrationRoutes);
app.use('/api/menuItems', menuItemRoutes);

const PORT = process.env.PORT || 3000;
DBconnection()
.then(() => {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
})
.catch((error) => {
  console.error("MongoDB connection error:", error);
});