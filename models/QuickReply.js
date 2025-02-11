const mongoose = require('mongoose');

const quickReplySchema = new mongoose.Schema({
    content: {
        type: String,
        required: true
    },
    side: {
        type: String,
        enum: ['left', 'right'],
        required: true,
        default: 'left'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('QuickReply', quickReplySchema); 