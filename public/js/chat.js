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

        // 如果是管理员，加载快捷回复
        if (isAdmin) {
            try {
                await loadQuickReplies();
            } catch (error) {
                console.error('Failed to load quick replies:', error);
                showNotification('빠른 답장을 로드하지 못했습니다', 'error');
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
    
    if (addQuickReplyModal) {
        addQuickReplyModal.addEventListener('click', (e) => {
            if (e.target === addQuickReplyModal) {
                addQuickReplyModal.style.display = 'none';
                const quickReplyContent = document.getElementById('quickReplyContent');
                if (quickReplyContent) {
                    quickReplyContent.value = '';
                }
            }
        });
    }

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
    
    if (editModal) {
        editModal.addEventListener('click', (e) => {
            if (e.target === editModal) {
                closeEditModal();
            }
        });
    }

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

    // 如果点击的是编辑图标
    if (e.target.closest('.edit-icon')) {
        openEditModal(item.dataset.id, item.dataset.content);
        return;
    }

    // 点击内容区域发送消息
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
        const response = await fetch(`/api/chat/quick-replies/${currentEditingReplyId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ content })
        });

        if (response.ok) {
            await loadQuickReplies();
            closeEditModal();
            showNotification('수정되었습니다');
        } else {
            const data = await response.json();
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