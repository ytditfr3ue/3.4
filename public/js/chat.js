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
const quickReplyList = document.querySelector('.quick-reply-list');
const rightQuickReplyList = document.querySelector('.quick-reply-list.right-replies');
const addQuickReplyModal = document.getElementById('addQuickReplyModal');
const quickReplyContent = document.getElementById('quickReplyContent');
const saveQuickReplyBtn = document.getElementById('saveQuickReply');
const cancelQuickReplyBtn = document.getElementById('cancelQuickReply');
const deleteQuickReplyBtn = document.getElementById('deleteQuickReply');
const addQuickReplyBtn = document.getElementById('addQuickReply');
const editQuickReplyModal = document.getElementById('editQuickReplyModal');
const editQuickReplyContent = document.getElementById('editQuickReplyContent');
const saveEditQuickReplyBtn = document.getElementById('saveEditQuickReply');
const cancelEditQuickReplyBtn = document.getElementById('cancelEditQuickReply');

let socket = null;
let isConnected = false;
let leftReplies = [];
let rightReplies = [];
let onlineCount = 0;
let isDeleteMode = false;
let selectedReplies = new Set();
let currentEditingSide = null;
let currentEditingReply = null;
let currentReplies = [];

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

        // 验证管理员身份
        if (isAdmin) {
            const token = localStorage.getItem('token');
            if (!token) {
                showNotification('관리자 인증이 필요합니다', 'error');
                window.location.href = '/';
                return;
            }
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
            setupQuickReplyEvents();
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

// 设置快捷回复相关事件监听
function setupQuickReplyEvents() {
    if (!isAdmin) return;

    const quickReplySection = document.querySelector('.quick-reply-section.left');
    const addQuickReplyBtn = quickReplySection?.querySelector('button:first-child');
    const editQuickReplyBtn = quickReplySection?.querySelector('button:last-child');
    const quickReplyList = quickReplySection?.querySelector('.quick-reply-list');
    
    // 添加按钮事件
    addQuickReplyBtn?.addEventListener('click', () => {
        if (isDeleteMode) {
            exitDeleteMode();
            return;
        }
        const addQuickReplyModal = document.getElementById('addQuickReplyModal');
        if (addQuickReplyModal) {
            addQuickReplyModal.style.display = 'flex';
        }
    });

    // 编辑按钮事件
    editQuickReplyBtn?.addEventListener('click', () => {
        if (!isDeleteMode) {
            enterDeleteMode();
        } else {
            deleteSelectedReplies();
        }
    });

    // 快速回复列表点击事件
    quickReplyList?.addEventListener('click', handleQuickReplyClick);
}

// 处理快捷回复点击
function handleQuickReplyClick(e) {
    const replyItem = e.target.closest('.quick-reply-item');
    if (!replyItem) return;

    if (isDeleteMode) {
        replyItem.classList.toggle('selected');
    } else {
        const content = replyItem.dataset.content;
        if (content && isConnected) {
            socket.emit('message', {
                content,
                type: 'text'
            });
        }
    }
}

// 进入删除模式
function enterDeleteMode() {
    isDeleteMode = true;
    const editBtn = document.querySelector('.quick-reply-section.left button:last-child');
    if (editBtn) {
        editBtn.textContent = '确认';
        editBtn.style.background = '#dc3545';
    }
}

// 退出删除模式
function exitDeleteMode() {
    isDeleteMode = false;
    const editBtn = document.querySelector('.quick-reply-section.left button:last-child');
    if (editBtn) {
        editBtn.textContent = '编辑';
        editBtn.style.background = '#007bff';
    }
    document.querySelectorAll('.quick-reply-item.selected').forEach(item => {
        item.classList.remove('selected');
    });
}

// 删除选中的快捷回复
async function deleteSelectedReplies() {
    const selectedItems = document.querySelectorAll('.quick-reply-item.selected');
    if (selectedItems.length === 0) {
        exitDeleteMode();
        return;
    }

    try {
        const token = localStorage.getItem('token');
        if (!token) {
            showNotification('인증이 필요합니다', 'error');
            return;
        }

        const selectedIds = Array.from(selectedItems).map(item => item.dataset.id);
        const response = await fetch('/api/chat/quick-replies/batch-delete', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ ids: selectedIds })
        });

        if (!response.ok) {
            throw new Error('삭제 실패');
        }

        // 从当前列表中移除已删除的项目
        currentReplies = currentReplies.filter(reply => !selectedIds.includes(reply._id));
        const quickReplyList = document.querySelector('.quick-reply-list.left-replies');
        renderQuickReplies(currentReplies, quickReplyList);
        
        showNotification('삭제되었습니다');
    } catch (error) {
        console.error('Failed to delete quick replies:', error);
        showNotification(error.message || '삭제 실패', 'error');
    } finally {
        exitDeleteMode();
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
        const quickReplyList = document.querySelector('.quick-reply-list.left-replies');
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
        div.innerHTML = `<span class="reply-content">${reply.content}</span>`;
        container.appendChild(div);
    });
}

