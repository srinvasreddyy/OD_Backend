import config from './env.js';

const featureFlags = {
  ENABLE_OFFERS: true,
  ENABLE_SUPER_ADMIN_REGISTRATION: config.featureFlags.enableSuperAdminRegistration, 
  enableOnlinePayments: true,
  enableIdempotencyCheck: true
};

export default featureFlags;