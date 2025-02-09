// 全局变量
let token = localStorage.getItem('token');
let isDeleteMode = false;
let adminPassword = ''; // 添加管理员密码存储
let roomToDelete = null; // 存储待删除的房间ID
let roomToDeleteName = ''; // 存储待删除的房间名称

// 页面元素
const loginPage = document.getElementById('loginPage');
const adminPage = document.getElementById('adminPage');
const loginForm = document.getElementById('loginForm');
const createRoomForm = document.getElementById('createRoomForm');
const roomsList = document.getElementById('roomsList');
const changeCredentialsBtn = document.getElementById('changeCredentialsBtn');
const changeCredentialsModal = document.getElementById('changeCredentialsModal');
const changeCredentialsForm = document.getElementById('changeCredentialsForm');
const deleteConfirmModal = document.getElementById('deleteConfirmModal');
const confirmDeleteBtn = document.getElementById('confirmDelete');
const cancelDeleteBtn = document.getElementById('cancelDelete');
const deleteRoomNameSpan = document.getElementById('deleteRoomName');

// 获取重定向URL
const urlParams = new URLSearchParams(window.location.search);
const redirectUrl = urlParams.get('redirect');

// 安全日志相关
const securityLogsBtn = document.getElementById('securityLogsBtn');
const securityLogsModal = document.getElementById('securityLogsModal');
const closeSecurityLogsBtn = document.getElementById('closeSecurityLogs');
const logTypeFilter = document.getElementById('logTypeFilter');
const refreshLogsBtn = document.getElementById('refreshLogs');
const securityLogsContainer = document.getElementById('securityLogs');
const bannedIPsContainer = document.getElementById('bannedIPs');

// 检查登录状态
async function checkAuth() {
    if (!token) {
        showLoginPage();
        return;
    }

    try {
        const response = await fetch('/api/auth/verify', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        const data = await response.json();

        if (data.isValid) {
            if (redirectUrl) {
                window.location.href = redirectUrl;
                return;
            }
            showAdminPage();
            loadRooms();
        } else {
            localStorage.removeItem('token');
            showLoginPage();
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        localStorage.removeItem('token');
        showLoginPage();
    }
}

// 登录处理
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitButton = loginForm.querySelector('button[type="submit"]');
    const originalText = submitButton.textContent;
    
    // 禁用按钮，显示加载状态
    submitButton.disabled = true;
    submitButton.textContent = '로그인 중...';

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        let data;
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            data = await response.json();
        } else {
            // 如果不是 JSON 响应，获取文本
            const text = await response.text();
            throw new Error(text);
        }

        if (response.ok) {
            token = data.token;
            adminPassword = password; // 保存管理员密码
            localStorage.setItem('token', token);
            localStorage.setItem('adminPassword', password); // 保存到localStorage
            document.cookie = `token=${token}; path=/; max-age=86400`;
            
            if (redirectUrl) {
                window.location.href = redirectUrl;
                return;
            }
            showAdminPage();
            loadRooms();
        } else {
            showNotification(data.message || '로그인 실패', 'error');
        }
    } catch (error) {
        console.error('Login failed:', error);
        // 处理速率限制错误
        if (error.message.includes('请求过于频繁')) {
            showNotification('로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요', 'error');
        } else {
            showNotification('로그인 실패, 다시 시도해주세요', 'error');
        }
    } finally {
        // 恢复按钮状态
        submitButton.disabled = false;
        submitButton.textContent = originalText;
    }
});

// 创建聊天室
createRoomForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitButton = createRoomForm.querySelector('button[type="submit"]');
    const originalText = submitButton.textContent;
    const nameInput = document.getElementById('roomName');
    const roomIdInput = document.getElementById('roomId');
    const name = nameInput.value.trim();
    const roomId = roomIdInput.value.trim();

    // 输入验证
    if (name.length < 2 || name.length > 50) {
        showNotification('채팅방 이름은 2~50자 사이여야 합니다', 'error');
        return;
    }

    if (!roomId.match(/^[a-zA-Z0-9]{3,7}$/)) {
        showNotification('채팅방 ID는 3-7자리의 영문/숫자만 가능합니다', 'error');
        return;
    }

    // 禁用按钮，显示加载状态
    submitButton.disabled = true;
    submitButton.textContent = '생성 중...';
    
    try {
        const response = await fetch('/api/chat/rooms', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ name, roomId })
        });

        let data;
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            data = await response.json();
        } else {
            const text = await response.text();
            throw new Error(text);
        }

        if (response.ok) {
            showNotification(`채팅방 "${name}"이(가) 생성되었습니다`);
            loadRooms();
            createRoomForm.reset();
            nameInput.focus();
        } else {
            showNotification(data.message || '생성 실패', 'error');
        }
    } catch (error) {
        console.error('Create room failed:', error);
        showNotification('생성 실패, 다시 시도해주세요', 'error');
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = originalText;
    }
});

