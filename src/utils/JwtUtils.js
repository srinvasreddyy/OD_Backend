import jwt from 'jsonwebtoken';

export function generateJWT(user) {
  return jwt.sign(
    { userId: user._id, userType: user.userType },
    process.env.JWT_SECRET,
    { expiresIn: '2h' }
  );
}
