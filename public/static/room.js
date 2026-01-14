// Room page JavaScript
(function() {
    'use strict';
    
    const roomId = window.ROOM_ID;
    let pollInterval;
    let hasPassword = false;
    let isVerified = false;
    
    // Drawing variables
    let canvas, ctx;
    let isDrawing = false;
    let lastX = 0, lastY = 0;
    let drawColor = 'black';
    let drawWidth = 5;
    let paths = [];

    // Initialize
    async function init() {
        try {
            const response = await axios.get('/api/rooms/' + roomId);
            document.getElementById('roomName').textContent = response.data.name || '칠판';
            hasPassword = response.data.has_password;
            
            if (!response.data.is_active) {
                alert('이 방은 더 이상 사용할 수 없습니다.');
                window.location.href = '/';
                return;
            }
            
            if (hasPassword) {
                document.getElementById('passwordModal').classList.add('active');
            } else {
                isVerified = true;
                startApp();
            }
        } catch (error) {
            alert('방을 찾을 수 없습니다.');
            window.location.href = '/';
        }
    }

    async function verifyPassword() {
        const password = document.getElementById('passwordInput').value;
        try {
            const response = await axios.post('/api/rooms/' + roomId + '/verify', { password });
            if (response.data.valid) {
                isVerified = true;
                document.getElementById('passwordModal').classList.remove('active');
                startApp();
            } else {
                alert('비밀번호가 올바르지 않습니다.');
            }
        } catch (error) {
            alert('인증에 실패했습니다.');
        }
    }

    function startApp() {
        initCanvas();
        loadBoard();
        loadChat();
        loadDrawing();
        
        // Poll for updates every 3 seconds
        pollInterval = setInterval(() => {
            loadBoard();
            loadChat();
        }, 3000);
    }

    // Canvas initialization
    function initCanvas() {
        canvas = document.getElementById('drawingCanvas');
        if (!canvas) return;
        
        ctx = canvas.getContext('2d');
        
        // Mouse events
        canvas.addEventListener('mousedown', startDrawing);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', stopDrawing);
        canvas.addEventListener('mouseout', stopDrawing);
        
        // Touch events
        canvas.addEventListener('touchstart', handleTouchStart);
        canvas.addEventListener('touchmove', handleTouchMove);
        canvas.addEventListener('touchend', stopDrawing);
    }

    function startDrawing(e) {
        isDrawing = true;
        const rect = canvas.getBoundingClientRect();
        lastX = e.clientX - rect.left;
        lastY = e.clientY - rect.top;
    }

    function draw(e) {
        if (!isDrawing) return;
        
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        ctx.strokeStyle = drawColor;
        ctx.lineWidth = drawWidth;
        ctx.lineCap = 'round';
        
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(x, y);
        ctx.stroke();
        
        paths.push({ x1: lastX, y1: lastY, x2: x, y2: y, color: drawColor, width: drawWidth });
        
        lastX = x;
        lastY = y;
    }

    function stopDrawing() {
        isDrawing = false;
    }

    function handleTouchStart(e) {
        e.preventDefault();
        const touch = e.touches[0];
        const rect = canvas.getBoundingClientRect();
        isDrawing = true;
        lastX = touch.clientX - rect.left;
        lastY = touch.clientY - rect.top;
    }

    function handleTouchMove(e) {
        e.preventDefault();
        if (!isDrawing) return;
        
        const touch = e.touches[0];
        const rect = canvas.getBoundingClientRect();
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        
        ctx.strokeStyle = drawColor;
        ctx.lineWidth = drawWidth;
        ctx.lineCap = 'round';
        
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(x, y);
        ctx.stroke();
        
        paths.push({ x1: lastX, y1: lastY, x2: x, y2: y, color: drawColor, width: drawWidth });
        
        lastX = x;
        lastY = y;
    }

    function setDrawColor(color) {
        drawColor = color;
    }

    function setDrawWidth(width) {
        drawWidth = parseInt(width);
    }

    function clearCanvas() {
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        paths = [];
    }

    async function saveDrawing() {
        if (paths.length === 0) {
            alert('그릴 내용이 없습니다.');
            return;
        }
        
        try {
            const drawingData = JSON.stringify(paths);
            await axios.post('/api/rooms/' + roomId + '/drawings', {
                drawing_data: drawingData,
                author_name: '강의자'
            });
            
            alert('그림이 저장되었습니다!');
            loadBoard();
        } catch (error) {
            alert('저장 실패. 다시 시도해주세요.');
            console.error(error);
        }
    }

    async function loadDrawing() {
        if (!ctx) return;
        
        try {
            const response = await axios.get('/api/rooms/' + roomId + '/drawings');
            const drawings = response.data.drawings || [];
            
            if (drawings.length > 0) {
                const latestDrawing = drawings[0];
                const loadedPaths = JSON.parse(latestDrawing.drawing_data);
                
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                
                loadedPaths.forEach(path => {
                    ctx.strokeStyle = path.color;
                    ctx.lineWidth = path.width;
                    ctx.lineCap = 'round';
                    ctx.beginPath();
                    ctx.moveTo(path.x1, path.y1);
                    ctx.lineTo(path.x2, path.y2);
                    ctx.stroke();
                });
                
                paths = loadedPaths;
            }
        } catch (error) {
            console.error('Failed to load drawing:', error);
        }
    }

    // Tab switching
    function switchTab(tab) {
        document.querySelectorAll('.tabs').forEach(btn => btn.classList.remove('active'));
        document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');
        
        document.getElementById('textInput').classList.toggle('hidden', tab !== 'text');
        document.getElementById('imageInput').classList.toggle('hidden', tab !== 'image');
        document.getElementById('drawInput').classList.toggle('hidden', tab !== 'draw');
    }

    // Load board items
    async function loadBoard() {
        if (!isVerified) return;
        
        try {
            const response = await axios.get('/api/rooms/' + roomId + '/board');
            const items = response.data.items || [];
            
            const boardDiv = document.getElementById('boardItems');
            if (items.length === 0) {
                boardDiv.innerHTML = '<div class="text-center text-gray-400 py-8 text-sm">아직 추가된 내용이 없습니다</div>';
                return;
            }
            
            boardDiv.innerHTML = items.map(item => {
                const isUrl = item.type === 'url' || isValidUrl(item.content);
                const time = new Date(item.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
                
                if (item.type === 'image' && item.image_url) {
                    return `
                        <div class="board-item bg-purple-50 border-l-4 border-purple-500 p-3 sm:p-4 rounded-r-lg relative">
                            <div class="flex items-start gap-2 mb-2">
                                <i class="fas fa-image text-purple-600 mt-1"></i>
                                <div class="flex-1">
                                    <img src="${item.image_url}" alt="Uploaded" class="max-w-full h-auto rounded-lg shadow-md">
                                    <p class="text-sm text-gray-600 mt-2">${escapeHtml(item.content)}</p>
                                </div>
                                <button onclick="deleteItem(${item.id})" class="text-red-500 hover:text-red-700">
                                    <i class="fas fa-times"></i>
                                </button>
                            </div>
                            <div class="text-xs text-gray-500 pl-6">
                                ${item.author_name} · ${time}
                            </div>
                        </div>
                    `;
                } else if (item.type === 'drawing') {
                    return `
                        <div class="board-item bg-pink-50 border-l-4 border-pink-500 p-3 sm:p-4 rounded-r-lg relative">
                            <div class="flex items-start gap-2 mb-2">
                                <i class="fas fa-paint-brush text-pink-600 mt-1"></i>
                                <div class="flex-1">
                                    <p class="text-sm font-medium text-gray-700">저장된 그림</p>
                                    <p class="text-xs text-gray-500 mt-1">그림 탭에서 확인하세요</p>
                                </div>
                                <button onclick="deleteItem(${item.id})" class="text-red-500 hover:text-red-700">
                                    <i class="fas fa-times"></i>
                                </button>
                            </div>
                            <div class="text-xs text-gray-500 pl-6">
                                ${item.author_name} · ${time}
                            </div>
                        </div>
                    `;
                } else if (isUrl) {
                    return `
                        <div class="board-item bg-blue-50 border-l-4 border-blue-500 p-3 sm:p-4 rounded-r-lg relative">
                            <div class="flex items-start gap-2 mb-2">
                                <i class="fas fa-link text-blue-600 mt-1"></i>
                                <a href="${item.content}" target="_blank" class="url-link flex-1 text-blue-600 hover:text-blue-800 underline font-medium text-sm sm:text-base break-all">
                                    ${item.content}
                                </a>
                                <button onclick="deleteItem(${item.id})" class="text-red-500 hover:text-red-700">
                                    <i class="fas fa-times"></i>
                                </button>
                            </div>
                            <div class="text-xs text-gray-500 pl-6">
                                ${item.author_name} · ${time}
                            </div>
                        </div>
                    `;
                } else {
                    return `
                        <div class="board-item bg-yellow-50 border-l-4 border-yellow-500 p-3 sm:p-4 rounded-r-lg relative">
                            <div class="flex items-start gap-2 mb-2">
                                <i class="fas fa-sticky-note text-yellow-600 mt-1"></i>
                                <p class="flex-1 text-gray-800 text-sm sm:text-base whitespace-pre-wrap break-words">${escapeHtml(item.content)}</p>
                                <button onclick="deleteItem(${item.id})" class="text-red-500 hover:text-red-700">
                                    <i class="fas fa-times"></i>
                                </button>
                            </div>
                            <div class="text-xs text-gray-500 pl-6">
                                ${item.author_name} · ${time}
                            </div>
                        </div>
                    `;
                }
            }).join('');
        } catch (error) {
            console.error('Failed to load board:', error);
        }
    }

    // Load chat messages
    async function loadChat() {
        if (!isVerified) return;
        
        try {
            const response = await axios.get('/api/rooms/' + roomId + '/chat');
            const messages = response.data.messages || [];
            
            const chatDiv = document.getElementById('chatMessages');
            const wasAtBottom = chatDiv.scrollHeight - chatDiv.scrollTop - chatDiv.clientHeight < 50;
            
            if (messages.length === 0) {
                chatDiv.innerHTML = '<div class="text-center text-gray-400 py-4 text-xs sm:text-sm">아직 메시지가 없습니다</div>';
                return;
            }
            
            chatDiv.innerHTML = messages.map(msg => {
                const time = new Date(msg.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
                return `
                    <div class="bg-white rounded-lg p-2 sm:p-3 shadow-sm">
                        <div class="flex items-baseline gap-2 mb-1">
                            <span class="font-semibold text-blue-600 text-xs sm:text-sm">${escapeHtml(msg.author_name)}</span>
                            <span class="text-xs text-gray-400">${time}</span>
                        </div>
                        <p class="text-gray-800 text-sm sm:text-base break-words">${escapeHtml(msg.message)}</p>
                    </div>
                `;
            }).join('');
            
            if (wasAtBottom) {
                chatDiv.scrollTop = chatDiv.scrollHeight;
            }
        } catch (error) {
            console.error('Failed to load chat:', error);
        }
    }

    // Add board item
    async function addBoardItem() {
        const input = document.getElementById('boardInput');
        const content = input.value.trim();
        
        if (!content) return;
        
        try {
            const type = isValidUrl(content) ? 'url' : 'text';
            await axios.post('/api/rooms/' + roomId + '/board', {
                type: type,
                content: content,
                author_name: '강의자'
            });
            
            input.value = '';
            loadBoard();
        } catch (error) {
            alert('추가 실패. 다시 시도해주세요.');
            console.error(error);
        }
    }

    // Upload image
    async function uploadImage() {
        const fileInput = document.getElementById('imageFile');
        const file = fileInput.files[0];
        
        if (!file) {
            alert('이미지를 선택해주세요.');
            return;
        }
        
        const formData = new FormData();
        formData.append('image', file);
        
        try {
            const uploadResponse = await axios.post('/api/rooms/' + roomId + '/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            
            const imageUrl = uploadResponse.data.image_url;
            
            await axios.post('/api/rooms/' + roomId + '/board', {
                type: 'image',
                content: file.name,
                author_name: '강의자',
                image_url: imageUrl
            });
            
            fileInput.value = '';
            loadBoard();
            alert('이미지가 업로드되었습니다!');
        } catch (error) {
            alert('업로드 실패. 다시 시도해주세요.');
            console.error(error);
        }
    }

    // Delete board item
    async function deleteItem(itemId) {
        if (!confirm('이 항목을 삭제하시겠습니까?')) return;
        
        try {
            await axios.delete('/api/rooms/' + roomId + '/board/' + itemId);
            loadBoard();
        } catch (error) {
            alert('삭제 실패.');
            console.error(error);
        }
    }

    // Send chat message
    async function sendMessage() {
        const input = document.getElementById('chatInput');
        const message = input.value.trim();
        
        if (!message) return;
        
        try {
            await axios.post('/api/rooms/' + roomId + '/chat', {
                author_name: '참여자',
                message: message
            });
            
            input.value = '';
            loadChat();
        } catch (error) {
            alert('전송 실패. 다시 시도해주세요.');
            console.error(error);
        }
    }

    // Delete room
    function showDeleteModal() {
        document.getElementById('deleteModal').classList.add('active');
    }

    function hideDeleteModal() {
        document.getElementById('deleteModal').classList.remove('active');
    }

    async function deleteRoom() {
        const password = document.getElementById('deletePasswordInput').value;
        
        try {
            await axios.delete('/api/rooms/' + roomId, {
                data: { password: password || null }
            });
            
            alert('방이 삭제되었습니다.');
            window.location.href = '/';
        } catch (error) {
            if (error.response && error.response.status === 403) {
                alert('비밀번호가 올바르지 않습니다.');
            } else {
                alert('삭제 실패. 다시 시도해주세요.');
            }
            console.error(error);
        }
    }

    // Copy room link
    function copyRoomLink() {
        const link = window.location.href;
        if (navigator.clipboard) {
            navigator.clipboard.writeText(link).then(() => {
                alert('링크가 복사되었습니다!\n카카오톡으로 공유하세요.');
            });
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = link;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            alert('링크가 복사되었습니다!\n카카오톡으로 공유하세요.');
        }
    }

    // Utility functions
    function isValidUrl(string) {
        try {
            const url = new URL(string);
            return url.protocol === 'http:' || url.protocol === 'https:';
        } catch (_) {
            return false;
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Expose functions to global scope
    window.switchTab = switchTab;
    window.addBoardItem = addBoardItem;
    window.uploadImage = uploadImage;
    window.setDrawColor = setDrawColor;
    window.setDrawWidth = setDrawWidth;
    window.clearCanvas = clearCanvas;
    window.saveDrawing = saveDrawing;
    window.deleteItem = deleteItem;
    window.sendMessage = sendMessage;
    window.copyRoomLink = copyRoomLink;
    window.verifyPassword = verifyPassword;
    window.showDeleteModal = showDeleteModal;
    window.hideDeleteModal = hideDeleteModal;
    window.deleteRoom = deleteRoom;

    // Wait for DOM and start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupApp);
    } else {
        setupApp();
    }

    function setupApp() {
        // Enter key handlers
        const boardInput = document.getElementById('boardInput');
        if (boardInput) {
            boardInput.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') addBoardItem();
            });
        }

        const chatInput = document.getElementById('chatInput');
        if (chatInput) {
            chatInput.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') sendMessage();
            });
        }

        const passwordInput = document.getElementById('passwordInput');
        if (passwordInput) {
            passwordInput.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') verifyPassword();
            });
        }

        // Cleanup on page unload
        window.addEventListener('beforeunload', () => {
            if (pollInterval) clearInterval(pollInterval);
        });

        // Start app
        init();
    }
})();
