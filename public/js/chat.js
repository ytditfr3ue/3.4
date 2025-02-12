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
const deleteQuickReplyBtn = document.getElementById('deleteQuickReply');
const addQuickReplyModal = document.getElementById('addQuickReplyModal');
const quickReplyContent = document.getElementById('quickReplyContent');
const saveQuickReplyBtn = document.getElementById('saveQuickReply');
const cancelQuickReplyBtn = document.getElementById('cancelQuickReply');
const deleteQuickReplyModal = document.getElementById('deleteQuickReplyModal');
const quickReplyDeleteList = document.querySelector('.quick-reply-delete-list');
let currentEditingReplyId = null;

let socket = null;
let isConnected = false;
let currentReplies = [];
let onlineCount = 0;
let isDeleteMode = false;
let selectedReplies = new Set();

// 卡片设置
let cardSettings = {
    productImage: '',
    productName: '',
    subtitle1: '',
    subtitle2: '',
    subtitle3: '',
    lastModified: null
};

// 格式化日期
function formatDate(date) {
    return new Date(date).toLocaleTimeString('ko-KR', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    }).replace('AM', '오전')
      .replace('PM', '오후');
}

// 发送卡片消息
function sendCardMessage() {
    if (!cardSettings.productImage || !cardSettings.productName) {
        showNotification('상품 이미지와 상품명을 입력해주세요', 'error');
        return;
    }

    const currentTime = new Date();
    const formattedTime = formatDate(currentTime);
    
    const messageContent = {
        type: 'card',
        productImage: cardSettings.productImage,
        productName: cardSettings.productName,
        subtitle1: cardSettings.subtitle1,
        subtitle2: cardSettings.subtitle2,
        subtitle3: cardSettings.subtitle3,
        time: formattedTime
    };

    if (isConnected) {
        socket.emit('message', {
            content: JSON.stringify(messageContent),
            type: 'text'
        });
    }
}

// 初始显示加载页面（仅用户）
if (!isAdmin) {
    showLoadingPage();
}

