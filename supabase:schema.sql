-- ============================================================
-- HỆ THỐNG THI TRỰC TUYẾN - KHÔNG TỰ ĐỘNG CHẤM ĐIỂM
-- ============================================================

-- 1. PROFILES (giữ nguyên)
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name   TEXT,
  email       TEXT,
  role        TEXT DEFAULT 'student' CHECK (role IN ('student', 'admin')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

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

-- 2. QUESTIONS_CACHE (không có correct_answer)
CREATE TABLE IF NOT EXISTS questions_cache (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sheet_row_id    TEXT UNIQUE NOT NULL,
  question        TEXT NOT NULL,
  option_a        TEXT NOT NULL,
  option_b        TEXT NOT NULL,
  option_c        TEXT NOT NULL,
  option_d        TEXT NOT NULL,
  difficulty      TEXT DEFAULT 'medium' CHECK (difficulty IN ('easy','medium','hard')),
  topic           TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  synced_at       TIMESTAMPTZ DEFAULT NOW()
);

-- 3. EXAM_SESSIONS (thêm trường total_score)
CREATE TABLE IF NOT EXISTS exam_sessions (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           UUID REFERENCES auth.users(id) NOT NULL,
  question_ids      UUID[] NOT NULL,
  started_at        TIMESTAMPTZ DEFAULT NOW(),
  submitted_at      TIMESTAMPTZ,
  duration_minutes  INTEGER DEFAULT 30,
  score             INTEGER,                  -- tổng điểm sau khi admin chấm
  total_questions   INTEGER,
  total_possible_score INTEGER DEFAULT 0,    -- tổng điểm tối đa (mỗi câu 1 điểm)
  status            TEXT DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress','submitted','graded'))
);

-- 4. SUBMISSIONS (thêm cột score cho mỗi câu)
CREATE TABLE IF NOT EXISTS submissions (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id   UUID REFERENCES exam_sessions(id) ON DELETE CASCADE NOT NULL,
  question_id  UUID REFERENCES questions_cache(id) NOT NULL,
  user_answer  TEXT CHECK (user_answer IN ('a','b','c','d')),
  score        INTEGER DEFAULT 0,             -- điểm admin chấm cho câu này (0 hoặc 1)
  graded_by    UUID REFERENCES auth.users(id), -- ai chấm
  graded_at    TIMESTAMPTZ,
  answered_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, question_id)
);

-- RLS (giữ nguyên như cũ, chỉ thay tên bảng)
ALTER TABLE profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions     ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT role = 'admin' FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

-- Policies (tương tự, chỉ thêm cho cột score)
CREATE POLICY "Users see own profile"    ON profiles FOR SELECT USING (id = auth.uid() OR is_admin());
CREATE POLICY "Users update own profile" ON profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY "Admin manages profiles"   ON profiles FOR ALL    USING (is_admin());

CREATE POLICY "Anyone can read active questions"  ON questions_cache FOR SELECT USING (is_active = TRUE OR is_admin());
CREATE POLICY "Admin manages questions"           ON questions_cache FOR ALL    USING (is_admin());

CREATE POLICY "Students see own sessions"   ON exam_sessions FOR SELECT USING (user_id = auth.uid() OR is_admin());
CREATE POLICY "Students create own session" ON exam_sessions FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Students update own session" ON exam_sessions FOR UPDATE USING (user_id = auth.uid() AND status = 'in_progress');
CREATE POLICY "Admin sees all sessions"     ON exam_sessions FOR ALL    USING (is_admin());

CREATE POLICY "Students see own submissions"   ON submissions FOR SELECT USING (
  session_id IN (SELECT id FROM exam_sessions WHERE user_id = auth.uid()) OR is_admin()
);
CREATE POLICY "Students insert own answers"    ON submissions FOR INSERT WITH CHECK (
  session_id IN (SELECT id FROM exam_sessions WHERE user_id = auth.uid() AND status = 'in_progress')
);
CREATE POLICY "Students update own answers"    ON submissions FOR UPDATE USING (
  session_id IN (SELECT id FROM exam_sessions WHERE user_id = auth.uid() AND status = 'in_progress')
);
CREATE POLICY "Admin manages all submissions"  ON submissions FOR ALL    USING (is_admin());

