import jwt from 'jsonwebtoken';

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
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRY || '2h' } // Use env variable with a default
  );
}

export function verifyJWT(token) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET not set');
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return null;
  }
}