// 初始化函数
async function init() {
    try {
        // 确保聊天页面初始隐藏
        const chatPage = document.getElementById('chatPage');
        if (chatPage) {
            chatPage.style.display = 'none';
            chatPage.style.opacity = '0';
        }

        // 设置管理员模式
        if (isAdmin) {
            document.body.classList.add('admin-mode');
        }

        if (!isAdmin) {
            // 用户显示加载页面
            showLoadingPage();
        } else {
            // 管理员直接显示聊天页面
            const loadingPage = document.getElementById('loadingPage');
            if (loadingPage) {
                loadingPage.style.display = 'none';
            }
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
        if (roomNameElement) {
            roomNameElement.textContent = room.name;
        }

        // 加载历史消息
        await loadMessages();

        // 连接Socket
        connectSocket();

        // 如果是管理员，加载快捷回复和商品信息
        if (isAdmin) {
            try {
                await loadQuickReplies();
                
                // 加载保存的商品信息
                const token = localStorage.getItem('token');
                const productInfoResponse = await fetch('/api/chat/product-info', {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                
                if (productInfoResponse.ok) {
                    const productInfo = await productInfoResponse.json();
                    if (productInfo) {
                        cardSettings = {
                            productImage: productInfo.productImage || '',
                            productName: productInfo.productName || '',
                            subtitle1: productInfo.subtitle1 || '',
                            subtitle2: productInfo.subtitle2 || '',
                            subtitle3: productInfo.subtitle3 || '',
                            lastModified: productInfo.lastModified || null
                        };
                    }
                }
            } catch (error) {
                console.error('Failed to load quick replies or product info:', error);
                showNotification('데이터를 로드하지 못했습니다', 'error');
            }
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

        // 设置商品编辑相关事件监听
        if (isAdmin) {
            setupProductEditEvents();
        }

        // 初始化右侧快捷回复
        renderRightQuickReplies();

    } catch (error) {
        console.error('초기화 실패:', error);
        showNotification('초기화에 실패했습니다', 'error');
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

// 退出删除模式
function exitDeleteMode() {
    const quickReplySection = document.querySelector('.quick-reply-section.left');
    const deleteBtn = quickReplySection?.querySelector('button:last-child');
    const addBtn = quickReplySection?.querySelector('button:first-child');
    
    if (!quickReplySection || !deleteBtn || !addBtn) {
        console.error('Exit delete mode elements not found');
        return;
    }
    
    isDeleteMode = false;
    selectedReplies.clear();
    
    quickReplySection.classList.remove('delete-mode');
    deleteBtn.textContent = '편집';
    deleteBtn.classList.remove('confirm-delete');
    addBtn.textContent = '추가';
    addBtn.classList.remove('cancel-delete');
    
    // 移除所有选中状态
    quickReplySection.querySelectorAll('.quick-reply-item.selected').forEach(item => {
        item.classList.remove('selected');
    });
}

// 进入删除模式
function enterDeleteMode() {
    const quickReplySection = document.querySelector('.quick-reply-section.left');
    const deleteBtn = quickReplySection?.querySelector('button:last-child');
    const addBtn = quickReplySection?.querySelector('button:first-child');
    
    if (!quickReplySection || !deleteBtn || !addBtn) {
        console.error('Delete mode elements not found');
        return;
    }
    
    isDeleteMode = true;
    selectedReplies.clear();
    
    quickReplySection.classList.add('delete-mode');
    deleteBtn.textContent = '확인';
    deleteBtn.classList.add('confirm-delete');
    addBtn.textContent = '취소';
    addBtn.classList.add('cancel-delete');
}

// 删除选中的快捷回复
async function deleteSelectedReplies() {
    if (selectedReplies.size === 0) {
        showNotification('삭제할 항목을 선택하세요', 'error');
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
            showNotification('삭제되었습니다');
            await loadQuickReplies();
        } else {
            showNotification('일부 항목을 삭제하지 못했습니다', 'error');
        }
    } catch (error) {
        console.error('Failed to delete quick replies:', error);
        showNotification('삭제 실패', 'error');
    } finally {
        exitDeleteMode();
    }
}

// 设置快捷回复相关事件监听
function setupQuickReplyEvents() {
    if (!isAdmin) return;

    // 只获取左侧的按钮和列表
    const quickReplySection = document.querySelector('.quick-reply-section.left');
    const addQuickReplyBtn = quickReplySection?.querySelector('button:first-child');
    const editQuickReplyBtn = quickReplySection?.querySelector('button:last-child');
    const quickReplyList = quickReplySection?.querySelector('.quick-reply-list');
    
    if (!quickReplySection || !addQuickReplyBtn || !editQuickReplyBtn || !quickReplyList) {
        console.error('Left quick reply elements not found');
        return;
    }

    // 添加按钮事件监听
    addQuickReplyBtn.addEventListener('click', () => {
        if (isDeleteMode) {
            exitDeleteMode();
            return;
        }
        const addQuickReplyModal = document.getElementById('addQuickReplyModal');
        if (addQuickReplyModal) {
            addQuickReplyModal.style.display = 'flex';
        }
    });

    // 编辑按钮事件监听
    editQuickReplyBtn.addEventListener('click', () => {
        if (!isDeleteMode) {
            enterDeleteMode();
        } else {
            deleteSelectedReplies();
        }
    });

    // 快速回复列表点击事件
    quickReplyList.addEventListener('click', handleQuickReplyClick);

    // 设置模态框相关事件
    const addQuickReplyModal = document.getElementById('addQuickReplyModal');
    const cancelQuickReplyBtn = document.getElementById('cancelQuickReply');
    const saveQuickReplyBtn = document.getElementById('saveQuickReply');
    
    if (cancelQuickReplyBtn) {
        cancelQuickReplyBtn.addEventListener('click', () => {
            if (addQuickReplyModal) {
                addQuickReplyModal.style.display = 'none';
                const quickReplyContent = document.getElementById('quickReplyContent');
                if (quickReplyContent) {
                    quickReplyContent.value = '';
                }
            }
        });
    }

    if (saveQuickReplyBtn) {
        saveQuickReplyBtn.addEventListener('click', saveQuickReply);
    }

    // 编辑模态框相关事件监听
    const editModal = document.getElementById('editQuickReplyModal');
    const updateQuickReplyBtn = document.getElementById('updateQuickReply');
    const cancelEditQuickReplyBtn = document.getElementById('cancelEditQuickReply');

    if (updateQuickReplyBtn) {
        updateQuickReplyBtn.addEventListener('click', updateQuickReply);
    }

    if (cancelEditQuickReplyBtn) {
        cancelEditQuickReplyBtn.addEventListener('click', closeEditModal);
    }
}

// 加载快捷回复
async function loadQuickReplies() {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/chat/quick-replies', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        const replies = await response.json();
        currentReplies = replies;
        
        // 只获取左侧快捷回复列表
        const quickReplyList = document.querySelector('.quick-reply-list.left-replies');
        
        if (!quickReplyList) {
            console.error('Left quick reply list not found');
            return;
        }
        
        // 只渲染左侧快捷回复列表
        renderQuickReplies(replies, quickReplyList);
    } catch (error) {
        console.error('Failed to load quick replies:', error);
        throw error;
    }
}

// 渲染快捷回复列表
function renderQuickReplies(replies, container) {
    if (!container) {
        console.error('Quick reply container not found');
        return;
    }
    
    container.innerHTML = '';
    replies.forEach(reply => {
        const div = document.createElement('div');
        div.className = 'quick-reply-item';
        div.dataset.id = reply._id;
        div.dataset.content = reply.content;
        div.innerHTML = `
            <span class="reply-content">${reply.content}</span>
            <svg class="edit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
        `;

        // 添加编辑图标点击事件
        const editIcon = div.querySelector('.edit-icon');
        if (editIcon) {
            editIcon.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止事件冒泡
                openEditModal(reply._id, reply.content);
            });
        }

        container.appendChild(div);
    });
}

// 处理快捷回复点击
function handleQuickReplyClick(e) {
    const item = e.target.closest('.quick-reply-item');
    if (!item) return;

    // 如果是删除模式，处理选择逻辑
    if (isDeleteMode) {
        item.classList.toggle('selected');
        const replyId = item.dataset.id;
        if (item.classList.contains('selected')) {
            selectedReplies.add(replyId);
        } else {
            selectedReplies.delete(replyId);
        }
        return;
    }

    // 检查是否是右侧快捷回复区（卡片消息）
    if (item.closest('.quick-reply-section.right')) {
        if (!cardSettings.productImage || !cardSettings.productName) {
            showNotification('상품 이미지와 상품명을 입력해주세요', 'error');
            openProductEditModal();
            return;
        }
        sendCardMessage();
        return;
    }

    // 普通文本消息处理
    const content = item.dataset.content;
    if (content && isConnected) {
        socket.emit('message', {
            content,
            type: 'text'
        });
    }
}

// 打开编辑模态框
function openEditModal(replyId, content) {
    const editModal = document.getElementById('editQuickReplyModal');
    const editContent = document.getElementById('editQuickReplyContent');
    
    if (!editModal || !editContent) {
        console.error('Edit modal elements not found');
        return;
    }

    currentEditingReplyId = replyId;
    editContent.value = content;
    editModal.style.display = 'flex';
}

// 更新快捷回复内容
async function updateQuickReply() {
    if (!currentEditingReplyId) return;

    const editContent = document.getElementById('editQuickReplyContent');
    const content = editContent.value.trim();
    
    if (!content) {
        showNotification('내용을 입력해주세요', 'error');
        return;
    }

    try {
        const token = localStorage.getItem('token');
        if (!token) {
            showNotification('인증이 필요합니다', 'error');
            return;
        }

        // 1. 先删除旧的记录
        const deleteResponse = await fetch(`/api/chat/quick-replies/${currentEditingReplyId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!deleteResponse.ok) {
            showNotification('수정 실패', 'error');
            return;
        }

        // 2. 创建新记录
        const createResponse = await fetch('/api/chat/quick-replies', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ content })
        });

        if (createResponse.ok) {
            await loadQuickReplies();
            closeEditModal();
            showNotification('수정되었습니다');
        } else {
            const data = await createResponse.json();
            showNotification(data.message || '수정 실패', 'error');
        }
    } catch (error) {
        console.error('Failed to update quick reply:', error);
        showNotification('수정 실패', 'error');
    }
}

// 关闭编辑模态框
function closeEditModal() {
    const editModal = document.getElementById('editQuickReplyModal');
    const editContent = document.getElementById('editQuickReplyContent');
    
    if (editModal) {
        editModal.style.display = 'none';
    }
    if (editContent) {
        editContent.value = '';
    }
    currentEditingReplyId = null;
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
        messageElement.className = `message ${message.sender === 'user' ? 'self' : 'other'}`;
    } else {
        messageElement.className = `message ${message.sender === 'admin' ? 'self' : 'other'}`;
    }

    const contentElement = document.createElement('div');

    // 尝试解析消息内容，检查是否是卡片消息
    try {
        const parsedContent = JSON.parse(message.content);
        if (parsedContent.type === 'card') {
            contentElement.className = 'message-content card-message';
            contentElement.innerHTML = `
                <div class="message-border"></div>
                <div class="message-main">
                    <div class="product-image">
                        <img src="${parsedContent.productImage}" alt="상품 이미지">
                    </div>
                    <div class="message-title">${parsedContent.productName}</div>
                    <div class="message-info">
                        <div class="info-item">${parsedContent.subtitle1}</div>
                        <div class="info-item">${parsedContent.subtitle2}</div>
                        <div class="info-item">${parsedContent.subtitle3}</div>
                    </div>
                    <a href="#" class="order-button">주문서 확인</a>
                    <div class="message-time">${parsedContent.time}</div>
                </div>
            `;
            messageElement.appendChild(contentElement);
        } else {
            throw new Error('Not a card message');
        }
    } catch (error) {
        // 如果解析失败或不是卡片消息，按普通消息处理
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
        
        // 只为非卡片消息添加时间戳
        const timeElement = document.createElement('div');
        timeElement.className = 'message-time';
        const messageDate = new Date(message.createdAt);
        timeElement.textContent = messageDate.toLocaleTimeString('ko-KR', {
            hour: 'numeric',
            minute: '2-digit'
        });
        messageElement.appendChild(contentElement);
        messageElement.appendChild(timeElement);
        messageContainer.appendChild(messageElement);
        return;
    }

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

// 添加右侧快捷回复
function addQuickReply(side) {
    if (side === 'right') {
        const rightRepliesList = document.querySelector('.quick-reply-list.right-replies');
        const newReply = document.createElement('div');
        newReply.className = 'quick-reply-item';
        newReply.dataset.content = '상품정보';
        newReply.innerHTML = `<span class="reply-content">상품정보</span>`;
        rightRepliesList.appendChild(newReply);
    }
}

// 编辑右侧快捷回复
function editQuickReply(side) {
    if (side === 'right') {
        // 暂时不需要实现编辑功能，因为右侧只有固定的商品信息卡片
        return;
    }
}

// 打开商品信息编辑模态框
async function openProductEditModal() {
    const modal = document.getElementById('editProductModal');
    if (!modal) {
        console.error('Product edit modal not found');
        return;
    }

    // 重置表单
    resetProductEditForm();

    try {
        // 从数据库获取商品信息
        const token = localStorage.getItem('token');
        const response = await fetch('/api/chat/product-info', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            const productInfo = await response.json();
            if (productInfo) {
                // 填充表单数据
                document.getElementById('productName').value = productInfo.productName || '';
                document.getElementById('subtitle1').value = productInfo.subtitle1 || '';
                document.getElementById('subtitle2').value = productInfo.subtitle2 || '';
                document.getElementById('subtitle3').value = productInfo.subtitle3 || '';

                const imagePreview = document.getElementById('productImagePreview');
                if (imagePreview && productInfo.productImage) {
                    imagePreview.src = productInfo.productImage;
                    imagePreview.style.display = 'block';
                }
            }
        }
    } catch (error) {
        console.error('Failed to load product info:', error);
        showNotification('상품 정보를 불러오지 못했습니다', 'error');
    }

    modal.style.display = 'flex';
}

// 重置商品编辑表单
function resetProductEditForm() {
    const form = document.querySelector('.product-edit-form');
    if (!form) return;

    // 重置所有输入字段
    form.querySelectorAll('input[type="text"]').forEach(input => {
        input.value = '';
    });
    
    // 重置图片预览
    const imagePreview = document.getElementById('productImagePreview');
    if (imagePreview) {
        imagePreview.src = '';
        imagePreview.style.display = 'none';
    }
}

// 保存商品信息
async function saveProductInfo() {
    const imagePreview = document.getElementById('productImagePreview');
    const productName = document.getElementById('productName').value.trim();
    const subtitle1 = document.getElementById('subtitle1').value.trim();
    const subtitle2 = document.getElementById('subtitle2').value.trim();
    const subtitle3 = document.getElementById('subtitle3').value.trim();
    
    if (!imagePreview.src || !productName) {
        showNotification('상품 이미지와 상품명을 입력해주세요', 'error');
        return;
    }

    try {
        const token = localStorage.getItem('token');
        if (!token) {
            showNotification('인증이 필요합니다', 'error');
            return;
        }

        // 验证token是否有效
        const verifyResponse = await fetch('/api/auth/verify', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        const verifyData = await verifyResponse.json();
        if (!verifyData.isValid) {
            localStorage.removeItem('token');
            showNotification('인증이 만료되었습니다', 'error');
            return;
        }

        // 直接保存新的商品信息
        const createResponse = await fetch('/api/chat/product-info', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                productImage: imagePreview.src,
                productName: productName,
                subtitle1: subtitle1,
                subtitle2: subtitle2,
                subtitle3: subtitle3,
                lastModified: new Date().toISOString()
            })
        });

        if (!createResponse.ok) {
            const errorData = await createResponse.json().catch(() => ({}));
            throw new Error(errorData.message || '상품 정보 저장 실패');
        }

        const savedData = await createResponse.json();

        // 更新本地状态
        cardSettings = {
            productImage: savedData.productImage,
            productName: savedData.productName,
            subtitle1: savedData.subtitle1,
            subtitle2: savedData.subtitle2,
            subtitle3: savedData.subtitle3,
            lastModified: savedData.lastModified
        };
        
        // 关闭模态框
        const editModal = document.getElementById('editProductModal');
        if (editModal) {
            editModal.style.display = 'none';
        }

        showNotification('상품 정보가 저장되었습니다');
    } catch (error) {
        console.error('Failed to save product info:', error);
        showNotification(error.message || '저장 실패', 'error');
    }
}

// 处理商品图片更改
async function handleProductImageChange() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    
    input.onchange = async function(e) {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const formData = new FormData();
            formData.append('image', file);

            const response = await fetch('/api/chat/upload', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            if (response.ok) {
                const imagePreview = document.getElementById('productImagePreview');
                if (imagePreview) {
                    imagePreview.src = data.imageUrl;
                    imagePreview.style.display = 'block';
                }
            } else {
                showNotification('이미지 업로드 실패', 'error');
            }
        } catch (error) {
            console.error('Failed to upload image:', error);
            showNotification('이미지 업로드 실패', 'error');
        }
    };

    input.click();
}

// 设置商品编辑相关事件监听
function setupProductEditEvents() {
    const editProductModal = document.getElementById('editProductModal');
    const changeProductImageBtn = document.getElementById('changeProductImage');
    const saveProductInfoBtn = document.getElementById('saveProductInfo');
    const cancelProductEditBtn = document.getElementById('cancelProductEdit');

    if (!editProductModal || !changeProductImageBtn || !saveProductInfoBtn || !cancelProductEditBtn) {
        console.error('Product edit modal elements not found');
        return;
    }

    // 图片更改按钮事件
    changeProductImageBtn.addEventListener('click', handleProductImageChange);

    // 保存按钮事件
    saveProductInfoBtn.addEventListener('click', saveProductInfo);

    // 取消按钮事件
    cancelProductEditBtn.addEventListener('click', () => {
        editProductModal.style.display = 'none';
    });
}

// 修改右侧快捷回复的渲染函数
function renderRightQuickReplies() {
    const rightRepliesList = document.querySelector('.quick-reply-list.right-replies');
    if (!rightRepliesList) return;
    
    rightRepliesList.innerHTML = `
        <div class="quick-reply-item" data-content="상품정보">
            <span class="reply-content">상품정보</span>
            <svg class="edit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
        </div>
    `;

    // 添加编辑图标点击事件
    const editIcon = rightRepliesList.querySelector('.edit-icon');
    if (editIcon) {
        editIcon.addEventListener('click', (e) => {
            e.stopPropagation(); // 阻止事件冒泡
            openProductEditModal();
        });
    }

    // 添加快捷回复项点击事件
    const quickReplyItem = rightRepliesList.querySelector('.quick-reply-item');
    if (quickReplyItem) {
        quickReplyItem.addEventListener('click', () => {
            if (!cardSettings.productImage || !cardSettings.productName) {
                showNotification('상품 이미지와 상품명을 입력해주세요', 'error');
                openProductEditModal();
                return;
            }
            sendCardMessage();
        });
    }
}

// 初始化
init(); 