const mongoose = require('mongoose');

const ChatMessageSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  from: { type: mongoose.Schema.Types.ObjectId, refPath: 'fromModel', required: true },
  fromModel: { type: String, enum: ['User', 'Developer'] },
  to: { type: mongoose.Schema.Types.ObjectId, refPath: 'toModel' },
  toModel: { type: String, enum: ['User', 'Developer'] },
  text: { type: String, trim: true },
  files: [{ name: String, url: String }],
  type: { type: String, enum: ['user', 'system', 'file'], default: 'user' },
  reactions: { type: mongoose.Schema.Types.Mixed },
  timestamp: { type: Date, default: Date.now },
  deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
});

module.exports = mongoose.model('ChatMessage', ChatMessageSchema);
