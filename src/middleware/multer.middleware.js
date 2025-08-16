import multer from "multer";
import fs from "fs";
import path from "path";

// Define temp directory path
const tempDir = path.join(process.cwd(), "public", "temp");

// Check if the directory exists, if not create it
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, tempDir); // save to public/temp
  },
  filename: function (req, file, cb) {
    // --- FIX: Generate a unique filename to prevent race conditions ---
    // This combines the original filename with a timestamp to ensure uniqueness.
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    const finalFilename = path.basename(file.originalname, extension) + '-' + uniqueSuffix + extension;
    cb(null, finalFilename);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024 // 20MB
  }
});

export default upload;