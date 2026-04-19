-- ============================================================
-- HỆ THỐNG THI TRỰC TUYẾN - SUPABASE SCHEMA
-- Chạy file này trong Supabase SQL Editor
-- ============================================================

-- 1. BẢNG PROFILES (mở rộng thông tin user)
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name   TEXT,
  email       TEXT,
  role        TEXT DEFAULT 'student' CHECK (role IN ('student', 'admin')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Tự động tạo profile khi user đăng ký
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'student')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- 2. BẢNG QUESTIONS_CACHE (câu hỏi sync từ Google Sheets)
CREATE TABLE IF NOT EXISTS questions_cache (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sheet_row_id    TEXT UNIQUE NOT NULL,  -- row number hoặc ID trong Google Sheet
  question        TEXT NOT NULL,
  option_a        TEXT NOT NULL,
  option_b        TEXT NOT NULL,
  option_c        TEXT NOT NULL,
  option_d        TEXT NOT NULL,
  correct_answer  TEXT NOT NULL CHECK (correct_answer IN ('a','b','c','d')),
  difficulty      TEXT DEFAULT 'medium' CHECK (difficulty IN ('easy','medium','hard')),
  topic           TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  synced_at       TIMESTAMPTZ DEFAULT NOW()
);


-- 3. BẢNG EXAM_SESSIONS (mỗi lần thi = 1 session)
CREATE TABLE IF NOT EXISTS exam_sessions (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           UUID REFERENCES auth.users(id) NOT NULL,
  question_ids      UUID[] NOT NULL,          -- danh sách câu hỏi đã random, cố định theo thứ tự
  started_at        TIMESTAMPTZ DEFAULT NOW(),
  submitted_at      TIMESTAMPTZ,
  duration_minutes  INTEGER DEFAULT 30,
  score             INTEGER,                  -- điểm sau khi chấm (0-100)
  total_questions   INTEGER,
  correct_count     INTEGER,
  status            TEXT DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress','submitted','graded'))
);


-- 4. BẢNG SUBMISSIONS (từng câu trả lời của thí sinh)
CREATE TABLE IF NOT EXISTS submissions (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id   UUID REFERENCES exam_sessions(id) ON DELETE CASCADE NOT NULL,
  question_id  UUID REFERENCES questions_cache(id) NOT NULL,
  user_answer  TEXT CHECK (user_answer IN ('a','b','c','d')),
  is_correct   BOOLEAN,
  answered_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, question_id)
);


-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

ALTER TABLE profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions     ENABLE ROW LEVEL SECURITY;

-- Helper function: check if current user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT role = 'admin' FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

-- PROFILES
CREATE POLICY "Users see own profile"    ON profiles FOR SELECT USING (id = auth.uid() OR is_admin());
CREATE POLICY "Users update own profile" ON profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY "Admin manages profiles"   ON profiles FOR ALL    USING (is_admin());

-- QUESTIONS_CACHE (thí sinh chỉ đọc, admin full quyền)
CREATE POLICY "Anyone can read active questions"  ON questions_cache FOR SELECT USING (is_active = TRUE OR is_admin());
CREATE POLICY "Admin manages questions"           ON questions_cache FOR ALL    USING (is_admin());
-- Service role (Netlify Function) được phép upsert - dùng service_role key

-- EXAM_SESSIONS
CREATE POLICY "Students see own sessions"   ON exam_sessions FOR SELECT USING (user_id = auth.uid() OR is_admin());
CREATE POLICY "Students create own session" ON exam_sessions FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Students update own session" ON exam_sessions FOR UPDATE USING (user_id = auth.uid() AND status = 'in_progress');
CREATE POLICY "Admin sees all sessions"     ON exam_sessions FOR ALL    USING (is_admin());

-- SUBMISSIONS
CREATE POLICY "Students see own submissions"   ON submissions FOR SELECT USING (
  session_id IN (SELECT id FROM exam_sessions WHERE user_id = auth.uid()) OR is_admin()
);
CREATE POLICY "Students insert own answers"    ON submissions FOR INSERT WITH CHECK (
  session_id IN (SELECT id FROM exam_sessions WHERE user_id = auth.uid() AND status = 'in_progress')
);
CREATE POLICY "Students update own answers"    ON submissions FOR UPDATE USING (
  session_id IN (SELECT id FROM exam_sessions WHERE user_id = auth.uid() AND status = 'in_progress')
);
CREATE POLICY "Admin sees all submissions"     ON submissions FOR ALL USING (is_admin());


