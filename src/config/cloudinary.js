import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";
import fs from "fs";
import logger from "../utils/logger.js";
import config from "./env.js";

cloudinary.config({
  cloud_name: config.cloudinary.cloudName,
  api_key: config.cloudinary.apiKey,
  api_secret: config.cloudinary.apiSecret
});

/**
 * Intelligently uploads a file to Cloudinary from either a buffer or a file path.
 * @param {object} file - The file object from Multer (contains either .buffer or .path).
 * @returns {Promise<object|null>} A promise that resolves with the Cloudinary response.
 */
const uploadOnCloudinary = (file) => {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error("No file provided for upload."));

    const handleUpload = (error, result) => {
      // Cleanup the temporary file if it was uploaded from disk
      if (file.path && fs.existsSync(file.path)) {
        try {
          fs.unlinkSync(file.path);
        } catch (cleanupErr) {
          logger.error("Failed to cleanup temp file:", { error: cleanupErr.message, path: file.path });
        }
      }
      if (error) {
        logger.error("Cloudinary upload failed", { error: error.message });
        return reject(error);
      }
      resolve(result);
    };

    if (file.buffer) {
      // If file is in memory (buffer), use upload_stream
      const uploadStream = cloudinary.uploader.upload_stream({ resource_type: "auto" }, handleUpload);
      streamifier.createReadStream(file.buffer).pipe(uploadStream);
    } else if (file.path) {
      // If file is on disk (path), use standard uploader
      cloudinary.uploader.upload(file.path, { resource_type: "auto" }, handleUpload);
    } else {
      return reject(new Error("Invalid file object provided."));
    }
  });
};

export default uploadOnCloudinary;