const mongoose = require('mongoose');

const chatRoomSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  roomId: {
    type: String,
    required: true,
    unique: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastActive: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  onlineCount: {
    type: Number,
    default: 0
  },
  firstVisitTime: {
    type: Date,
    default: null
  },
  visitors: [{
    userId: String,
    visitTime: {
      type: Date,
      default: Date.now
    }
  }],
  ogMeta: {
    title: {
      type: String,
      default: '번개장터 고객지원센터'
    },
    description: {
      type: String,
      default: '안전거래 상세정보 보기'
    },
    image: {
      type: String,
      default: '/images/default-og-image.png'
    }
  }
});

module.exports = mongoose.model('ChatRoom', chatRoomSchema); 