-- ============================================================
-- FUNCTION: TẠO EXAM SESSION VỚI CÂU HỎI RANDOM
-- ============================================================
CREATE OR REPLACE FUNCTION create_exam_session(
  p_user_id         UUID,
  p_num_questions   INTEGER DEFAULT 20,
  p_duration_mins   INTEGER DEFAULT 30,
  p_topic           TEXT    DEFAULT NULL   -- NULL = lấy tất cả topic
)
RETURNS UUID AS $$
DECLARE
  v_session_id    UUID;
  v_question_ids  UUID[];
BEGIN
  -- Kiểm tra user chưa có session đang thi
  IF EXISTS (
    SELECT 1 FROM exam_sessions
    WHERE user_id = p_user_id AND status = 'in_progress'
  ) THEN
    RAISE EXCEPTION 'Bạn đang có bài thi chưa hoàn thành';
  END IF;

  -- Random câu hỏi từ pool
  SELECT ARRAY_AGG(id ORDER BY RANDOM())
  INTO v_question_ids
  FROM (
    SELECT id FROM questions_cache
    WHERE is_active = TRUE
      AND (p_topic IS NULL OR topic = p_topic)
    ORDER BY RANDOM()
    LIMIT p_num_questions
  ) q;

  IF ARRAY_LENGTH(v_question_ids, 1) < p_num_questions THEN
    RAISE EXCEPTION 'Không đủ câu hỏi trong ngân hàng (cần %, có %)',
      p_num_questions, COALESCE(ARRAY_LENGTH(v_question_ids, 1), 0);
  END IF;

  -- Tạo session
  INSERT INTO exam_sessions (user_id, question_ids, duration_minutes, total_questions)
  VALUES (p_user_id, v_question_ids, p_duration_mins, p_num_questions)
  RETURNING id INTO v_session_id;

  RETURN v_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- FUNCTION: NỘP BÀI VÀ CHẤM ĐIỂM TỰ ĐỘNG
-- ============================================================
CREATE OR REPLACE FUNCTION submit_exam(p_session_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_user_id       UUID;
  v_correct       INTEGER;
  v_total         INTEGER;
  v_score         INTEGER;
BEGIN
  -- Kiểm tra quyền sở hữu
  SELECT user_id INTO v_user_id
  FROM exam_sessions WHERE id = p_session_id AND status = 'in_progress';

  IF v_user_id IS NULL OR v_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Không tìm thấy bài thi hoặc không có quyền';
  END IF;

  -- Chấm điểm: cập nhật is_correct cho từng câu
  UPDATE submissions s
  SET is_correct = (s.user_answer = q.correct_answer)
  FROM questions_cache q
  WHERE s.question_id = q.id AND s.session_id = p_session_id;

  -- Tính điểm
  SELECT
    COUNT(*) FILTER (WHERE is_correct = TRUE),
    COUNT(*)
  INTO v_correct, v_total
  FROM submissions WHERE session_id = p_session_id;

  v_score := ROUND((v_correct::NUMERIC / NULLIF(v_total, 0)) * 100);

  -- Cập nhật session
  UPDATE exam_sessions
  SET
    status        = 'graded',
    submitted_at  = NOW(),
    correct_count = v_correct,
    score         = v_score
  WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'session_id',    p_session_id,
    'score',         v_score,
    'correct',       v_correct,
    'total',         v_total
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- INDEXES để tăng tốc query
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_exam_sessions_user_id  ON exam_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_exam_sessions_status   ON exam_sessions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_session_id ON submissions(session_id);
CREATE INDEX IF NOT EXISTS idx_questions_active       ON questions_cache(is_active, topic);


-- ============================================================
-- DỮ LIỆU MẪU (xóa nếu không cần)
-- ============================================================
INSERT INTO questions_cache (sheet_row_id, question, option_a, option_b, option_c, option_d, correct_answer, difficulty, topic)
VALUES
  ('row_1', 'HTML là viết tắt của gì?', 'HyperText Markup Language', 'High-Tech Markup Language', 'HyperText Machine Language', 'Hyperlink Text Markup Language', 'a', 'easy', 'HTML'),
  ('row_2', 'CSS dùng để làm gì?', 'Xử lý logic', 'Định dạng giao diện trang web', 'Kết nối database', 'Tạo server', 'b', 'easy', 'CSS'),
  ('row_3', 'JavaScript chạy ở đâu?', 'Chỉ server', 'Chỉ browser', 'Cả browser và server (Node.js)', 'Chỉ mobile', 'c', 'medium', 'JavaScript'),
  ('row_4', 'HTTP status code 404 nghĩa là gì?', 'Server lỗi', 'Không tìm thấy trang', 'Redirect', 'Unauthorized', 'b', 'easy', 'Web'),
  ('row_5', 'React là gì?', 'Framework CSS', 'Database ORM', 'Thư viện JavaScript cho UI', 'Backend framework', 'c', 'easy', 'React')
ON CONFLICT (sheet_row_id) DO NOTHING;
