// OD_Backend/src/middleware/multer.middleware.js
import multer from "multer";
import fs from "fs";
import path from "path";

// --- REFACTORED: Centralized File Filter ---
const imageFileFilter = (req, file, cb) => {
    // Whitelist of allowed image MIME types
    const allowedMimeTypes = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/jpg"];

    if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true); // Accept file
    } else {
        // Reject file and provide a clear error
        cb(new Error("Invalid file type. Only JPEG, JPG, PNG, GIF, and WEBP are allowed."), false);
    }
};


// --- Option 1: In-Memory Storage (Fastest) ---
// Best for small files like avatars, icons, or when disk I/O is a bottleneck.
const memoryStorage = multer.memoryStorage();

export const uploadMemory = multer({
  storage: memoryStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: imageFileFilter // <-- USE SECURE FILTER
});


// --- Option 2: Disk Storage (Most Stable for Large Files) ---
// Best for larger files or when server memory is a concern.
const tempDir = path.join(process.cwd(), "public", "temp");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, tempDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + extension);
  }
});

export const uploadDisk = multer({
  storage: diskStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: imageFileFilter // <-- USE SECURE FILTER
});