import jwt from 'jsonwebtoken';
import config from '../config/env.js';

// The second argument `isOwner` determines the payload structure
export function generateJWT(entity, isOwner = false) {
  let payload;

  if (isOwner) {
    // Create a distinct payload for Restaurant Owners
    payload = {
      restaurantId: entity._id,
      userType: 'owner'
    };
  } else {
    // Create the standard payload for Users
    payload = {
      userId: entity._id,
      userType: entity.userType
    };
  }
  
  return jwt.sign(
    payload,
    config.jwt.secret,
    { expiresIn: config.jwt.expiry }
  );
}

export function verifyJWT(token) {
  try {
    return jwt.verify(token, config.jwt.secret);
  } catch (error) {
    return null;
  }
}