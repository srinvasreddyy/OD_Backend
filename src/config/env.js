import dotenv from 'dotenv';

dotenv.config();

const requiredEnvVars = [
  'NODE_ENV',
  'PORT',
  'CORS_ORIGIN',
  'MONGODB_URI',
  'JWT_SECRET',
  'JWT_EXPIRY',
  'PAGINATION_DEFAULT_LIMIT',
  'PAGINATION_MAX_LIMIT',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'EMAIL_USER',
  'EMAIL_PASS',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_CALLBACK_URL',
  'CLIENT_SUCCESS_REDIRECT_URL',
  'CLIENT_FAILURE_REDIRECT_URL',
  'STRIPE_WEBHOOK_SECRET', // <-- NEW REQUIRED VAR
];

const checkEnvVars = () => {
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  if (missingVars.length > 0) {
    console.error(`FATAL: Missing required environment variables: ${missingVars.join(', ')}`);
    process.exit(1);
  }
};

checkEnvVars();

const config = {
  nodeEnv: process.env.NODE_ENV,
  port: process.env.PORT,
  corsOrigin: process.env.CORS_ORIGIN,
  mongodbUri: process.env.MONGODB_URI,
  jwt: {
    secret: process.env.JWT_SECRET,
    expiry: process.env.JWT_EXPIRY,
  },
  pagination: {
    defaultLimit: parseInt(process.env.PAGINATION_DEFAULT_LIMIT, 10),
    maxLimit: parseInt(process.env.PAGINATION_MAX_LIMIT, 10),
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },
  email: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  googleOAuth: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl: process.env.GOOGLE_CALLBACK_URL,
  },
  clientUrls: {
    successRedirect: process.env.CLIENT_SUCCESS_REDIRECT_URL,
    failureRedirect: process.env.CLIENT_FAILURE_REDIRECT_URL,
  },
  stripe: { // <-- NEW STRUCTURE FOR STRIPE KEYS
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  },
  featureFlags: {
    enableOffers: process.env.ENABLE_OFFERS === 'true',
    enableBookingLocks: process.env.ENABLE_BOOKING_LOCKS === 'true',
    enableIdempotencyCheck: process.env.ENABLE_IDEMPOTENCY_CHECK === 'true', // <-- NEW FLAG
  },
};

export default Object.freeze(config);