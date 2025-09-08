import config from './env.js';

const featureFlags = {
  ENABLE_OFFERS: config.featureFlags.enableOffers,
};

export default featureFlags;