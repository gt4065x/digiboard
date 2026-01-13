import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

type Bindings = {
  DB: D1Database;
}

const app = new Hono<{ Bindings: Bindings }>()

// Enable CORS
app.use('/api/*', cors())

// Serve static files
app.use('/static/*', serveStatic({ root: './public' }))

// ===== API Routes =====

// Create a new room
app.post('/api/rooms', async (c) => {
  const { name, creator_name } = await c.req.json()
  const roomId = generateRoomId()
  
  try {
    await c.env.DB.prepare(`
      INSERT INTO rooms (id, name, creator_name) VALUES (?, ?, ?)
    `).bind(roomId, name || '새 칠판', creator_name || '익명').run()

    return c.json({ room_id: roomId, name, creator_name })
  } catch (error) {
    return c.json({ error: 'Failed to create room' }, 500)
  }
})

// Get room info
app.get('/api/rooms/:roomId', async (c) => {
  const roomId = c.req.param('roomId')
  
  try {
    const room = await c.env.DB.prepare(`
      SELECT * FROM rooms WHERE id = ?
    `).bind(roomId).first()

    if (!room) {
      return c.json({ error: 'Room not found' }, 404)
    }

    return c.json(room)
  } catch (error) {
    return c.json({ error: 'Failed to fetch room' }, 500)
  }
})

// Get board items for a room
app.get('/api/rooms/:roomId/board', async (c) => {
  const roomId = c.req.param('roomId')
  
  try {
    const { results } = await c.env.DB.prepare(`
      SELECT * FROM board_items WHERE room_id = ? ORDER BY created_at ASC
    `).bind(roomId).all()

    return c.json({ items: results || [] })
  } catch (error) {
    return c.json({ error: 'Failed to fetch board items' }, 500)
  }
})

