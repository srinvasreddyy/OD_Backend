import express from "express";
const router = express.Router();
import  upload  from "../middleware/multer.middleware.js";
import { registerOwner } from "../controllers/ownerController.js";


router.post(
  '/create',
  // Use upload.fields() to specify all the different image fields you expect
  upload.fields([
    { name: 'images', maxCount: 5 }, // e.g., max 5 restaurant images
    { name: 'profileImage', maxCount: 1 },
    { name: 'businessLicenseImage', maxCount: 1 },
    { name: 'foodHygieneCertificateImage', maxCount: 1 },
    { name: 'vatCertificateImage', maxCount: 1 },
    { name: 'bankDocumentImage', maxCount: 1 },
  ]),
  registerOwner
)

export default router