-- FUNCTION: tạo session (giữ nguyên)
CREATE OR REPLACE FUNCTION create_exam_session(
  p_user_id         UUID,
  p_num_questions   INTEGER DEFAULT 20,
  p_duration_mins   INTEGER DEFAULT 30,
  p_topic           TEXT    DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_session_id    UUID;
  v_question_ids  UUID[];
BEGIN
  IF EXISTS (SELECT 1 FROM exam_sessions WHERE user_id = p_user_id AND status = 'in_progress') THEN
    RAISE EXCEPTION 'Bạn đang có bài thi chưa hoàn thành';
  END IF;
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
  INSERT INTO exam_sessions (user_id, question_ids, duration_minutes, total_questions, total_possible_score)
  VALUES (p_user_id, v_question_ids, p_duration_mins, p_num_questions, p_num_questions)
  RETURNING id INTO v_session_id;
  RETURN v_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- FUNCTION: nộp bài (không tự động chấm)
CREATE OR REPLACE FUNCTION submit_exam(p_session_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_user_id       UUID;
BEGIN
  SELECT user_id INTO v_user_id
  FROM exam_sessions WHERE id = p_session_id AND status = 'in_progress';
  IF v_user_id IS NULL OR v_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Không tìm thấy bài thi hoặc không có quyền';
  END IF;
  UPDATE exam_sessions
  SET status = 'submitted', submitted_at = NOW()
  WHERE id = p_session_id;
  RETURN jsonb_build_object('session_id', p_session_id, 'status', 'submitted');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- FUNCTION: admin chấm điểm từng câu và cập nhật tổng điểm
CREATE OR REPLACE FUNCTION grade_submission(
  p_submission_id UUID,
  p_score INTEGER
)
RETURNS VOID AS $$
DECLARE
  v_session_id UUID;
  v_total_score INTEGER;
BEGIN
  -- Cập nhật điểm cho câu trả lời
  UPDATE submissions
  SET score = p_score, graded_by = auth.uid(), graded_at = NOW()
  WHERE id = p_submission_id
  AND session_id IN (SELECT id FROM exam_sessions WHERE status = 'submitted');
  -- Lấy session_id
  SELECT session_id INTO v_session_id FROM submissions WHERE id = p_submission_id;
  -- Tính tổng điểm các câu đã được chấm trong session
  SELECT COALESCE(SUM(score), 0) INTO v_total_score
  FROM submissions WHERE session_id = v_session_id;
  -- Cập nhật tổng điểm vào exam_sessions
  UPDATE exam_sessions
  SET score = v_total_score,
      status = CASE WHEN v_total_score = total_possible_score THEN 'graded' ELSE status END
  WHERE id = v_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_exam_sessions_user_id  ON exam_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_exam_sessions_status   ON exam_sessions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_session_id ON submissions(session_id);
CREATE INDEX IF NOT EXISTS idx_questions_active       ON questions_cache(is_active, topic);

-- Dữ liệu mẫu (không có correct_answer)
INSERT INTO questions_cache (sheet_row_id, question, option_a, option_b, option_c, option_d, difficulty, topic)
VALUES
  ('row_1', 'HTML là viết tắt của gì?', 'HyperText Markup Language', 'High-Tech Markup Language', 'HyperText Machine Language', 'Hyperlink Text Markup Language', 'easy', 'HTML'),
  ('row_2', 'CSS dùng để làm gì?', 'Xử lý logic', 'Định dạng giao diện trang web', 'Kết nối database', 'Tạo server', 'easy', 'CSS'),
  ('row_3', 'JavaScript chạy ở đâu?', 'Chỉ server', 'Chỉ browser', 'Cả browser và server (Node.js)', 'Chỉ mobile', 'medium', 'JavaScript')
ON CONFLICT (sheet_row_id) DO NOTHING;