// Add a board item
app.post('/api/rooms/:roomId/board', async (c) => {
  const roomId = c.req.param('roomId')
  const { type, content, author_name } = await c.req.json()
  
  try {
    const result = await c.env.DB.prepare(`
      INSERT INTO board_items (room_id, type, content, author_name) 
      VALUES (?, ?, ?, ?)
    `).bind(roomId, type, content, author_name || '익명').run()

    // Update room last activity
    await c.env.DB.prepare(`
      UPDATE rooms SET last_activity = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(roomId).run()

    return c.json({ 
      id: result.meta.last_row_id, 
      room_id: roomId,
      type, 
      content, 
      author_name 
    })
  } catch (error) {
    return c.json({ error: 'Failed to add board item' }, 500)
  }
})

// Get chat messages for a room
app.get('/api/rooms/:roomId/chat', async (c) => {
  const roomId = c.req.param('roomId')
  
  try {
    const { results } = await c.env.DB.prepare(`
      SELECT * FROM chat_messages WHERE room_id = ? ORDER BY created_at ASC
    `).bind(roomId).all()

    return c.json({ messages: results || [] })
  } catch (error) {
    return c.json({ error: 'Failed to fetch messages' }, 500)
  }
})

// Send a chat message
app.post('/api/rooms/:roomId/chat', async (c) => {
  const roomId = c.req.param('roomId')
  const { author_name, message } = await c.req.json()
  
  try {
    const result = await c.env.DB.prepare(`
      INSERT INTO chat_messages (room_id, author_name, message) 
      VALUES (?, ?, ?)
    `).bind(roomId, author_name || '익명', message).run()

    // Update room last activity
    await c.env.DB.prepare(`
      UPDATE rooms SET last_activity = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(roomId).run()

    return c.json({ 
      id: result.meta.last_row_id, 
      room_id: roomId,
      author_name, 
      message 
    })
  } catch (error) {
    return c.json({ error: 'Failed to send message' }, 500)
  }
})

// ===== HTML Pages =====

// Home page
app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>디지털 공유 칠판</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <style>
          body { 
            overflow-x: hidden;
            -webkit-font-smoothing: antialiased;
          }
          .container-mobile {
            min-height: 100vh;
            display: flex;
            flex-direction: column;
          }
          @media (max-width: 768px) {
            html {
              font-size: 14px;
            }
          }
        </style>
    </head>
    <body class="bg-gradient-to-br from-blue-50 to-indigo-100">
        <div class="container-mobile">
            <div class="flex-1 flex items-center justify-center p-4 sm:p-8">
                <div class="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 sm:p-8">
                    <div class="text-center mb-8">
                        <div class="inline-block p-4 bg-blue-100 rounded-full mb-4">
                            <i class="fas fa-chalkboard-teacher text-4xl text-blue-600"></i>
                        </div>
                        <h1 class="text-2xl sm:text-3xl font-bold text-gray-800 mb-2">디지털 공유 칠판</h1>
                        <p class="text-sm sm:text-base text-gray-600">실시간으로 강의 자료를 공유하세요</p>
                    </div>

                    <div class="space-y-4">
                        <button onclick="createRoom()" 
                                class="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-4 px-6 rounded-xl transition duration-200 transform hover:scale-105 active:scale-95 shadow-lg">
                            <i class="fas fa-plus-circle mr-2"></i>
                            새 칠판 만들기
                        </button>

                        <div class="relative">
                            <div class="absolute inset-0 flex items-center">
                                <div class="w-full border-t border-gray-300"></div>
                            </div>
                            <div class="relative flex justify-center text-sm">
                                <span class="px-2 bg-white text-gray-500">또는</span>
                            </div>
                        </div>

                        <div>
                            <input type="text" 
                                   id="roomIdInput" 
                                   placeholder="방 코드를 입력하세요" 
                                   class="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:border-blue-500 text-center text-lg font-mono tracking-wider">
                        </div>

                        <button onclick="joinRoom()" 
                                class="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-4 px-6 rounded-xl transition duration-200 transform hover:scale-105 active:scale-95 shadow-lg">
                            <i class="fas fa-sign-in-alt mr-2"></i>
                            칠판 입장하기
                        </button>
                    </div>

                    <div class="mt-8 pt-6 border-t border-gray-200">
                        <div class="text-center text-sm text-gray-600">
                            <i class="fas fa-info-circle mr-1"></i>
                            강의자료, URL, 채팅을 실시간으로 공유할 수 있습니다
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script>
            async function createRoom() {
                try {
                    const response = await axios.post('/api/rooms', {
                        name: '새 칠판',
                        creator_name: '강의자'
                    });
                    
                    const roomId = response.data.room_id;
                    window.location.href = '/room/' + roomId;
                } catch (error) {
                    alert('칠판 생성에 실패했습니다. 다시 시도해주세요.');
                    console.error(error);
                }
            }

            function joinRoom() {
                const roomId = document.getElementById('roomIdInput').value.trim();
                if (!roomId) {
                    alert('방 코드를 입력해주세요.');
                    return;
                }
                window.location.href = '/room/' + roomId;
            }

            // Enter key to join
            document.getElementById('roomIdInput').addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    joinRoom();
                }
            });
        </script>
    </body>
    </html>
  `)
})

// Room page
app.get('/room/:roomId', (c) => {
  const roomId = c.req.param('roomId')
  
  return c.html(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>칠판 - ${roomId}</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <style>
          * {
            box-sizing: border-box;
          }
          body { 
            overflow: hidden;
            -webkit-font-smoothing: antialiased;
            margin: 0;
            padding: 0;
          }
          .room-container {
            height: 100vh;
            height: 100dvh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }
          .board-section {
            flex: 1;
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
          }
          .chat-section {
            height: 40vh;
            min-height: 200px;
            display: flex;
            flex-direction: column;
            border-top: 2px solid #e5e7eb;
          }
          .chat-messages {
            flex: 1;
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
          }
          .board-item {
            word-wrap: break-word;
            overflow-wrap: break-word;
          }
          .url-link {
            word-break: break-all;
          }
          @media (max-width: 768px) {
            html { font-size: 14px; }
            .chat-section { height: 45vh; }
          }
        </style>
    </head>
    <body>
        <div class="room-container bg-gray-50">
            <!-- Header -->
            <div class="bg-blue-600 text-white p-3 sm:p-4 shadow-lg flex-shrink-0">
                <div class="flex items-center justify-between">
                    <div class="flex-1 min-w-0">
                        <h2 class="text-lg sm:text-xl font-bold truncate">
                            <i class="fas fa-chalkboard mr-2"></i>
                            <span id="roomName">칠판</span>
                        </h2>
                        <p class="text-xs sm:text-sm text-blue-100 font-mono">방 코드: ${roomId}</p>
                    </div>
                    <button onclick="copyRoomLink()" 
                            class="ml-2 bg-blue-500 hover:bg-blue-700 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm whitespace-nowrap flex-shrink-0">
                        <i class="fas fa-copy mr-1"></i>
                        <span class="hidden sm:inline">링크 복사</span>
                        <span class="sm:hidden">복사</span>
                    </button>
                </div>
            </div>

            <!-- Board Section -->
            <div class="board-section bg-white p-3 sm:p-4">
                <div class="max-w-4xl mx-auto">
                    <div class="mb-4">
                        <div class="flex flex-col sm:flex-row gap-2">
                            <input type="text" 
                                   id="boardInput" 
                                   placeholder="텍스트 또는 URL 입력..." 
                                   class="flex-1 px-3 sm:px-4 py-2 sm:py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 text-sm sm:text-base">
                            <button onclick="addBoardItem()" 
                                    class="bg-blue-600 hover:bg-blue-700 text-white px-4 sm:px-6 py-2 sm:py-3 rounded-lg font-semibold whitespace-nowrap text-sm sm:text-base">
                                <i class="fas fa-plus mr-1 sm:mr-2"></i>
                                추가
                            </button>
                        </div>
                    </div>

                    <div id="boardItems" class="space-y-3">
                        <!-- Board items will be loaded here -->
                    </div>
                </div>
            </div>

            <!-- Chat Section -->
            <div class="chat-section bg-gray-100 flex-shrink-0">
                <div class="h-full flex flex-col">
                    <div class="bg-gray-200 px-3 sm:px-4 py-2 font-semibold text-gray-700 text-sm sm:text-base flex-shrink-0">
                        <i class="fas fa-comments mr-2"></i>채팅
                    </div>
                    <div id="chatMessages" class="chat-messages p-2 sm:p-3 space-y-2">
                        <!-- Chat messages will be loaded here -->
                    </div>
                    <div class="p-2 sm:p-3 bg-white border-t border-gray-300 flex-shrink-0">
                        <div class="flex gap-2">
                            <input type="text" 
                                   id="chatInput" 
                                   placeholder="메시지를 입력하세요..." 
                                   class="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 text-sm sm:text-base">
                            <button onclick="sendMessage()" 
                                    class="bg-green-600 hover:bg-green-700 text-white px-4 sm:px-6 py-2 rounded-lg font-semibold whitespace-nowrap text-sm sm:text-base">
                                <i class="fas fa-paper-plane mr-1"></i>
                                <span class="hidden sm:inline">전송</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script>
            const roomId = '${roomId}';
            let pollInterval;

            // Load room data
            async function loadRoom() {
                try {
                    const response = await axios.get('/api/rooms/' + roomId);
                    document.getElementById('roomName').textContent = response.data.name || '칠판';
                } catch (error) {
                    console.error('Failed to load room:', error);
                }
            }

            // Load board items
            async function loadBoard() {
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
                        
                        if (isUrl) {
                            return \`
                                <div class="board-item bg-blue-50 border-l-4 border-blue-500 p-3 sm:p-4 rounded-r-lg">
                                    <div class="flex items-start gap-2 mb-2">
                                        <i class="fas fa-link text-blue-600 mt-1"></i>
                                        <a href="\${item.content}" target="_blank" class="url-link flex-1 text-blue-600 hover:text-blue-800 underline font-medium text-sm sm:text-base break-all">
                                            \${item.content}
                                        </a>
                                    </div>
                                    <div class="text-xs text-gray-500 pl-6">
                                        \${item.author_name} · \${time}
                                    </div>
                                </div>
                            \`;
                        } else {
                            return \`
                                <div class="board-item bg-yellow-50 border-l-4 border-yellow-500 p-3 sm:p-4 rounded-r-lg">
                                    <div class="flex items-start gap-2 mb-2">
                                        <i class="fas fa-sticky-note text-yellow-600 mt-1"></i>
                                        <p class="flex-1 text-gray-800 text-sm sm:text-base whitespace-pre-wrap break-words">\${escapeHtml(item.content)}</p>
                                    </div>
                                    <div class="text-xs text-gray-500 pl-6">
                                        \${item.author_name} · \${time}
                                    </div>
                                </div>
                            \`;
                        }
                    }).join('');
                } catch (error) {
                    console.error('Failed to load board:', error);
                }
            }

            // Load chat messages
            async function loadChat() {
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
                        return \`
                            <div class="bg-white rounded-lg p-2 sm:p-3 shadow-sm">
                                <div class="flex items-baseline gap-2 mb-1">
                                    <span class="font-semibold text-blue-600 text-xs sm:text-sm">\${escapeHtml(msg.author_name)}</span>
                                    <span class="text-xs text-gray-400">\${time}</span>
                                </div>
                                <p class="text-gray-800 text-sm sm:text-base break-words">\${escapeHtml(msg.message)}</p>
                            </div>
                        \`;
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

            // Copy room link
            function copyRoomLink() {
                const link = window.location.href;
                if (navigator.clipboard) {
                    navigator.clipboard.writeText(link).then(() => {
                        alert('링크가 복사되었습니다!\\n카카오톡으로 공유하세요.');
                    });
                } else {
                    // Fallback for older browsers
                    const textarea = document.createElement('textarea');
                    textarea.value = link;
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textarea);
                    alert('링크가 복사되었습니다!\\n카카오톡으로 공유하세요.');
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

            // Enter key handlers
            document.getElementById('boardInput').addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    addBoardItem();
                }
            });

            document.getElementById('chatInput').addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    sendMessage();
                }
            });

            // Initialize
            loadRoom();
            loadBoard();
            loadChat();

            // Poll for updates every 3 seconds
            pollInterval = setInterval(() => {
                loadBoard();
                loadChat();
            }, 3000);

            // Cleanup on page unload
            window.addEventListener('beforeunload', () => {
                if (pollInterval) {
                    clearInterval(pollInterval);
                }
            });
        </script>
    </body>
    </html>
  `)
})

// Helper function to generate room ID
function generateRoomId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let result = ''
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

export default app
