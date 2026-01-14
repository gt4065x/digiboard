import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

type Bindings = {
  DB: D1Database;
  R2: R2Bucket;
}

const app = new Hono<{ Bindings: Bindings }>()

// Enable CORS
app.use('/api/*', cors())

// Serve static files
app.use('/static/*', serveStatic({ root: './public' }))

// ===== API Routes =====

// Create a new room
app.post('/api/rooms', async (c) => {
  const { name, creator_name, password } = await c.req.json()
  const roomId = generateRoomId()
  
  try {
    // Create room
    await c.env.DB.prepare(`
      INSERT INTO rooms (id, name, creator_name) VALUES (?, ?, ?)
    `).bind(roomId, name || '새 칠판', creator_name || '익명').run()

    // Create room settings if password is provided
    if (password) {
      await c.env.DB.prepare(`
        INSERT INTO room_settings (room_id, password) VALUES (?, ?)
      `).bind(roomId, password).run()
    }

    return c.json({ room_id: roomId, name, creator_name, has_password: !!password })
  } catch (error) {
    return c.json({ error: 'Failed to create room' }, 500)
  }
})

// Verify room password
app.post('/api/rooms/:roomId/verify', async (c) => {
  const roomId = c.req.param('roomId')
  const { password } = await c.req.json()
  
  try {
    const settings = await c.env.DB.prepare(`
      SELECT password FROM room_settings WHERE room_id = ?
    `).bind(roomId).first()

    if (!settings || !settings.password) {
      return c.json({ valid: true }) // No password required
    }

    return c.json({ valid: settings.password === password })
  } catch (error) {
    return c.json({ error: 'Failed to verify password' }, 500)
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

    // Check if room has password
    const settings = await c.env.DB.prepare(`
      SELECT password, expires_at, is_active FROM room_settings WHERE room_id = ?
    `).bind(roomId).first()

    const hasPassword = !!(settings && settings.password)
    const isActive = !settings || settings.is_active === 1
    const isExpired = settings && settings.expires_at && new Date(settings.expires_at as string) < new Date()

    return c.json({ 
      ...room, 
      has_password: hasPassword,
      is_active: isActive && !isExpired
    })
  } catch (error) {
    return c.json({ error: 'Failed to fetch room' }, 500)
  }
})

