import mongoose from "mongoose";
import logger from "../utils/logger.js";

const DBconnection = async () => {
    try {
        const connectionInstance = await mongoose.connect(process.env.MONGODB_URI);
        logger.info(`MongoDB connected Host: ${connectionInstance.connection.host}`);
    } catch (error) {
        logger.error("MongoDB connection error", { error: error.message });
        process.exit(1);
    }
}
export default DBconnection;