export function generateOTP(length = 6) {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function isOTPExpired(otpGeneratedAt, expiryMinutes = 5) {
  const now = new Date();
  const expiry = new Date(otpGeneratedAt);
  expiry.setMinutes(expiry.getMinutes() + expiryMinutes);
  return now > expiry;
}
