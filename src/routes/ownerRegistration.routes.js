import express from 'express';
import { uploadMemory } from '../middleware/multer.middleware.js'; 
import { registerOwner } from '../controllers/ownerRegistrationController.js';

const router = express.Router();

// Define the fields Multer should expect
const ownerUploadFields = [
  { name: 'profileImage', maxCount: 1 },
  { name: 'images', maxCount: 5 },
  { name: 'businessLicenseImage', maxCount: 1 },
  { name: 'foodHygieneCertificateImage', maxCount: 1 },
  { name: 'vatCertificateImage', maxCount: 1 },
  { name: 'bankDocumentImage', maxCount: 1 }
];

router.post('/register', uploadMemory.fields(ownerUploadFields), registerOwner);

export default router;