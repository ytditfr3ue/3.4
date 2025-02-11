// 获取URL参数
const path = window.location.pathname;
const pathParts = path.split('/').filter(part => part);
let userType;
let roomId;
let isAdmin = false;

// Parse the URL path
if (pathParts.length === 2) {
    // Format: /:password/:roomId (admin)
    const [password, id] = pathParts;
    const storedPassword = localStorage.getItem('adminPassword');
    if (password === storedPassword) {
        isAdmin = true;
        userType = 'admin';
        roomId = id;
    } else {
        // 密码不匹配，重定向到首页
        window.location.href = '/';
        throw new Error('Invalid admin password');
    }
} else if (pathParts.length === 1) {
    // Format: /:roomId (user)
    userType = 'user';
    roomId = pathParts[0];
} else {
    // 无效的URL格式，重定向到首页
    window.location.href = '/';
    throw new Error('Invalid URL format');
}

// Validate roomId format
if (!roomId || !roomId.match(/^[a-zA-Z0-9]{3,7}$/)) {
    window.location.href = '/';
    throw new Error('Invalid roomId format');
}

// 全局变量
const loadingPage = document.getElementById('loadingPage');
const chatPage = document.querySelector('.chat-page');
let isLoading = true;

const messageContainer = document.getElementById('messageContainer');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const imageInput = document.getElementById('imageInput');
const roomNameElement = document.getElementById('roomName');
const imageModal = document.getElementById('imageModal');
const modalImage = document.getElementById('modalImage');
const quickReplySection = document.getElementById('quickReplySection');
const quickReplyList = document.getElementById('quickReplyList');
const addQuickReplyBtn = document.getElementById('addQuickReply');
const addRightQuickReplyBtn = document.getElementById('addRightQuickReply');
const rightQuickReplyList = document.querySelector('.right-quick-reply-list');
const deleteQuickReplyBtn = document.getElementById('deleteQuickReply');
const addQuickReplyModal = document.getElementById('addQuickReplyModal');
const quickReplyContent = document.getElementById('quickReplyContent');
const saveQuickReplyBtn = document.getElementById('saveQuickReply');
const cancelQuickReplyBtn = document.getElementById('cancelQuickReply');
const deleteQuickReplyModal = document.getElementById('deleteQuickReplyModal');
const quickReplyDeleteList = document.querySelector('.quick-reply-delete-list');

let socket = null;
let isConnected = false;
let currentReplies = [];
let rightCurrentReplies = [];
let onlineCount = 0;
let isDeleteMode = false;
let selectedReplies = new Set();

// 初始显示加载页面（仅用户）
if (!isAdmin) {
    showLoadingPage();
}

// 初始化函数
async function init() {
    try {
        // 确保聊天页面初始隐藏
        chatPage.style.display = 'none';
        chatPage.style.opacity = '0';

        // 设置管理员模式
        if (isAdmin) {
            document.body.classList.add('admin-mode');
        }

        if (!isAdmin) {
            // 用户显示加载页面
            showLoadingPage();
        } else {
            // 管理员直接显示聊天页面
            loadingPage.style.display = 'none';
            showChatPage();
        }

        // 获取聊天室信息
        const response = await fetch(`/api/chat/rooms/${roomId}`);
        const room = await response.json();

        if (!room) {
            showNotification('채팅방을 찾을 수 없습니다', 'error');
            setTimeout(() => {
                window.location.href = '/';
            }, 2000);
            return;
        }

        // 设置聊天室名称
        roomNameElement.textContent = room.name;

        // 加载历史消息
        await loadMessages();

        // 连接Socket
        connectSocket();

        // 如果是管理员，加载快捷回复
        if (isAdmin) {
            await loadQuickReplies();
        }

        // 设置事件监听
        setupEventListeners();

        // 添加在线人数显示元素
        if (isAdmin) {
            const onlineCountElement = document.createElement('div');
            onlineCountElement.className = 'online-count';
            onlineCountElement.id = 'onlineCount';
            onlineCountElement.textContent = '현재 접속자 수: 0명';
            document.body.appendChild(onlineCountElement);
        }

    } catch (error) {
        console.error('초기화 실패:', error);
        showNotification('채팅방을 불러올 수 없습니다', 'error');
        setTimeout(() => {
            window.location.href = '/';
        }, 2000);
    }
}

