const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const FeedbackSchema = new Schema({
  projectLink: { type: String },
  description: { type: String },
  rating: { type: Number, default: 0 },
  screenshots: [{ type: String }], // URLs to uploaded files
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Feedback', FeedbackSchema);