// 加载聊天室列表
async function loadRooms() {
    try {
        const response = await fetch('/api/chat/rooms', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        const rooms = await response.json();
        
        roomsList.innerHTML = rooms.map(room => `
            <div class="room-item" data-room-id="${room._id}">
                <div class="room-info">
                    <h4>${room.name}</h4>
                    <p class="room-id">ID: ${room.roomId}</p>
                    <p class="online-count">접속자 수: ${room.onlineCount}명</p>
                </div>
                <div class="room-actions">
                    <button onclick="copyRoomLink('${room.roomId}', 'admin')" class="copy-admin-link">관리자 링크</button>
                    <button onclick="copyRoomLink('${room.roomId}', 'user')" class="copy-user-link">사용자 링크</button>
                    <button onclick="deleteRoom('${room._id}')" class="delete-room">삭제</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Load rooms failed:', error);
        showNotification('채팅방 목록을 불러오지 못했습니다', 'error');
    }
}

// 添加事件委托处理器
roomsList.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button) return;

    if (button.classList.contains('copy-link')) {
        const roomId = button.dataset.roomId;
        const type = button.dataset.type;
        copyRoomLink(roomId, type);
    } else if (button.classList.contains('delete-room')) {
        const roomId = button.dataset.roomId;
        deleteRoom(roomId);
    }
});

// 复制聊天室链接
async function copyRoomLink(roomId, type) {
    const button = event.target;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = '복사중...';

    const baseUrl = window.location.origin;
    const storedPassword = localStorage.getItem('adminPassword');
    const link = type === 'admin' 
        ? `${baseUrl}/${storedPassword}/${roomId}`
        : `${baseUrl}/${roomId}`;

    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(link);
            button.textContent = '복사됨!';
            showNotification('링크가 복사되었습니다');
        } else {
            // 回退方案：创建临时输入框
            const textArea = document.createElement('textarea');
            textArea.value = link;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            
            try {
                const successful = document.execCommand('copy');
                if (successful) {
                    button.textContent = '복사됨!';
                    showNotification('링크가 복사되었습니다');
                } else {
                    throw new Error('복사 실패');
                }
            } catch (err) {
                console.error('Failed to copy text:', err);
                button.textContent = '복사 실패';
                showNotification('복사 실패, 수동으로 복사해주세요', 'error');
            } finally {
                textArea.remove();
            }
        }
    } catch (err) {
        console.error('Failed to copy text:', err);
        button.textContent = '복사 실패';
        showNotification('복사 실패, 수동으로 복사해주세요', 'error');
    } finally {
        setTimeout(() => {
            button.disabled = false;
            button.textContent = originalText;
        }, 1500);
    }
}

// 删除聊天室
function deleteRoom(roomId) {
    const roomElement = document.querySelector(`[data-room-id="${roomId}"]`);
    if (!roomElement) {
        console.error('Room element not found');
        showNotification('채팅방을 찾을 수 없습니다', 'error');
        return;
    }
    
    const roomItemElement = roomElement.closest('.room-item');
    if (!roomItemElement) {
        console.error('Room item element not found');
        showNotification('채팅방 정보를 찾을 수 없습니다', 'error');
        return;
    }
    
    const roomNameElement = roomItemElement.querySelector('h4');
    if (!roomNameElement) {
        console.error('Room name element not found');
        showNotification('채팅방 이름을 찾을 수 없습니다', 'error');
        return;
    }
    
    roomToDelete = roomId;
    roomToDeleteName = roomNameElement.textContent;
    
    deleteRoomNameSpan.textContent = roomToDeleteName;
    deleteConfirmModal.classList.remove('hidden');
    confirmDeleteBtn.focus();
}

// 确认删除聊天室
async function confirmDeleteRoom() {
    if (!roomToDelete) return;

    const originalText = confirmDeleteBtn.textContent;
    confirmDeleteBtn.disabled = true;
    confirmDeleteBtn.textContent = '삭제 중...';

    try {
        const response = await fetch(`/api/chat/rooms/${roomToDelete}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        let data;
        try {
            data = await response.json();
        } catch (e) {
            // 如果响应不是 JSON 格式，使用默认消息
            data = { message: '삭제 실패' };
        }

        if (response.ok) {
            showNotification(`채팅방 "${roomToDeleteName}"이(가) 삭제되었습니다`);
            loadRooms();
        } else {
            showNotification(data.message || '삭제 실패', 'error');
        }
    } catch (error) {
        console.error('Delete room failed:', error);
        showNotification('삭제 실패, 다시 시도해주세요', 'error');
    } finally {
        confirmDeleteBtn.disabled = false;
        confirmDeleteBtn.textContent = originalText;
        closeDeleteModal();
    }
}

// 关闭删除模态框
function closeDeleteModal() {
    deleteConfirmModal.classList.add('hidden');
    roomToDelete = null;
    roomToDeleteName = '';
}

// 取消删除聊天室
function cancelDeleteRoom() {
    closeDeleteModal();
}

// 添加删除确认相关的事件监听器
confirmDeleteBtn.addEventListener('click', confirmDeleteRoom);
cancelDeleteBtn.addEventListener('click', cancelDeleteRoom);

// 添加键盘事件支持
document.addEventListener('keydown', (e) => {
    if (!deleteConfirmModal.classList.contains('hidden')) {
        if (e.key === 'Escape') {
            cancelDeleteRoom();
        } else if (e.key === 'Enter' && !confirmDeleteBtn.disabled) {
            confirmDeleteRoom();
        }
    }
});

// 点击模态框背景关闭
deleteConfirmModal.addEventListener('click', (e) => {
    if (e.target === deleteConfirmModal) {
        cancelDeleteRoom();
    }
});

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

// 页面切换
function showLoginPage() {
    loginPage.classList.remove('hidden');
    adminPage.classList.add('hidden');
}

function showAdminPage() {
    loginPage.classList.add('hidden');
    adminPage.classList.remove('hidden');
}

// 修改账号密码相关事件监听
changeCredentialsBtn.addEventListener('click', () => {
    changeCredentialsModal.classList.remove('hidden');
});

changeCredentialsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPassword = document.getElementById('currentPassword').value;
    const newUsername = document.getElementById('newUsername').value;
    const newPassword = document.getElementById('newPassword').value;

    try {
        const response = await fetch('/api/auth/change-credentials', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                currentPassword,
                newUsername,
                newPassword
            })
        });

        const data = await response.json();

        if (response.ok) {
            showNotification('계정 정보가 변경되었습니다. 새로운 비밀번호로 다시 로그인해주세요.');
            changeCredentialsModal.classList.add('hidden');
            changeCredentialsForm.reset();
            // 修改成功后退出登录
            localStorage.removeItem('token');
            token = null;
            showLoginPage();
        } else {
            showNotification(data.message || '변경 실패', 'error');
        }
    } catch (error) {
        console.error('Change credentials failed:', error);
        showNotification('변경 실패, 다시 시도해주세요', 'error');
    }
});

