// src/lib/supabase.js
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// ── Auth helpers ─────────────────────────────────────────────

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp(email, password, fullName) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

// ── Exam helpers ─────────────────────────────────────────────

/** Tạo session thi mới, trả về session ID */
export async function createExamSession({ numQuestions = 20, durationMins = 30, topic = null } = {}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Chưa đăng nhập');

  const { data, error } = await supabase.rpc('create_exam_session', {
    p_user_id:       user.id,
    p_num_questions: numQuestions,
    p_duration_mins: durationMins,
    p_topic:         topic,
  });
  if (error) throw error;
  return data; // UUID của session mới
}

/** Lấy session đang in_progress của user hiện tại */
export async function getActiveSession() {
  const { data, error } = await supabase
    .from('exam_sessions')
    .select('*')
    .eq('status', 'in_progress')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Lấy chi tiết session + câu hỏi theo thứ tự đã random */
export async function getSessionWithQuestions(sessionId) {
  const { data: session, error: sErr } = await supabase
    .from('exam_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();
  if (sErr) throw sErr;

  const { data: questions, error: qErr } = await supabase
    .from('questions_cache')
    .select('id, question, option_a, option_b, option_c, option_d, topic, difficulty')
    // Lấy đúng thứ tự đã random khi tạo session
    .in('id', session.question_ids);
  if (qErr) throw qErr;

  // Sort theo thứ tự question_ids trong session
  const ordered = session.question_ids
    .map(id => questions.find(q => q.id === id))
    .filter(Boolean);

  return { session, questions: ordered };
}

/** Lưu câu trả lời (upsert) */
export async function saveAnswer(sessionId, questionId, userAnswer) {
  const { error } = await supabase
    .from('submissions')
    .upsert(
      { session_id: sessionId, question_id: questionId, user_answer: userAnswer },
      { onConflict: 'session_id,question_id' }
    );
  if (error) throw error;
}

/** Lấy tất cả câu trả lời đã lưu của session */
export async function getAnswers(sessionId) {
  const { data, error } = await supabase
    .from('submissions')
    .select('question_id, user_answer')
    .eq('session_id', sessionId);
  if (error) throw error;
  return Object.fromEntries(data.map(s => [s.question_id, s.user_answer]));
}

/** Nộp bài và chấm điểm */
export async function submitExam(sessionId) {
  const { data, error } = await supabase.rpc('submit_exam', {
    p_session_id: sessionId,
  });
  if (error) throw error;
  return data; // { score, correct, total }
}

// ── Admin helpers ─────────────────────────────────────────────

/** Admin: lấy tất cả sessions với thông tin user */
export async function getAllSessions({ page = 1, limit = 20 } = {}) {
  const from = (page - 1) * limit;
  const { data, error, count } = await supabase
    .from('exam_sessions')
    .select(`
      *,
      profiles (full_name, email)
    `, { count: 'exact' })
    .neq('status', 'in_progress')
    .order('submitted_at', { ascending: false })
    .range(from, from + limit - 1);
  if (error) throw error;
  return { data, count };
}

/** Admin: lấy chi tiết bài làm của 1 session (đáp án, đúng/sai) */
export async function getSessionDetail(sessionId) {
  const { data: session, error: sErr } = await supabase
    .from('exam_sessions')
    .select('*, profiles (full_name, email)')
    .eq('id', sessionId)
    .single();
  if (sErr) throw sErr;

  const { data: subs, error: subErr } = await supabase
    .from('submissions')
    .select(`
      *,
      questions_cache (question, option_a, option_b, option_c, option_d, correct_answer, topic)
    `)
    .eq('session_id', sessionId)
    .order('answered_at');
  if (subErr) throw subErr;

  return { session, submissions: subs };
}
