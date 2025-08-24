import express from "express";
import upload from "../middleware/multer.middleware.js";
import { registerOwner } from "../controllers/ownerRegistrationController.js";

const router = express.Router();

// Route: Owner Registration
router.post(
  "/register",
  upload.fields([
    { name: "profileImage", maxCount: 1 },         // single profile image
    { name: "images", maxCount: 5 },               // multiple restaurant/gallery images
    { name: "businessLicenseImage", maxCount: 1 }, // license doc
    { name: "foodHygieneCertificateImage", maxCount: 1 }, // hygiene cert
    { name: "vatCertificateImage", maxCount: 1 },  // VAT cert
    { name: "bankDocumentImage", maxCount: 1 },    // bank doc
  ]),
  registerOwner
);

export default router;
