const mongoose = require('mongoose');

const VALID_STATUSES = ['open', 'in progress', 'testing', 'qa', 'completed'];

const TimelineEntrySchema = new mongoose.Schema({
  status: { type: String, trim: true },
  message: { type: String, trim: true },
  by: { type: mongoose.Schema.Types.ObjectId, refPath: 'byModel' },
  byModel: { type: String, enum: ['User', 'Developer'] },
  createdAt: { type: Date, default: Date.now }
});

const DeletionRequestSchema = new mongoose.Schema({
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  requestedAt: Date,
  status: { type: String, enum: ['requested', 'approved', 'cancelled'], default: 'requested' },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, refPath: 'deletionRequest.approvedByModel' },
  approvedByModel: { type: String, enum: ['Developer', 'Admin', 'User'] },
  approvedAt: Date
}, { _id: false });

const ProjectSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  budget: {
    type: Number,
    required: true
  },
  deadline: {
    type: Date,
    required: true
  },
  attachments: [{
    type: String
  }],
  contactEmail: { type: String, trim: true },
  contactPhone: { type: String, trim: true },
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  developer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Developer'
  },
  acceptedAt: { type: Date },
  status: {
    type: String,
    enum: ['open', 'in progress', 'completed'],
    default: 'open'
  },
  timeline: [TimelineEntrySchema],
  deletionRequest: DeletionRequestSchema,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Project', ProjectSchema);
module.exports.VALID_STATUSES = VALID_STATUSES;
