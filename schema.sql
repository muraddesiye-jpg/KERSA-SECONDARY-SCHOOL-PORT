PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 username TEXT UNIQUE,
 email TEXT UNIQUE NOT NULL,
 phone TEXT UNIQUE,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('student','teacher','parent','admin')),
 profile_picture TEXT,
 created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS students (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 father_name TEXT NOT NULL,
 grandfather_name TEXT NOT NULL,
 family_fan_number TEXT NOT NULL,
 family_phone TEXT NOT NULL,
 gender TEXT NOT NULL,
 fan_number TEXT NOT NULL UNIQUE,
 disability_status TEXT NOT NULL,
 region TEXT NOT NULL,
 town_city TEXT NOT NULL,
 woreda TEXT NOT NULL,
 previous_school TEXT NOT NULL,
 past_class_result REAL NOT NULL CHECK(past_class_result >= 50 AND past_class_result <= 100),
 grade INTEGER NOT NULL CHECK(grade BETWEEN 9 AND 12),
 stream TEXT,
 grade8_report_card TEXT,
 status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 admin_reply TEXT,
 generated_password_encrypted TEXT,
 reviewed_at TEXT,
 reviewed_by INTEGER REFERENCES users(id),
 created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS parent_links (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 parent_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
 student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
 relationship TEXT DEFAULT 'Parent',
 UNIQUE(parent_id,student_id)
);
CREATE TABLE IF NOT EXISTS announcements (
 id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL,
 created_by INTEGER REFERENCES users(id), created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS resources (
 id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, grade INTEGER, subject TEXT,
 file_url TEXT NOT NULL, uploaded_by INTEGER REFERENCES users(id), created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS gallery (
 id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, image_url TEXT NOT NULL,
 uploaded_by INTEGER REFERENCES users(id), created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS site_settings (
 id INTEGER PRIMARY KEY DEFAULT 1, logo_url TEXT, school_name TEXT DEFAULT 'Kersa Secondary School', updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS acknowledgment_media (
 id INTEGER PRIMARY KEY AUTOINCREMENT, slot TEXT UNIQUE NOT NULL CHECK(slot IN ('allah','parents','safi','teachers')),
 title TEXT NOT NULL, image_url TEXT NOT NULL, uploaded_by INTEGER REFERENCES users(id), uploaded_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS assignments (
 id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, subject TEXT, grade INTEGER,
 due_date TEXT, created_by INTEGER REFERENCES users(id), created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS grades (
 id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
 subject TEXT NOT NULL, score REAL NOT NULL CHECK(score BETWEEN 0 AND 100), term TEXT DEFAULT 'Term 1',
 teacher_id INTEGER REFERENCES users(id), created_at TEXT DEFAULT (datetime('now')),
 UNIQUE(student_id,subject,term)
);
CREATE TABLE IF NOT EXISTS attendance (
 id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
 attendance_date TEXT DEFAULT (date('now')), status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS timetable (
 id INTEGER PRIMARY KEY AUTOINCREMENT, grade INTEGER NOT NULL, day_name TEXT NOT NULL,
 period TEXT NOT NULL, subject TEXT NOT NULL, teacher TEXT
);
CREATE TABLE IF NOT EXISTS messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
 receiver_id INTEGER REFERENCES users(id) ON DELETE CASCADE, body TEXT NOT NULL,
 subject TEXT, created_at TEXT DEFAULT (datetime('now')), read_at TEXT
);
CREATE TABLE IF NOT EXISTS events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, event_date TEXT NOT NULL, description TEXT
);
CREATE TABLE IF NOT EXISTS reactions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
 item_type TEXT NOT NULL, item_id INTEGER NOT NULL, reaction TEXT NOT NULL,
 UNIQUE(user_id,item_type,item_id)
);
CREATE TABLE IF NOT EXISTS contact_messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL,
 phone TEXT, subject TEXT NOT NULL, message TEXT NOT NULL,
 status TEXT DEFAULT 'new', created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS meetings (
 id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, room_code TEXT UNIQUE NOT NULL,
 created_by INTEGER REFERENCES users(id), starts_at TEXT DEFAULT (datetime('now')), mode TEXT DEFAULT 'hybrid', created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS meeting_messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id INTEGER REFERENCES meetings(id) ON DELETE CASCADE,
 sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE, body TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS meeting_signals (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 meeting_id INTEGER REFERENCES meetings(id) ON DELETE CASCADE,
 sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
 receiver_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
 type TEXT NOT NULL,
 payload TEXT NOT NULL,
 created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notifications (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
 title TEXT NOT NULL,
 body TEXT NOT NULL,
 read_at TEXT,
 created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS meeting_participants (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 meeting_id INTEGER REFERENCES meetings(id) ON DELETE CASCADE,
 user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
 joined_at TEXT DEFAULT (datetime('now')),
 last_seen TEXT DEFAULT (datetime('now')),
 UNIQUE(meeting_id,user_id)
);

CREATE INDEX IF NOT EXISTS students_status_idx ON students(status);
CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS meeting_signals_meeting_id_idx ON meeting_signals(meeting_id,id);
CREATE INDEX IF NOT EXISTS meeting_participants_seen_idx ON meeting_participants(meeting_id,last_seen DESC);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique_idx ON users(username) WHERE username IS NOT NULL;


INSERT INTO site_settings(id,school_name) VALUES(1,'Kersa Secondary School') ON CONFLICT(id) DO NOTHING;