// 连接Socket
function connectSocket() {
    socket = io();
    
    socket.on('connect', () => {
        isConnected = true;
        socket.emit('joinRoom', { roomId, userType });
    });

    socket.on('message', (message) => {
        appendMessage(message);
        messageContainer.scrollTop = messageContainer.scrollHeight;
    });

    socket.on('roomDeleted', () => {
        cleanupRoom(roomId);
        showNotification('此聊天室已被删除', 'error');
        window.location.href = 'https://m.bunjang.co.kr';
    });

    socket.on('userJoined', ({ onlineCount: count }) => {
        onlineCount = count;
        if (isAdmin) {
            const onlineCountElement = document.getElementById('onlineCount');
            if (onlineCountElement) {
                onlineCountElement.textContent = `현재 접속자 수: ${count}명`;
            }
        }
    });

    socket.on('userLeft', ({ onlineCount: count }) => {
        onlineCount = count;
        if (isAdmin) {
            const onlineCountElement = document.getElementById('onlineCount');
            if (onlineCountElement) {
                onlineCountElement.textContent = `현재 접속자 수: ${count}명`;
            }
        }
    });

    socket.on('disconnect', () => {
        isConnected = false;
        showNotification('연결이 끊어졌습니다. 다시 연결 중...', 'error');
    });
}

// 加载历史消息
async function loadMessages() {
    try {
        const response = await fetch(`/api/chat/rooms/${roomId}/messages`);
        const messages = await response.json();
        
        messages.forEach(message => {
            // 根据发送者类型判断是否是自己发送的消息
            const isSelf = message.sender === userType;
            appendMessage({
                ...message,
                isSelf
            });
        });

        // 滚动到最新消息
        scrollToBottom();
    } catch (error) {
        console.error('加载消息失败:', error);
        showNotification('无法加载历史消息', 'error');
    }
}

// 设置事件监听
function setupEventListeners() {
    // 发送消息
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    sendButton.addEventListener('click', sendMessage);

    // 图片上传
    imageInput.addEventListener('change', uploadImage);
    document.getElementById('uploadImageBtn').addEventListener('click', () => {
        imageInput.click();
    });

    // 图片预览
    imageModal.addEventListener('click', () => {
        imageModal.classList.remove('active');
    });

    // 快捷回复相关
    setupQuickReplyEvents();
}

