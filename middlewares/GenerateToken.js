import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config(); // Ensure environment variables are loaded

export const generateTokenAndSetCookies = (res, userId) => {
  const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });

  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // Only secure in production
    sameSite: 'strict', // Helps prevent CSRF
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
  });
  return token; // Return the token, useful if needed immediately
};