// Delete room
app.delete('/api/rooms/:roomId', async (c) => {
  const roomId = c.req.param('roomId')
  const { password } = await c.req.json()
  
  try {
    // Verify password if room has one
    const settings = await c.env.DB.prepare(`
      SELECT password FROM room_settings WHERE room_id = ?
    `).bind(roomId).first()

    if (settings && settings.password && settings.password !== password) {
      return c.json({ error: 'Invalid password' }, 403)
    }

    // Delete room (cascades to all related data)
    await c.env.DB.prepare(`
      DELETE FROM rooms WHERE id = ?
    `).bind(roomId).run()

    return c.json({ success: true })
  } catch (error) {
    return c.json({ error: 'Failed to delete room' }, 500)
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
  const { type, content, author_name, image_url } = await c.req.json()
  
  try {
    const result = await c.env.DB.prepare(`
      INSERT INTO board_items (room_id, type, content, author_name, image_url) 
      VALUES (?, ?, ?, ?, ?)
    `).bind(roomId, type, content, author_name || '익명', image_url || null).run()

    // Update room last activity
    await c.env.DB.prepare(`
      UPDATE rooms SET last_activity = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(roomId).run()

    return c.json({ 
      id: result.meta.last_row_id, 
      room_id: roomId,
      type, 
      content, 
      author_name,
      image_url
    })
  } catch (error) {
    return c.json({ error: 'Failed to add board item' }, 500)
  }
})

// Delete board item
app.delete('/api/rooms/:roomId/board/:itemId', async (c) => {
  const roomId = c.req.param('roomId')
  const itemId = c.req.param('itemId')
  
  try {
    await c.env.DB.prepare(`
      DELETE FROM board_items WHERE id = ? AND room_id = ?
    `).bind(itemId, roomId).run()

    return c.json({ success: true })
  } catch (error) {
    return c.json({ error: 'Failed to delete item' }, 500)
  }
})

// Upload image to R2
app.post('/api/rooms/:roomId/upload', async (c) => {
  const roomId = c.req.param('roomId')
  
  try {
    const formData = await c.req.formData()
    const file = formData.get('image') as File
    
    if (!file) {
      return c.json({ error: 'No file provided' }, 400)
    }

    // Generate unique filename
    const ext = file.name.split('.').pop()
    const filename = `${roomId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`
    
    // Upload to R2
    const arrayBuffer = await file.arrayBuffer()
    await c.env.R2.put(filename, arrayBuffer, {
      httpMetadata: {
        contentType: file.type
      }
    })

    // Return public URL (will be accessible via worker)
    const imageUrl = `/api/images/${filename}`
    
    return c.json({ image_url: imageUrl })
  } catch (error) {
    console.error('Upload error:', error)
    return c.json({ error: 'Failed to upload image' }, 500)
  }
})

// Serve image from R2
app.get('/api/images/*', async (c) => {
  const path = c.req.path.replace('/api/images/', '')
  
  try {
    const object = await c.env.R2.get(path)
    
    if (!object) {
      return c.notFound()
    }

    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000'
      }
    })
  } catch (error) {
    return c.notFound()
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

// Get drawings for a room
app.get('/api/rooms/:roomId/drawings', async (c) => {
  const roomId = c.req.param('roomId')
  
  try {
    const { results } = await c.env.DB.prepare(`
      SELECT * FROM drawings WHERE room_id = ? ORDER BY created_at DESC LIMIT 1
    `).bind(roomId).all()

    return c.json({ drawings: results || [] })
  } catch (error) {
    return c.json({ error: 'Failed to fetch drawings' }, 500)
  }
})

// Save drawing
app.post('/api/rooms/:roomId/drawings', async (c) => {
  const roomId = c.req.param('roomId')
  const { drawing_data, author_name } = await c.req.json()
  
  try {
    const result = await c.env.DB.prepare(`
      INSERT INTO drawings (room_id, drawing_data, author_name) 
      VALUES (?, ?, ?)
    `).bind(roomId, drawing_data, author_name || '익명').run()

    return c.json({ 
      id: result.meta.last_row_id,
      room_id: roomId,
      drawing_data,
      author_name
    })
  } catch (error) {
    return c.json({ error: 'Failed to save drawing' }, 500)
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
                        <button onclick="showCreateRoomModal()" 
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
                            강의자료, 이미지, 그림, 채팅을 실시간으로 공유할 수 있습니다
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Create Room Modal -->
        <div id="createRoomModal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div class="bg-white rounded-2xl p-6 sm:p-8 max-w-md w-full">
                <h2 class="text-xl sm:text-2xl font-bold mb-4">새 칠판 만들기</h2>
                <div class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium mb-2">방 이름 (선택)</label>
                        <input type="text" id="roomName" placeholder="예: AI 강의" 
                               class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500">
                    </div>
                    <div>
                        <label class="block text-sm font-medium mb-2">비밀번호 (선택)</label>
                        <input type="password" id="roomPassword" placeholder="비밀번호 설정 (선택)" 
                               class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500">
                        <p class="text-xs text-gray-500 mt-1">비밀번호를 설정하면 입장 시 요구됩니다</p>
                    </div>
                    <div class="flex gap-2">
                        <button onclick="createRoom()" 
                                class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg">
                            만들기
                        </button>
                        <button onclick="hideCreateRoomModal()" 
                                class="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold py-3 rounded-lg">
                            취소
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script>
            function showCreateRoomModal() {
                document.getElementById('createRoomModal').classList.remove('hidden');
            }

            function hideCreateRoomModal() {
                document.getElementById('createRoomModal').classList.add('hidden');
            }

            async function createRoom() {
                try {
                    const name = document.getElementById('roomName').value.trim();
                    const password = document.getElementById('roomPassword').value.trim();
                    
                    const response = await axios.post('/api/rooms', {
                        name: name || '새 칠판',
                        creator_name: '강의자',
                        password: password || null
                    });
                    
                    const roomId = response.data.room_id;
                    window.location.href = '/room/' + roomId;
                } catch (error) {
                    alert('칠판 생성에 실패했습니다. 다시 시도해주세요.');
                    console.error(error);
                }
            }

            async function joinRoom() {
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
  
  // HTML은 너무 길어서 별도 문자열로 처리
  const html = `
    <!DOCTYPE html>
    <html lang="ko">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>칠판 - \${roomId}</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <style>
          * { box-sizing: border-box; }
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
            height: 35vh;
            min-height: 180px;
            display: flex;
            flex-direction: column;
            border-top: 2px solid #e5e7eb;
          }
          .chat-messages {
            flex: 1;
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
          }
          .board-item { word-wrap: break-word; overflow-wrap: break-word; }
          .url-link { word-break: break-all; }
          .modal { 
            display: none !important; 
          }
          .modal.active { 
            display: flex !important; 
          }
          .tabs button.active { background-color: #3b82f6; color: white; }
          
          /* Canvas styles */
          #drawingCanvas {
            border: 2px solid #e5e7eb;
            cursor: crosshair;
            touch-action: none;
            background: white;
          }
          
          @media (max-width: 768px) {
            html { font-size: 14px; }
            .chat-section { height: 40vh; }
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
                        <p class="text-xs sm:text-sm text-blue-100 font-mono">방 코드: \${roomId}</p>
                    </div>
                    <div class="flex gap-2 ml-2 flex-shrink-0">
                        <button onclick="copyRoomLink()" 
                                class="bg-blue-500 hover:bg-blue-700 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm">
                            <i class="fas fa-copy mr-1"></i>
                            <span class="hidden sm:inline">링크</span>
                        </button>
                        <button onclick="showDeleteModal()" 
                                class="bg-red-500 hover:bg-red-700 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm">
                            <i class="fas fa-trash mr-1"></i>
                            <span class="hidden sm:inline">삭제</span>
                        </button>
                    </div>
                </div>
            </div>

            <!-- Board Section -->
            <div class="board-section bg-white p-3 sm:p-4">
                <div class="max-w-4xl mx-auto">
                    <!-- Tabs -->
                    <div class="flex gap-2 mb-4 border-b border-gray-300">
                        <button onclick="switchTab('text')" id="tabText" 
                                class="tabs active px-4 py-2 font-semibold rounded-t-lg">
                            <i class="fas fa-font mr-1"></i>텍스트
                        </button>
                        <button onclick="switchTab('image')" id="tabImage" 
                                class="tabs px-4 py-2 font-semibold rounded-t-lg hover:bg-gray-100">
                            <i class="fas fa-image mr-1"></i>이미지
                        </button>
                        <button onclick="switchTab('draw')" id="tabDraw" 
                                class="tabs px-4 py-2 font-semibold rounded-t-lg hover:bg-gray-100">
                            <i class="fas fa-paint-brush mr-1"></i>그림
                        </button>
                    </div>

                    <!-- Text Input -->
                    <div id="textInput" class="mb-4">
                        <div class="flex flex-col sm:flex-row gap-2">
                            <input type="text" 
                                   id="boardInput" 
                                   placeholder="텍스트 또는 URL 입력..." 
                                   class="flex-1 px-3 sm:px-4 py-2 sm:py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 text-sm sm:text-base">
                            <button onclick="addBoardItem()" 
                                    class="bg-blue-600 hover:bg-blue-700 text-white px-4 sm:px-6 py-2 sm:py-3 rounded-lg font-semibold text-sm sm:text-base">
                                <i class="fas fa-plus mr-1 sm:mr-2"></i>추가
                            </button>
                        </div>
                    </div>

                    <!-- Image Upload -->
                    <div id="imageInput" class="mb-4 hidden">
                        <div class="flex flex-col gap-2">
                            <input type="file" 
                                   id="imageFile" 
                                   accept="image/*"
                                   class="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100">
                            <button onclick="uploadImage()" 
                                    class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-semibold text-sm sm:text-base">
                                <i class="fas fa-upload mr-2"></i>이미지 업로드
                            </button>
                        </div>
                    </div>

                    <!-- Drawing Canvas -->
                    <div id="drawInput" class="mb-4 hidden">
                        <div class="space-y-2">
                            <div class="flex gap-2 items-center flex-wrap">
                                <button onclick="setDrawColor('black')" class="w-8 h-8 bg-black rounded-full border-2 border-gray-300"></button>
                                <button onclick="setDrawColor('red')" class="w-8 h-8 bg-red-500 rounded-full border-2 border-gray-300"></button>
                                <button onclick="setDrawColor('blue')" class="w-8 h-8 bg-blue-500 rounded-full border-2 border-gray-300"></button>
                                <button onclick="setDrawColor('green')" class="w-8 h-8 bg-green-500 rounded-full border-2 border-gray-300"></button>
                                <button onclick="setDrawColor('yellow')" class="w-8 h-8 bg-yellow-400 rounded-full border-2 border-gray-300"></button>
                                <select onchange="setDrawWidth(this.value)" class="px-3 py-1 border border-gray-300 rounded-lg text-sm">
                                    <option value="2">가는선</option>
                                    <option value="5" selected>보통</option>
                                    <option value="10">굵은선</option>
                                </select>
                                <button onclick="clearCanvas()" class="px-3 py-1 bg-gray-300 hover:bg-gray-400 rounded-lg text-sm">
                                    <i class="fas fa-eraser mr-1"></i>지우기
                                </button>
                                <button onclick="saveDrawing()" class="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm">
                                    <i class="fas fa-save mr-1"></i>저장
                                </button>
                            </div>
                            <canvas id="drawingCanvas" width="800" height="400" class="w-full max-w-full"></canvas>
                        </div>
                    </div>

                    <!-- Board Items -->
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
                                    class="bg-green-600 hover:bg-green-700 text-white px-4 sm:px-6 py-2 rounded-lg font-semibold text-sm sm:text-base">
                                <i class="fas fa-paper-plane mr-1"></i>
                                <span class="hidden sm:inline">전송</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Password Modal -->
        <div id="passwordModal" class="modal fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div class="bg-white rounded-2xl p-6 sm:p-8 max-w-md w-full">
                <h2 class="text-xl sm:text-2xl font-bold mb-4">비밀번호 입력</h2>
                <p class="text-sm text-gray-600 mb-4">이 방은 비밀번호로 보호되어 있습니다.</p>
                <input type="password" id="passwordInput" placeholder="비밀번호 입력" 
                       class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 mb-4">
                <div class="flex gap-2">
                    <button onclick="verifyPassword()" 
                            class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg">
                        확인
                    </button>
                    <button onclick="window.location.href='/'" 
                            class="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold py-3 rounded-lg">
                        취소
                    </button>
                </div>
            </div>
        </div>

        <!-- Delete Room Modal -->
        <div id="deleteModal" class="modal fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div class="bg-white rounded-2xl p-6 sm:p-8 max-w-md w-full">
                <h2 class="text-xl sm:text-2xl font-bold mb-4 text-red-600">방 삭제</h2>
                <p class="text-sm text-gray-600 mb-4">정말로 이 방을 삭제하시겠습니까? 모든 데이터가 영구 삭제됩니다.</p>
                <input type="password" id="deletePasswordInput" placeholder="비밀번호 (설정한 경우)" 
                       class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 mb-4">
                <div class="flex gap-2">
                    <button onclick="deleteRoom()" 
                            class="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-3 rounded-lg">
                        삭제
                    </button>
                    <button onclick="hideDeleteModal()" 
                            class="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold py-3 rounded-lg">
                        취소
                    </button>
                </div>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script>
            window.ROOM_ID = '${roomId}';
        </script>
        <script src="/static/room.js"></script>
        <script type="text/deleted">
            /* Moved to /static/room.js */
            const roomId = '\${roomId}';
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
                // Check room status
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
                // Update tab buttons
                document.querySelectorAll('.tabs').forEach(btn => btn.classList.remove('active'));
                document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');
                
                // Show/hide input sections
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
                            return \\\`
                                <div class="board-item bg-purple-50 border-l-4 border-purple-500 p-3 sm:p-4 rounded-r-lg relative">
                                    <div class="flex items-start gap-2 mb-2">
                                        <i class="fas fa-image text-purple-600 mt-1"></i>
                                        <div class="flex-1">
                                            <img src="\\\${item.image_url}" alt="Uploaded" class="max-w-full h-auto rounded-lg shadow-md">
                                            <p class="text-sm text-gray-600 mt-2">\\\${escapeHtml(item.content)}</p>
                                        </div>
                                        <button onclick="deleteItem(\\\${item.id})" class="text-red-500 hover:text-red-700">
                                            <i class="fas fa-times"></i>
                                        </button>
                                    </div>
                                    <div class="text-xs text-gray-500 pl-6">
                                        \\\${item.author_name} · \\\${time}
                                    </div>
                                </div>
                            \\\`;
                        } else if (item.type === 'drawing') {
                            return \\\`
                                <div class="board-item bg-pink-50 border-l-4 border-pink-500 p-3 sm:p-4 rounded-r-lg relative">
                                    <div class="flex items-start gap-2 mb-2">
                                        <i class="fas fa-paint-brush text-pink-600 mt-1"></i>
                                        <div class="flex-1">
                                            <p class="text-sm font-medium text-gray-700">저장된 그림</p>
                                            <p class="text-xs text-gray-500 mt-1">그림 탭에서 확인하세요</p>
                                        </div>
                                        <button onclick="deleteItem(\\\${item.id})" class="text-red-500 hover:text-red-700">
                                            <i class="fas fa-times"></i>
                                        </button>
                                    </div>
                                    <div class="text-xs text-gray-500 pl-6">
                                        \\\${item.author_name} · \\\${time}
                                    </div>
                                </div>
                            \\\`;
                        } else if (isUrl) {
                            return \\\`
                                <div class="board-item bg-blue-50 border-l-4 border-blue-500 p-3 sm:p-4 rounded-r-lg relative">
                                    <div class="flex items-start gap-2 mb-2">
                                        <i class="fas fa-link text-blue-600 mt-1"></i>
                                        <a href="\\\${item.content}" target="_blank" class="url-link flex-1 text-blue-600 hover:text-blue-800 underline font-medium text-sm sm:text-base break-all">
                                            \\\${item.content}
                                        </a>
                                        <button onclick="deleteItem(\\\${item.id})" class="text-red-500 hover:text-red-700">
                                            <i class="fas fa-times"></i>
                                        </button>
                                    </div>
                                    <div class="text-xs text-gray-500 pl-6">
                                        \\\${item.author_name} · \\\${time}
                                    </div>
                                </div>
                            \\\`;
                        } else {
                            return \\\`
                                <div class="board-item bg-yellow-50 border-l-4 border-yellow-500 p-3 sm:p-4 rounded-r-lg relative">
                                    <div class="flex items-start gap-2 mb-2">
                                        <i class="fas fa-sticky-note text-yellow-600 mt-1"></i>
                                        <p class="flex-1 text-gray-800 text-sm sm:text-base whitespace-pre-wrap break-words">\\\${escapeHtml(item.content)}</p>
                                        <button onclick="deleteItem(\\\${item.id})" class="text-red-500 hover:text-red-700">
                                            <i class="fas fa-times"></i>
                                        </button>
                                    </div>
                                    <div class="text-xs text-gray-500 pl-6">
                                        \\\${item.author_name} · \\\${time}
                                    </div>
                                </div>
                            \\\`;
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
                        return \\\`
                            <div class="bg-white rounded-lg p-2 sm:p-3 shadow-sm">
                                <div class="flex items-baseline gap-2 mb-1">
                                    <span class="font-semibold text-blue-600 text-xs sm:text-sm">\\\${escapeHtml(msg.author_name)}</span>
                                    <span class="text-xs text-gray-400">\\\${time}</span>
                                </div>
                                <p class="text-gray-800 text-sm sm:text-base break-words">\\\${escapeHtml(msg.message)}</p>
                            </div>
                        \\\`;
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
                        alert('링크가 복사되었습니다!\\\\n카카오톡으로 공유하세요.');
                    });
                } else {
                    const textarea = document.createElement('textarea');
                    textarea.value = link;
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textarea);
                    alert('링크가 복사되었습니다!\\\\n카카오톡으로 공유하세요.');
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

            document.getElementById('passwordInput').addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    verifyPassword();
                }
            });

            // Expose functions to global scope for onclick handlers
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

            // Cleanup on page unload
            window.addEventListener('beforeunload', () => {
                if (pollInterval) {
                    clearInterval(pollInterval);
                }
            });

            // Start app - NOW IN /static/room.js
            // init();
        </script>
    </body>
    </html>
  `
  
  return c.html(html)
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
