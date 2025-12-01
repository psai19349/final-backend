const nodemailer = require('nodemailer');
require('dotenv').config(); // Ensure environment variables are loaded

// ADVISORY: Ensure EMAIL_HOST, EMAIL_PORT, EMAIL_SECURE, EMAIL_USER, EMAIL_PASS are in your .env file
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT, 10) || 465,
    secure: String(process.env.EMAIL_SECURE).toLowerCase() === 'true',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

module.exports = transporter;