// 保存新的快捷回复
async function saveQuickReply() {
    const content = document.getElementById('quickReplyContent')?.value.trim();
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

        const response = await fetch('/api/chat/quick-replies', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ content })
        });

        if (!response.ok) {
            throw new Error('저장 실패');
        }

        const newReply = await response.json();
        currentReplies.unshift(newReply);
        const quickReplyList = document.querySelector('.quick-reply-list.left-replies');
        renderQuickReplies(currentReplies, quickReplyList);

        // 关闭模态框并清空输入
        const modal = document.getElementById('addQuickReplyModal');
        if (modal) {
            modal.style.display = 'none';
        }
        const input = document.getElementById('quickReplyContent');
        if (input) {
            input.value = '';
        }

        showNotification('저장되었습니다');
    } catch (error) {
        console.error('Failed to save quick reply:', error);
        showNotification(error.message || '저장 실패', 'error');
    }
}

// 设置初始事件监听
document.addEventListener('DOMContentLoaded', () => {
    // 设置快捷回复相关事件
    setupQuickReplyEvents();

    // 设置保存按钮事件
    const saveBtn = document.getElementById('saveQuickReply');
    saveBtn?.addEventListener('click', saveQuickReply);

    // 设置取消按钮事件
    const cancelBtn = document.getElementById('cancelQuickReply');
    cancelBtn?.addEventListener('click', () => {
        const modal = document.getElementById('addQuickReplyModal');
        const input = document.getElementById('quickReplyContent');
        if (modal) {
            modal.style.display = 'none';
        }
        if (input) {
            input.value = '';
        }
    });

    // 设置模态框点击外部关闭
    const modal = document.getElementById('addQuickReplyModal');
    modal?.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
            const input = document.getElementById('quickReplyContent');
            if (input) {
                input.value = '';
            }
        }
    });
});

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

// 显示编辑快捷回复模态框
function showEditQuickReplyModal(reply) {
    if (!reply || (!reply._id && !reply.id)) {
        console.error('Invalid reply object:', reply);
        return;
    }

    currentEditingReply = reply;
    editQuickReplyContent.value = reply.content;
    
    // 重置模态框样式
    const modalContent = editQuickReplyModal.querySelector('.modal-content');
    modalContent.style.transform = 'scale(1)';
    modalContent.style.opacity = '1';
    
    // 显示模态框
    editQuickReplyModal.style.display = 'flex';
    editQuickReplyModal.style.opacity = '1';
    editQuickReplyContent.focus();
}

// 关闭编辑模态框
function closeEditModal() {
    const modalContent = editQuickReplyModal.querySelector('.modal-content');
    modalContent.style.transform = 'scale(0.95)';
    editQuickReplyModal.style.opacity = '0';
    
    setTimeout(() => {
        editQuickReplyModal.style.display = 'none';
        currentEditingReply = null;
        editQuickReplyContent.value = '';
    }, 200);
}

// 设置模态框事件监听
document.addEventListener('DOMContentLoaded', () => {
    // 点击模态框外部关闭
    editQuickReplyModal.addEventListener('click', (e) => {
        if (e.target === editQuickReplyModal) {
            closeEditModal();
        }
    });

    // 取消按钮关闭
    const cancelEditBtn = document.getElementById('cancelEditQuickReply');
    if (cancelEditBtn) {
        cancelEditBtn.addEventListener('click', closeEditModal);
    }

    // 保存按钮事件
    const saveEditBtn = document.getElementById('saveEditQuickReply');
    if (saveEditBtn) {
        saveEditBtn.addEventListener('click', async () => {
            await saveEditQuickReply();
            closeEditModal();
        });
    }
});

// 保存编辑后的快捷回复
async function saveEditQuickReply() {
    if (!currentEditingReply || (!currentEditingReply._id && !currentEditingReply.id)) {
        showNotification('编辑失败：无效的快捷回复', 'error');
        return;
    }
    
    const content = editQuickReplyContent.value.trim();
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

        const replyId = currentEditingReply._id || currentEditingReply.id;
        const response = await fetch(`/api/chat/quick-replies/${replyId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ content })
        });
        
        if (!response.ok) {
            throw new Error('수정 실패');
        }
        
        const updatedReply = await response.json();
        
        // 更新本地数据
        const index = currentReplies.findIndex(reply => (reply._id || reply.id) === replyId);
        if (index !== -1) {
            currentReplies[index] = updatedReply;
            const quickReplyList = document.querySelector('.quick-reply-list.left-replies');
            renderQuickReplies(currentReplies, quickReplyList);
        }
        
        showNotification('수정되었습니다');
    } catch (error) {
        console.error('빠른 답장 수정 실패:', error);
        showNotification('수정 실패', 'error');
    }
}

// 初始化
init(); 