// 取消修改账号密码
document.getElementById('cancelCredentialsBtn').addEventListener('click', () => {
    document.getElementById('changeCredentialsModal').classList.add('hidden');
});

// 加载安全日志
async function loadSecurityLogs() {
    try {
        const type = logTypeFilter.value;
        const response = await fetch(`/api/auth/security-logs?type=${type}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        const data = await response.json();
        
        securityLogsContainer.innerHTML = data.logs.map(log => `
            <div class="log-entry ${getLogClass(log.message)}">
                <span class="timestamp">${formatDate(log.timestamp)}</span>
                <span class="message">${log.message}</span>
            </div>
        `).join('');
    } catch (error) {
        console.error('Load security logs failed:', error);
        showNotification('보안 로그를 불러올 수 없습니다', 'error');
    }
}

// 加载被封禁的IP
async function loadBannedIPs() {
    try {
        const response = await fetch('/api/auth/banned-ips', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (!data || !data.bannedIPs) {
            throw new Error('Invalid response format');
        }
        
        bannedIPsContainer.innerHTML = data.bannedIPs.length > 0 
            ? data.bannedIPs.map(ban => `
                <div class="banned-ip">
                    <span class="ip">${ban.ip}</span>
                    <span class="expiry">${formatDate(new Date(ban.expiry))}</span>
                </div>
            `).join('')
            : '<p>차단된 IP가 없습니다</p>';
    } catch (error) {
        console.error('Load banned IPs failed:', error);
        showNotification('차단된 IP 목록을 불러올 수 없습니다', 'error');
        bannedIPsContainer.innerHTML = '<p class="error">차단된 IP 목록을 불러오지 못했습니다.</p>';
    }
}

// 获取日志条目的CSS类
function getLogClass(message) {
    if (message.includes('Blocked malicious') || message.includes('Blocked banned')) {
        return 'blocked';
    }
    if (message.includes('IP banned')) {
        return 'banned';
    }
    return '';
}

// 格式化日期
function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// 事件监听
securityLogsBtn.addEventListener('click', () => {
    securityLogsModal.classList.remove('hidden');
    loadSecurityLogs();
    loadBannedIPs();
});

closeSecurityLogsBtn.addEventListener('click', () => {
    securityLogsModal.classList.add('hidden');
});

logTypeFilter.addEventListener('change', loadSecurityLogs);

refreshLogsBtn.addEventListener('click', () => {
    loadSecurityLogs();
    loadBannedIPs();
});

// 点击模态框背景关闭
securityLogsModal.addEventListener('click', (e) => {
    if (e.target === securityLogsModal) {
        securityLogsModal.classList.add('hidden');
    }
});

// 初始化
checkAuth(); 
checkAuth(); 