import jwt from 'jsonwebtoken';

export function generateJWT(user) {
  const payload = {
    userId: user._id,
    userType: user.userType
  };
  if (user.userType === 'owner') {
    payload.restaurantId = user._id;
  }
  return jwt.sign(
    payload,
    process.env.JWT_SECRET,
    { expiresIn: '2h' }
  );
}

export function verifyJWT(token) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET not set');
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    // Consider logging the error
    return null;
  }
}