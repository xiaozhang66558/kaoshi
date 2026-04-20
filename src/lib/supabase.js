import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Kiểm tra và log lỗi nhưng không throw (để build không crash)
if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

// Tạo client chỉ khi có đủ env
export const supabase = (supabaseUrl && supabaseAnonKey) 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Helper kiểm tra supabase có sẵn sàng không
function checkSupabase() {
  if (!supabase) {
    throw new Error('Supabase client not initialized. Check environment variables.');
  }
  return supabase;
}

// ========== AUTH ==========
export async function signUp(username, password, fullName) {
  const client = checkSupabase();
  const random = Math.random().toString(36).substring(2, 8);
  const email = `${username}_${random}@local.app`;
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName, username: username } },
  });
  if (error) throw error;
  if (data.user) {
    await client.from('profiles').update({ username: username }).eq('id', data.user.id);
  }
  return data;
}

export async function signInWithUsername(username, password) {
  const client = checkSupabase();
  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('email')
    .eq('username', username)
    .single();
  if (profileError || !profile) throw new Error('Tên đăng nhập không tồn tại');
  const { data, error } = await client.auth.signInWithPassword({
    email: profile.email,
    password: password,
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function getProfile(userId) {
  const client = checkSupabase();
  const { data, error } = await client
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

// ========== EXAM ==========
export async function createExamSession({ numQuestions = 10, durationMins = 30, series = null, position = null } = {}) {
  const client = checkSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('Chưa đăng nhập');

  const { data: existing, error: checkErr } = await client
    .from('exam_sessions')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'in_progress')
    .maybeSingle();
  if (existing) throw new Error('Bạn đang có bài thi chưa hoàn thành');

  let query = client.from('questions_cache').select('id').eq('is_active', true);
  if (series) query = query.eq('series', series);
  if (position) query = query.eq('position', position);
  
  const { data: questions, error: qErr } = await query;
  if (qErr) throw qErr;
  if (!questions || questions.length < numQuestions) {
    throw new Error(`Không đủ câu hỏi (cần ${numQuestions}, có ${questions?.length || 0})`);
  }
  
  const shuffled = [...questions];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const selectedIds = shuffled.slice(0, numQuestions).map(q => q.id);

  const { data: session, error: insertErr } = await client
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
  const client = checkSupabase();
  const { data, error } = await client
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
  const client = checkSupabase();
  const { data: session, error: sErr } = await client
    .from('exam_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();
  if (sErr) throw sErr;
  const { data: questions, error: qErr } = await client
    .from('questions_cache')
    .select('*')
    .in('id', session.question_ids);
  if (qErr) throw qErr;
  const ordered = session.question_ids.map(id => questions.find(q => q.id === id)).filter(Boolean);
  return { session, questions: ordered };
}

export async function saveAnswer(sessionId, questionId, userAnswer, imageUrls = []) {
  const client = checkSupabase();
  const { error } = await client
    .from('submissions')
    .upsert(
      { session_id: sessionId, question_id: questionId, user_answer: userAnswer, image_urls: imageUrls },
      { onConflict: 'session_id,question_id' }
    );
  if (error) throw error;
}

export async function getAnswers(sessionId) {
  const client = checkSupabase();
  const { data, error } = await client
    .from('submissions')
    .select('question_id, user_answer, image_urls')
    .eq('session_id', sessionId);
  if (error) throw error;
  const result = {};
  data.forEach(s => {
    result[s.question_id] = { text: s.user_answer || '', images: s.image_urls || [] };
  });
  return result;
}

export async function submitExam(sessionId) {
  const client = checkSupabase();
  const { data, error } = await client.rpc('submit_exam', { p_session_id: sessionId });
  if (error) throw error;
  return data;
}

// ========== ADMIN ==========
export async function getAllSessions({ page = 1, limit = 20 } = {}) {
  const from = (page - 1) * limit;
  
  // Lấy session trước
  const { data: sessions, error, count } = await supabase
    .from('exam_sessions')
    .select('*', { count: 'exact' })
    .neq('status', 'in_progress')
    .order('submitted_at', { ascending: false })
    .range(from, from + limit - 1);
  if (error) throw error;
  
  // Lấy profiles riêng
  const userIds = [...new Set(sessions.map(s => s.user_id))];
  if (userIds.length > 0) {
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, email, username')
      .in('id', userIds);
    if (!profileError) {
      const profileMap = Object.fromEntries(profiles.map(p => [p.id, p]));
      sessions.forEach(s => {
        s.profiles = profileMap[s.user_id] || null;
      });
    }
  }
  
  return { data: sessions, count };
}

export async function getSessionDetail(sessionId) {
  // Lấy session
  const { data: session, error: sErr } = await supabase
    .from('exam_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();
  if (sErr) throw sErr;
  
  // Lấy profiles riêng
  const { data: profile, error: pErr } = await supabase
    .from('profiles')
    .select('full_name, email, username')
    .eq('id', session.user_id)
    .single();
  if (!pErr && profile) {
    session.profiles = profile;
  }
  
  // Lấy submissions
  const { data: subs, error: subErr } = await supabase
    .from('submissions')
    .select(`*, questions_cache (*)`)
    .eq('session_id', sessionId)
    .order('answered_at');
  if (subErr) throw subErr;
  
  return { session, submissions: subs };
}

export async function getSubmittedSessions() {
  const { data, error } = await supabase
    .from('exam_sessions')
    .select('*')
    .eq('status', 'submitted')
    .order('submitted_at', { ascending: false });
  if (error) throw error;
  
  // Lấy thông tin profiles cho từng session
  const userIds = [...new Set(data.map(s => s.user_id))];
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, full_name, email, username')
    .in('id', userIds);
  if (profileError) throw profileError;
  
  // Ghép dữ liệu
  const profileMap = Object.fromEntries(profiles.map(p => [p.id, p]));
  const result = data.map(session => ({
    ...session,
    profiles: profileMap[session.user_id] || null
  }));
  
  return result;
}

export async function gradeSubmission(submissionId, score) {
  const client = checkSupabase();
  const { error } = await client.rpc('grade_submission', {
    p_submission_id: submissionId,
    p_score: score,
  });
  if (error) throw error;
}
