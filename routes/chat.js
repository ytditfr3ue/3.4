const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const ChatRoom = require('../models/ChatRoom');
const Message = require('../models/Message');
const multer = require('multer');
const path = require('path');
const sharp = require('sharp');
const fs = require('fs');
const QuickReply = require('../models/QuickReply');
const { uploadLimits } = require('../config/security');
const { uploadValidation } = require('../middleware/security');

// 生成带user前缀的5位随机数字ID
function generateRoomId() {
    return 'user' + Math.floor(10000 + Math.random() * 90000).toString();
}

// 配置图片上传
const storage = multer.diskStorage({
    destination: uploadLimits.uploadDir,
    filename: function(req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'image-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: uploadLimits.fileSize },
    fileFilter: function(req, file, cb) {
        // 检查MIME类型
        if (!uploadLimits.allowedMimeTypes.includes(file.mimetype)) {
            return cb(new Error('不支持的文件类型'));
        }
        cb(null, true);
    }
}).single('image');

// 创建聊天室
router.post('/rooms', authMiddleware, async (req, res) => {
    try {
        const { name, roomId } = req.body;

        // 验证房间名称
        if (!name || name.length < 2 || name.length > 50) {
            return res.status(400).json({ message: '채팅방 이름은 2~50자 사이여야 합니다' });
        }

        // 验证roomId格式
        if (!roomId || !roomId.match(/^[a-zA-Z0-9]{3,7}$/)) {
            return res.status(400).json({ message: '채팅방 ID는 3-7자리의 영문/숫자만 가능합니다' });
        }

        // 检查roomId是否已存在
        const existingRoom = await ChatRoom.findOne({ roomId });
        if (existingRoom) {
            return res.status(400).json({ message: '이미 사용 중인 채팅방 ID입니다' });
        }

        const chatRoom = new ChatRoom({
            name,
            roomId
        });

        await chatRoom.save();
        res.status(201).json(chatRoom);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// 获取聊天室列表
router.get('/rooms', authMiddleware, async (req, res) => {
    try {
        const rooms = await ChatRoom.find({ isActive: true }).sort({ createdAt: -1 });
        res.json(rooms);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// 获取单个聊天室
router.get('/rooms/:id', async (req, res) => {
    try {
        const room = await ChatRoom.findOne({ roomId: req.params.id });
        if (!room) {
            return res.status(404).json({ message: '채팅방을 찾을 수 없습니다' });
        }
        res.json(room);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// 删除聊天室
router.delete('/rooms/:id', authMiddleware, async (req, res) => {
    try {
        const room = await ChatRoom.findById(req.params.id);
        if (!room) {
            return res.status(404).json({ message: '聊天室不存在' });
        }

        // 先广播删除消息
        if (req.socketHandler) {
            await req.socketHandler.broadcastRoomDeletion(room.roomId);
        }
        
        // 等待一小段时间确保消息发送
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // 然后删除聊天室和相关消息
        await ChatRoom.findByIdAndDelete(req.params.id);
        await Message.deleteMany({ roomId: req.params.id });
        
        res.json({ message: '聊天室已删除', roomId: room.roomId });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// 获取聊天记录
router.get('/rooms/:id/messages', async (req, res) => {
    try {
        const room = await ChatRoom.findOne({ roomId: req.params.id });
        if (!room) {
            return res.status(404).json({ message: '채팅방을 찾을 수 없습니다' });
        }
        const messages = await Message.find({ roomId: room._id }).sort({ createdAt: 1 });
        res.json(messages);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// 上传图片
router.post('/upload', (req, res) => {
    upload(req, res, function(err) {
        if (err) {
            return res.status(400).json({ message: err.message });
        }
        
        if (!req.file) {
            return res.status(400).json({ message: '没有上传文件' });
        }

        // 使用sharp处理图片
        const processedImagePath = path.join(
            uploadLimits.uploadDir,
            'processed-' + req.file.filename
        );

        sharp(req.file.path)
            .resize(uploadLimits.maxWidth, uploadLimits.maxHeight, {
                fit: 'inside',
                withoutEnlargement: true
            })
            .jpeg({ quality: 80 })
            .toFile(processedImagePath)
            .then(() => {
                // 删除原始文件
                fs.unlink(req.file.path, () => {});
                const imageUrl = `/uploads/processed-${req.file.filename}`;
                res.json({ imageUrl });
            })
            .catch(error => {
                // 清理任何已上传的文件
                if (req.file) {
                    fs.unlink(req.file.path, () => {});
                }
                console.error('Upload error:', error);
                res.status(500).json({ message: error.message });
            });
    });
});

// 获取快捷回复
router.get('/quick-replies', async (req, res) => {
    try {
        const replies = await QuickReply.find().sort({ createdAt: -1 });
        res.json(replies);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// 添加快捷回复
router.post('/quick-replies', authMiddleware, async (req, res) => {
    try {
        const { content } = req.body;
        const quickReply = new QuickReply({ content });
        await quickReply.save();
        res.status(201).json(quickReply);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// 删除快捷回复
router.delete('/quick-replies/:id', authMiddleware, async (req, res) => {
    try {
        const result = await QuickReply.findByIdAndDelete(req.params.id);
        if (!result) {
            return res.status(404).json({ message: '快捷回复不存在' });
        }
        res.json({ message: '快捷回复已删除' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

module.exports = router; 