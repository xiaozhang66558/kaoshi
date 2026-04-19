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

-- 2. BẢNG QUESTIONS_CACHE
CREATE TABLE IF NOT EXISTS questions_cache (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sheet_row_id    TEXT UNIQUE NOT NULL,
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

-- 3. BẢNG EXAM_SESSIONS
CREATE TABLE IF NOT EXISTS exam_sessions (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           UUID REFERENCES auth.users(id) NOT NULL,
  question_ids      UUID[] NOT NULL,
  started_at        TIMESTAMPTZ DEFAULT NOW(),
  submitted_at      TIMESTAMPTZ,
  duration_minutes  INTEGER DEFAULT 30,
  score             INTEGER,
  total_questions   INTEGER,
  correct_count     INTEGER,
  status            TEXT DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress','submitted','graded'))
);

-- 4. BẢNG SUBMISSIONS
CREATE TABLE IF NOT EXISTS submissions (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id   UUID REFERENCES exam_sessions(id) ON DELETE CASCADE NOT NULL,
  question_id  UUID REFERENCES questions_cache(id) NOT NULL,
  user_answer  TEXT CHECK (user_answer IN ('a','b','c','d')),
  is_correct   BOOLEAN,
  answered_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, question_id)
);

-- RLS Policies (giữ nguyên như bạn đã viết, tôi lược bớt để dài quá)
-- ... (bạn đã có đầy đủ trong file gốc)

-- FUNCTION: create_exam_session
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
  INSERT INTO exam_sessions (user_id, question_ids, duration_minutes, total_questions)
  VALUES (p_user_id, v_question_ids, p_duration_mins, p_num_questions)
  RETURNING id INTO v_session_id;
  RETURN v_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- FUNCTION: submit_exam
CREATE OR REPLACE FUNCTION submit_exam(p_session_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_user_id       UUID;
  v_correct       INTEGER;
  v_total         INTEGER;
  v_score         INTEGER;
BEGIN
  SELECT user_id INTO v_user_id
  FROM exam_sessions WHERE id = p_session_id AND status = 'in_progress';
  IF v_user_id IS NULL OR v_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Không tìm thấy bài thi hoặc không có quyền';
  END IF;
  UPDATE submissions s
  SET is_correct = (s.user_answer = q.correct_answer)
  FROM questions_cache q
  WHERE s.question_id = q.id AND s.session_id = p_session_id;
  SELECT COUNT(*) FILTER (WHERE is_correct = TRUE), COUNT(*)
  INTO v_correct, v_total
  FROM submissions WHERE session_id = p_session_id;
  v_score := ROUND((v_correct::NUMERIC / NULLIF(v_total, 0)) * 100);
  UPDATE exam_sessions
  SET status = 'graded', submitted_at = NOW(), correct_count = v_correct, score = v_score
  WHERE id = p_session_id;
  RETURN jsonb_build_object('session_id', p_session_id, 'score', v_score, 'correct', v_correct, 'total', v_total);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Indexes (bạn đã có)
-- Sample data (bạn đã có)