const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  roomId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChatRoom',
    required: true
  },
  content: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  type: {
    type: String,
    enum: ['text', 'image', 'system'],
    required: true
  },
  subType: {
    type: String,
    enum: ['room_created', 'first_visit', null],
    default: null
  },
  sender: {
    type: String,
    required: function() {
      return this.type !== 'system';
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Message', messageSchema); 