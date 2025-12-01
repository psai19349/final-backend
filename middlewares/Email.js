const transporter = require('./Email.confiq');
const { Verification_Email_Template, Welcome_Email_Template } = require('./EmailTemplate');
require('dotenv').config(); // Ensure environment variables are loaded

const sendVerificationEmail = async (email, verificationCode) => {
    try {
        const html = Verification_Email_Template.replace('{verificationCode}', verificationCode);
        const mailOptions = {
            from: process.env.EMAIL_FROM || '"CodeXus Marketplace" <no-reply@easyweb.local>',
            to: email,
            subject: process.env.VERIFICATION_SUBJECT || 'Welcome to CodeXus - Email Verification',
            text: `Your verification code is: ${verificationCode}`,
            html
        };
        const info = await transporter.sendMail(mailOptions);
        console.log('[sendVerificationEmail] Verification email sent:', info && (info.messageId || info.response || info));
        if (info.rejected && info.rejected.length > 0) {
            console.error('[sendVerificationEmail] Email rejected for:', info.rejected);
            throw new Error('Email rejected: ' + info.rejected.join(', '));
        }
        return info;
    } catch (error) {
        console.error('[sendVerificationEmail] Error sending verification email:', error);
        throw error;
    }
};

const sendWelcomeEmail = async (email, name) => {
    try {
        const html = Welcome_Email_Template.replace('{name}', name || '');
        const mailOptions = {
            from: process.env.EMAIL_FROM || '"CodeXus Marketplace" <no-reply@easyweb.local>',
            to: email,
            subject: process.env.WELCOME_SUBJECT || 'Welcome to CodeXus Marketplace!',
            text: `Welcome, ${name}!`,
            html
        };
        const info = await transporter.sendMail(mailOptions);
        console.log('[sendWelcomeEmail] Welcome email sent:', info && (info.messageId || info.response || info));
        return info;
    } catch (error) {
        console.error('[sendWelcomeEmail] Error sending welcome email:', error);
        throw error;
    }
};

const sendProjectStatusEmail = async (email, clientName, projectTitle, status, details) => {
    try {
        const mailOptions = {
            from: process.env.EMAIL_FROM || '"CodeXus Marketplace" <no-reply@easyweb.local>',
            to: email,
            subject: `Update on Your Project: ${projectTitle}`,
            text: `Hello ${clientName},\n\nCurrent Status: ${status}\n\n${details}`,
            html: `<div style="font-family: 'Segoe UI', Arial, sans-serif; color: #222; background: #f8fafc; padding: 32px; border-radius: 16px;">` +
                  `<h2 style="color: #0ea5e9; margin-bottom: 8px;">Project Update from CodeXus</h2>` +
                  `<p style="font-size: 1em; margin-bottom: 12px;">Hello <b>${clientName}</b>,</p>` +
                  `<p style="margin-bottom: 12px;">We're excited to update you on your project <b>${projectTitle}</b>.</p>` +
                  `<div style="background: #e0f2fe; padding: 18px 24px; border-radius: 12px; margin-bottom: 24px;">` +
                  `<span style="font-size: 1.1em; color: #0369a1;">Current Status:</span>` +
                  `<div style="font-size: 1.5em; font-weight: bold; color: #0ea5e9; margin: 12px 0; letter-spacing: 1px;">${status}</div>` +
                  `</div><p style="margin-bottom: 12px;">${details}</p>` +
                  `<hr style="margin: 24px 0; border: none; border-top: 1px solid #e0e7ef;" />` +
                  `<p style="font-size: 1em; color: #222;">Thank you for choosing CodeXus.<br/><span style="color: #0ea5e9; font-weight: bold;">The CodeXus Team</span></p></div>`
        };
        console.log('[sendProjectStatusEmail] Attempting to send email to:', email);
        const info = await transporter.sendMail(mailOptions);
        console.log('[sendProjectStatusEmail] Email sent successfully:', info && (info.messageId || info.response || info));
        if (info.rejected && info.rejected.length > 0) {
            console.error('[sendProjectStatusEmail] Email rejected for:', info.rejected);
            throw new Error('Email rejected: ' + info.rejected.join(', '));
        }
        return info;
    } catch (error) {
        console.error('[sendProjectStatusEmail] Error sending project status email:', error);
        throw error;
    }
};

module.exports = {
    sendVerificationEmail,
    sendWelcomeEmail,
    sendProjectStatusEmail
};
