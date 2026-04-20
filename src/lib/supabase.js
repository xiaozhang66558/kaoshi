import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ========== AUTH ==========
export async function signUp(username, password, fullName) {
  const random = Math.random().toString(36).substring(2, 8);
  const email = `${username}_${random}@local.app`;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName, username: username } },
  });
  if (error) throw error;
  if (data.user) {
    await supabase.from('profiles').update({ username: username }).eq('id', data.user.id);
  }
  return data;
}

export async function signInWithUsername(username, password) {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('email')
    .eq('username', username)
    .single();
  if (profileError || !profile) throw new Error('Tên đăng nhập không tồn tại');
  const { data, error } = await supabase.auth.signInWithPassword({
    email: profile.email,
    password: password,
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

// ========== EXAM ==========
// Hàm tạo session mới, xử lý hoàn toàn trong code (không dùng RPC)
export async function createExamSession({ numQuestions = 10, durationMins = 30, series = null, position = null } = {}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Chưa đăng nhập');

  // Kiểm tra đã có session in_progress chưa
  const { data: existing, error: checkErr } = await supabase
    .from('exam_sessions')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'in_progress')
    .maybeSingle();
  if (existing) throw new Error('Bạn đang có bài thi chưa hoàn thành');

  // Lấy danh sách câu hỏi theo series/position
  let query = supabase.from('questions_cache').select('id').eq('is_active', true);
  if (series) query = query.eq('series', series);
  if (position) query = query.eq('position', position);
  
  const { data: questions, error: qErr } = await query;
  if (qErr) throw qErr;
  if (!questions || questions.length < numQuestions) {
    throw new Error(`Không đủ câu hỏi (cần ${numQuestions}, có ${questions?.length || 0})`);
  }
  
  // Random chọn numQuestions câu
  const shuffled = [...questions];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const selectedIds = shuffled.slice(0, numQuestions).map(q => q.id);

  // Tạo session mới
  const { data: session, error: insertErr } = await supabase
    .from('exam_sessions')
    .insert({
      user_id: user.id,
      question_ids: selectedIds,
      duration_minutes: durationMins,
      total_questions: numQuestions,
      status: 'in_progress'
    })
    .select()
    .single();

  if (insertErr) throw insertErr;
  return session.id;
}

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

export async function getSessionWithQuestions(sessionId) {
  const { data: session, error: sErr } = await supabase
    .from('exam_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();
  if (sErr) throw sErr;
  const { data: questions, error: qErr } = await supabase
    .from('questions_cache')
    .select('id, question, option_a, option_b, option_c, option_d, topic, difficulty, score, series, position')
    .in('id', session.question_ids);
  if (qErr) throw qErr;
  const ordered = session.question_ids.map(id => questions.find(q => q.id === id)).filter(Boolean);
  return { session, questions: ordered };
}

export async function saveAnswer(sessionId, questionId, userAnswer) {
  const { error } = await supabase
    .from('submissions')
    .upsert(
      { session_id: sessionId, question_id: questionId, user_answer: userAnswer },
      { onConflict: 'session_id,question_id' }
    );
  if (error) throw error;
}

export async function getAnswers(sessionId) {
  const { data, error } = await supabase
    .from('submissions')
    .select('question_id, user_answer')
    .eq('session_id', sessionId);
  if (error) throw error;
  return Object.fromEntries(data.map(s => [s.question_id, s.user_answer]));
}

export async function submitExam(sessionId) {
  // Nếu bạn vẫn dùng RPC submit_exam, giữ nguyên
  const { data, error } = await supabase.rpc('submit_exam', { p_session_id: sessionId });
  if (error) throw error;
  return data;
}

// ========== ADMIN ==========
export async function getAllSessions({ page = 1, limit = 20 } = {}) {
  const from = (page - 1) * limit;
  const { data, error, count } = await supabase
    .from('exam_sessions')
    .select(`*, profiles (full_name, email, username)`, { count: 'exact' })
    .neq('status', 'in_progress')
    .order('submitted_at', { ascending: false })
    .range(from, from + limit - 1);
  if (error) throw error;
  return { data, count };
}

export async function getSessionDetail(sessionId) {
  const { data: session, error: sErr } = await supabase
    .from('exam_sessions')
    .select('*, profiles (full_name, email, username)')
    .eq('id', sessionId)
    .single();
  if (sErr) throw sErr;
  const { data: subs, error: subErr } = await supabase
    .from('submissions')
    .select(`*, questions_cache (question, option_a, option_b, option_c, option_d, score, difficulty, series, position)`)
    .eq('session_id', sessionId)
    .order('answered_at');
  if (subErr) throw subErr;
  return { session, submissions: subs };
}

export async function getSubmittedSessions() {
  const { data, error } = await supabase
    .from('exam_sessions')
    .select('*, profiles(full_name, email, username)')
    .eq('status', 'submitted')
    .order('submitted_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function gradeSubmission(submissionId, score) {
  const { error } = await supabase.rpc('grade_submission', {
    p_submission_id: submissionId,
    p_score: score,
  });
  if (error) throw error;
}
