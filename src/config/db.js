import mongoose from "mongoose";
import logger from "../utils/logger.js";
import config from "./env.js";

const DBconnection = async () => {
    try {
        const connectionInstance = await mongoose.connect(config.mongodbUri);
        logger.info(`MongoDB connected Host: ${connectionInstance.connection.host}`);
        
    } catch (error) {
        logger.error("MongoDB connection error", { error: error.message });
        process.exit(1);
    }
}
export default DBconnection;