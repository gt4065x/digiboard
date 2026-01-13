-- Add column for board item images
ALTER TABLE board_items ADD COLUMN image_url TEXT;

-- Drawings table (Canvas 그림 데이터)
CREATE TABLE IF NOT EXISTS drawings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  drawing_data TEXT NOT NULL, -- JSON string of drawing paths
  author_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

-- Room settings table (방 관리 설정)
CREATE TABLE IF NOT EXISTS room_settings (
  room_id TEXT PRIMARY KEY,
  password TEXT, -- 방 비밀번호 (null이면 공개방)
  expires_at DATETIME, -- 만료 시간
  is_active INTEGER DEFAULT 1, -- 활성화 상태 (0: 비활성, 1: 활성)
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_drawings_room_id ON drawings(room_id);
CREATE INDEX IF NOT EXISTS idx_room_settings_expires ON room_settings(expires_at);