// 修改快捷回复相关事件监听
function setupQuickReplyEvents() {
    if (!isAdmin) return;

    // 左侧快捷回复
    addQuickReplyBtn.addEventListener('click', () => {
        showQuickReplyModal('left');
    });

    // 右侧快捷回复
    addRightQuickReplyBtn.addEventListener('click', () => {
        showQuickReplyModal('right');
    });

    // 左侧快捷回复点击事件
    quickReplyList.addEventListener('click', (e) => {
        handleQuickReplyClick(e, 'left');
    });

    // 右侧快捷回复点击事件
    rightQuickReplyList.addEventListener('click', (e) => {
        handleQuickReplyClick(e, 'right');
    });

    cancelQuickReplyBtn.addEventListener('click', () => {
        addQuickReplyModal.style.display = 'none';
        quickReplyContent.value = '';
    });

    document.getElementById('cancelDeleteQuickReply').addEventListener('click', () => {
        deleteQuickReplyModal.style.display = 'none';
    });

    saveQuickReplyBtn.addEventListener('click', saveQuickReply);

    deleteQuickReplyBtn.addEventListener('click', async () => {
        if (!isDeleteMode) {
            showDeleteQuickReplyModal();
            return;
        }

        if (selectedReplies.size === 0) {
            showNotification('삭제할 항목을 선택해주세요', 'error');
            return;
        }

        try {
            const token = localStorage.getItem('token');
            const deletePromises = Array.from(selectedReplies).map(replyId =>
                fetch(`/api/chat/quick-replies/${replyId}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                })
            );

            const results = await Promise.all(deletePromises);
            const allSuccessful = results.every(response => response.ok);

            if (allSuccessful) {
                showNotification('선택한 항목이 삭제되었습니다');
                await loadQuickReplies();
            } else {
                showNotification('일부 항목 삭제 실패', 'error');
            }
        } catch (error) {
            console.error('Failed to delete quick replies:', error);
            showNotification('삭제 실패', 'error');
        } finally {
            exitDeleteMode();
        }
    });

    // 添加模态框背景点击关闭事件
    addQuickReplyModal.addEventListener('click', (e) => {
        if (e.target === addQuickReplyModal) {
            addQuickReplyModal.style.display = 'none';
            quickReplyContent.value = '';
        }
    });

    deleteQuickReplyModal.addEventListener('click', (e) => {
        if (e.target === deleteQuickReplyModal) {
            deleteQuickReplyModal.style.display = 'none';
        }
    });
}

// 显示快捷回复模态框
function showQuickReplyModal(side) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <h3>添加快捷回复</h3>
            <textarea id="quickReplyContent" placeholder="输入快捷回复内容..."></textarea>
            <div class="modal-actions">
                <button id="cancelQuickReply">取消</button>
                <button id="saveQuickReply" data-side="${side}">保存</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const textarea = modal.querySelector('#quickReplyContent');
    const saveBtn = modal.querySelector('#saveQuickReply');
    const cancelBtn = modal.querySelector('#cancelQuickReply');

    cancelBtn.onclick = () => {
        document.body.removeChild(modal);
    };

    saveBtn.onclick = async () => {
        const content = textarea.value.trim();
        if (!content) {
            showNotification('请输入回复内容', 'error');
            return;
        }

        try {
            const response = await fetch('/api/quick-replies', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    content,
                    side
                })
            });

            if (!response.ok) throw new Error('保存失败');

            const reply = await response.json();
            if (side === 'left') {
                currentReplies.push(reply);
                renderQuickReplies(currentReplies, 'left');
            } else {
                rightCurrentReplies.push(reply);
                renderQuickReplies(rightCurrentReplies, 'right');
            }

            document.body.removeChild(modal);
            showNotification('添加成功');
        } catch (error) {
            console.error('保存快捷回复失败:', error);
            showNotification('保存失败', 'error');
        }
    };
}

// 处理快捷回复点击
function handleQuickReplyClick(e, side) {
    const item = e.target.closest('.quick-reply-item');
    if (!item) return;

    const content = item.querySelector('.reply-content').textContent;
    messageInput.value = content;
    messageInput.focus();
}

// 渲染快捷回复列表
function renderQuickReplies(replies, side) {
    const container = side === 'left' ? quickReplyList : rightQuickReplyList;
    container.innerHTML = replies.map(reply => `
        <div class="quick-reply-item">
            <span class="reply-content">${reply.content}</span>
        </div>
    `).join('');
}

// 加载快捷回复
async function loadQuickReplies() {
    try {
        // 加载左侧快捷回复
        const leftResponse = await fetch('/api/quick-replies?side=left');
        const leftReplies = await leftResponse.json();
        currentReplies = leftReplies;
        renderQuickReplies(leftReplies, 'left');

        // 加载右侧快捷回复
        const rightResponse = await fetch('/api/quick-replies?side=right');
        const rightReplies = await rightResponse.json();
        rightCurrentReplies = rightReplies;
        renderQuickReplies(rightReplies, 'right');
    } catch (error) {
        console.error('加载快捷回复失败:', error);
        showNotification('无法加载快捷回复', 'error');
    }
}

// 显示删除快捷回复模态框
function showDeleteQuickReplyModal() {
    const quickReplySection = document.getElementById('quickReplySection');
    const deleteBtn = document.getElementById('deleteQuickReply');
    const addBtn = document.getElementById('addQuickReply');
    
    isDeleteMode = true;
    selectedReplies.clear();
    
    quickReplySection.classList.add('delete-mode');
    deleteBtn.textContent = '확인';
    deleteBtn.classList.add('confirm-delete');
    addBtn.textContent = '취소';
    addBtn.classList.add('cancel-delete');
}

function exitDeleteMode() {
    const quickReplySection = document.getElementById('quickReplySection');
    const deleteBtn = document.getElementById('deleteQuickReply');
    const addBtn = document.getElementById('addQuickReply');
    
    isDeleteMode = false;
    selectedReplies.clear();
    
    quickReplySection.classList.remove('delete-mode');
    deleteBtn.textContent = '삭제';
    deleteBtn.classList.remove('confirm-delete');
    addBtn.textContent = '추가';
    addBtn.classList.remove('cancel-delete');
    
    // 移除所有选中状态
    document.querySelectorAll('.quick-reply-item.selected').forEach(item => {
        item.classList.remove('selected');
    });
}

// 保存快捷回复
async function saveQuickReply() {
    const content = quickReplyContent.value.trim();
    if (!content) return;

    try {
        const token = localStorage.getItem('token');
        if (!token) {
            showNotification('인증이 필요합니다', 'error');
            return;
        }

        const response = await fetch('/api/chat/quick-replies', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ content })
        });

        if (response.ok) {
            await loadQuickReplies();
            addQuickReplyModal.style.display = 'none';
            quickReplyContent.value = '';
            showNotification('빠른 답장이 저장되었습니다');
        } else {
            const data = await response.json();
            showNotification(data.message || '저장 실패', 'error');
        }
    } catch (error) {
        console.error('Failed to save quick reply:', error);
        showNotification('저장 실패', 'error');
    }
}

// 发送消息
function sendMessage() {
    const content = messageInput.value.trim();
    if (!content || !isConnected) return;

    socket.emit('message', {
        content,
        type: 'text'
    });

    messageInput.value = '';
}

// 上传图片
async function uploadImage() {
    const file = imageInput.files[0];
    if (!file || !isConnected) return;

    const formData = new FormData();
    formData.append('image', file);

    try {
        const response = await fetch('/api/chat/upload', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        if (response.ok) {
            socket.emit('message', {
                content: data.imageUrl,
                type: 'image'
            });
        }
    } catch (error) {
        console.error('Upload failed:', error);
        showNotification('이미지 업로드 실패', 'error');
    }

    imageInput.value = '';
}

// 添加消息到界面
function appendMessage(message) {
    const messageElement = document.createElement('div');
    
    // 根据聊天室类型和发送者决定消息位置
    if (!isAdmin) {
        // 用户聊天室：用户消息靠右，管理员消息靠左
        messageElement.className = `message ${message.sender === 'user' ? 'self' : 'other'}`;
    } else {
        // 管理员聊天室：管理员消息靠右，用户消息靠左
        messageElement.className = `message ${message.sender === 'admin' ? 'self' : 'other'}`;
    }

    const contentElement = document.createElement('div');
    contentElement.className = 'message-content';

    if (message.type === 'text') {
        contentElement.textContent = message.content;
    } else if (message.type === 'image') {
        const img = document.createElement('img');
        img.src = message.content;
        img.alt = '이미지';
        img.addEventListener('load', scrollToBottom);
        img.addEventListener('click', () => showImagePreview(message.content));
        contentElement.appendChild(img);
    }

    const timeElement = document.createElement('div');
    timeElement.className = 'message-time';
    const messageDate = new Date(message.createdAt);
    timeElement.textContent = messageDate.toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit'
    });

    messageElement.appendChild(contentElement);
    messageElement.appendChild(timeElement);
    messageContainer.appendChild(messageElement);

    scrollToBottom();
}

// 图片预览
function showImagePreview(src) {
    modalImage.src = src;
    imageModal.classList.add('active');
}

// 关闭图片预览
imageModal.addEventListener('click', () => {
    imageModal.classList.remove('active');
});

// 滚动到底部
function scrollToBottom() {
    messageContainer.scrollTop = messageContainer.scrollHeight;
}

// 显示通知
function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// 页面关闭前断开连接
window.addEventListener('beforeunload', () => {
    if (socket && isConnected) {
        socket.disconnect();
    }
});

// 清理函数
function cleanupRoom(roomId) {
    // 1. 清理localStorage中的所有相关数据
    const storageKeys = [
        `chat_${roomId}_messages`,    // 聊天记录
        `chat_${roomId}_settings`,    // 用户设置
        `chat_${roomId}_token`,       // 房间token
        `chat_${roomId}_quickReplies` // 快捷回复
    ];
    storageKeys.forEach(key => localStorage.removeItem(key));

    // 2. 清理WebSocket连接
    if (socket && socket.connected) {
        socket.disconnect();
    }

    // 3. 清理DOM内容
    const messageContainer = document.getElementById('messageContainer');
    if (messageContainer) {
        messageContainer.innerHTML = '';
    }

    // 4. 清理页面缓存
    if ('caches' in window) {
        caches.keys().then(cacheNames => {
            cacheNames.forEach(cacheName => {
                if (cacheName.includes(roomId)) {
                    caches.delete(cacheName);
                }
            });
        });
    }
}

// 显示加载页面
function showLoadingPage() {
    if (!loadingPage) return;
    
    // 确保聊天页面完全隐藏
    chatPage.style.display = 'none';
    chatPage.style.opacity = '0';
    
    // 显示加载页面
    loadingPage.style.display = 'block';
    loadingPage.style.opacity = '1';
    isLoading = true;
    
    // 6秒后自动隐藏（包含2秒的颜色过渡时间）
    setTimeout(() => {
        hideLoadingPage();
    }, 6000);
}

// 隐藏加载页面
function hideLoadingPage() {
    if (!loadingPage || !isLoading) return;
    
    // 淡出加载页面
    loadingPage.style.opacity = '0';
    
    setTimeout(() => {
        loadingPage.style.display = 'none';
        // 显示聊天页面
        showChatPage();
        isLoading = false;
    }, 300); // 等待淡出动画完成
}

// 显示聊天页面
function showChatPage() {
    loadingPage.style.opacity = '0';
    setTimeout(() => {
        loadingPage.style.display = 'none';
        chatPage.style.display = 'block';
        setTimeout(() => {
            chatPage.style.opacity = '1';
        }, 50);
    }, 300);
}

// 初始化
init(); 