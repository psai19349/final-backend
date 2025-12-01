// Developer model for easyweb (Mongoose)
const mongoose = require('mongoose');

const developerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['developer'], default: 'developer', required: true },
  country: { type: String, required: true },
  otp: { type: String },
  otpExpires: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('Developer', developerSchema);
