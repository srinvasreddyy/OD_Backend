import config from './env.js';

const featureFlags = {
  ENABLE_OFFERS: config.featureFlags.enableOffers,
  ENABLE_SUPER_ADMIN_REGISTRATION: config.featureFlags.enableSuperAdminRegistration, // <-- NEW
};

export default featureFlags;