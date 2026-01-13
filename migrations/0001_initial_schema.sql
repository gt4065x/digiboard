-- Rooms table (방 정보)
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  creator_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_activity DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Board items table (칠판 내용)
CREATE TABLE IF NOT EXISTS board_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  type TEXT NOT NULL, -- 'text', 'url', 'image'
  content TEXT NOT NULL,
  author_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

-- Chat messages table (채팅 메시지)
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_board_items_room_id ON board_items(room_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_room_id ON chat_messages(room_id);
CREATE INDEX IF NOT EXISTS idx_rooms_created_at ON rooms(created_at);
