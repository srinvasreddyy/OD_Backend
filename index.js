import express from "express";
import cors from 'cors';
dotenv.config();
import dotenv from "dotenv";
import DBconnection from "./src/config/db.js";
import ownerRoutes from "./src/routes/owner.routes.js"
import cookieParser from "cookie-parser";

const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: 'http://localhost:5173', 
  credentials: true 
}));
app.use("/api/owners", ownerRoutes);





const PORT = process.env.PORT || 3000
console.log(process.env.PORT)
DBconnection()
.then(() => {
  app.listen( PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
})
.catch((error) => {
  console.error("MongoDB connection error:", error);
});