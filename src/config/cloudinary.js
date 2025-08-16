import { v2 as cloudinary } from "cloudinary";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const uploadOnCloudinary = async function (localFilePath) {
  if (!localFilePath) {
    console.error("Cloudinary upload failed: File path is missing.");
    return null;
  }

  try {
    // Upload the file to Cloudinary
    const response = await cloudinary.uploader.upload(localFilePath, {
      resource_type: "auto"
    });

    // File has been uploaded successfully
    console.log("✅ File uploaded to Cloudinary:", response.secure_url);
    return response;

  } catch (error) {
    // An error occurred during the upload
    console.error("❌ Cloudinary upload failed:", error.message);
    return null;

  } finally {
    // --- This block will always run, ensuring the file is deleted ---
    try {
      if (fs.existsSync(localFilePath)) {
        fs.unlinkSync(localFilePath); // Delete the local temporary file
        console.log("🗑️  Temporary file deleted:", localFilePath);
      }
    } catch (unlinkErr) {
      // This might happen if the file was already deleted or permissions are wrong
      console.error("❌ Failed to delete temporary file:", unlinkErr.message);
    }
  }
};

export default uploadOnCloudinary;
