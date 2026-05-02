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
  try {
    console.log('1. Đang tìm username:', username);
    
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, email, username, role')
      .eq('username', username);
    
    console.log('2. Kết quả tìm profiles:', profiles);
    
    if (profileError) {
      console.error('3. Lỗi:', profileError);
      throw new Error('Lỗi truy vấn: ' + profileError.message);
    }
    
    if (!profiles || profiles.length === 0) {
      console.log('4. Không tìm thấy username');
      throw new Error('Tên đăng nhập không tồn tại');
    }
    
    const profile = profiles[0];
    console.log('5. Tìm thấy profile:', profile);
    
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: profile.email,
      password: password,
    });
    
    if (authError) {
      console.error('6. Lỗi đăng nhập:', authError);
      throw new Error('Sai mật khẩu');
    }
    
    console.log('7. Đăng nhập thành công!');
    return authData;
    
  } catch (err) {
    console.error('SignIn error:', err);
    throw err;
  }
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  return true;
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
export async function saveAnswer(sessionId, questionId, userAnswer, imageUrls = []) {
  console.log('Saving answer:', { sessionId, questionId, userAnswer, imageUrls });
  const { error } = await supabase
    .from('submissions')
    .upsert(
      { 
        session_id: sessionId, 
        question_id: questionId, 
        user_answer: userAnswer, 
        image_urls: imageUrls,
        answered_at: new Date().toISOString()
      },
      { onConflict: 'session_id,question_id' }
    );
  if (error) {
    console.error('Save answer error:', error);
    throw error;
  }
  console.log('Save answer success');
}

export async function createExamSession({ durationMins = 30, series = null, position = null } = {}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Chưa đăng nhập');

  const { data: existing } = await supabase
    .from('exam_sessions')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'in_progress')
    .maybeSingle();
  if (existing) throw new Error('Bạn đang có bài thi chưa hoàn thành');

  let query = supabase.from('questions_cache').select('id, score').eq('is_active', true);
  if (series) query = query.eq('series', series);
  if (position) query = query.eq('position', position);
  
  const { data: allQuestions, error: qErr } = await query;
  if (qErr) throw qErr;
  if (!allQuestions || allQuestions.length === 0) {
    throw new Error('Không có câu hỏi nào trong ngân hàng');
  }
  
  const questionsByScore = {
    5: allQuestions.filter(q => q.score === 5),
    10: allQuestions.filter(q => q.score === 10),
    20: allQuestions.filter(q => q.score === 20)
  };
  
  const targetCounts = {
    5: 10,
    10: 3,
    20: 1
  };
  
  for (const [score, count] of Object.entries(targetCounts)) {
    if (questionsByScore[score].length < count) {
      throw new Error(`Không đủ câu hỏi ${score} điểm (cần ${count}, có ${questionsByScore[score].length})`);
    }
  }
  
  function getRandomItems(arr, n) {
    const shuffled = [...arr];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, n);
  }
  
  const selected5 = getRandomItems(questionsByScore[5], targetCounts[5]);
  const selected10 = getRandomItems(questionsByScore[10], targetCounts[10]);
  const selected20 = getRandomItems(questionsByScore[20], targetCounts[20]);
  
  const allSelected = [...selected5, ...selected10, ...selected20];
  for (let i = allSelected.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allSelected[i], allSelected[j]] = [allSelected[j], allSelected[i]];
  }
  
  const selectedIds = allSelected.map(q => q.id);
  const totalQuestions = selectedIds.length;
  const totalScore = allSelected.reduce((sum, q) => sum + q.score, 0);
  
  console.log(`Tạo đề thi: ${totalQuestions} câu, tổng điểm ${totalScore}`);
  
  const { data: session, error: insertErr } = await supabase
    .from('exam_sessions')
    .insert({
      user_id: user.id,
      question_ids: selectedIds,
      duration_minutes: durationMins,
      total_questions: totalQuestions,
      status: 'in_progress',
      series: series,
      position: position
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
    .select('id, question_en, question_zh, question_vi, image_1, image_2, image_3, option_a, option_b, option_c, option_d, topic, difficulty, score, series, position')
    .in('id', session.question_ids);
  if (qErr) throw qErr;
  
  const ordered = session.question_ids.map(id => questions.find(q => q.id === id)).filter(Boolean);
  return { session, questions: ordered };
}

export async function getAnswers(sessionId) {
  const { data, error } = await supabase
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
  const { data, error } = await supabase.rpc('submit_exam', { p_session_id: sessionId });
  if (error) throw error;
  return data;
}

// ========== ADMIN ==========
export async function getAllSessions({ page = 1, limit = 20 } = {}) {
  const from = (page - 1) * limit;
  
  const { data: sessions, error, count } = await supabase
    .from('exam_sessions')
    .select('*, graded_by', { count: 'exact' })
    .neq('status', 'in_progress')
    .order('submitted_at', { ascending: false })
    .range(from, from + limit - 1);
  if (error) throw error;
  
  const userIds = [...new Set(sessions.map(s => s.user_id).filter(Boolean))];
  const graderIds = [...new Set(sessions.map(s => s.graded_by).filter(Boolean))];
  const allIds = [...new Set([...userIds, ...graderIds])];
  
  if (allIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, email, username')
      .in('id', allIds);
    if (profiles) {
      const profileMap = Object.fromEntries(profiles.map(p => [p.id, p]));
      sessions.forEach(s => {
        s.profiles = profileMap[s.user_id] || null;
        s.grader_profile = profileMap[s.graded_by] || null;
      });
    }
  }
  
  return { data: sessions, count };
}

export async function getSessionDetail(sessionId) {
  try {
    // 1. Lấy session
    const { data: session, error: sessionError } = await supabase
      .from('exam_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();
    
    if (sessionError) throw sessionError;
    
    // 2. Lấy submissions
    const { data: submissions, error: subError } = await supabase
      .from('submissions')
      .select('*')
      .eq('session_id', sessionId);
    
    if (subError) throw subError;
    
    // 3. Lấy questions (nếu có)
    const questionIds = session.question_ids || [];
    let questions = [];
    
    if (questionIds.length > 0) {
      const { data: qData } = await supabase
        .from('questions_cache')
        .select('*')
        .in('id', questionIds);
      
      if (qData && qData.length > 0) {
        questions = qData;
      }
    }
    
    // 4. Ghép submissions với questions (tạo dữ liệu ảo nếu không có)
    const submissionsWithQuestions = submissions.map(sub => {
      const question = questions.find(q => q.id === sub.question_id);
      
      // Nếu không tìm thấy câu hỏi, tạo object ảo
      const fakeQuestion = {
        id: sub.question_id,
        question_vi: '📝 Bài thi từ phiên bản cũ (nội dung đã được cập nhật)',
        question_en: 'Old exam version (content has been updated)',
        question_zh: '旧版本考试（内容已更新）',
        score: 10,
        image_1: null,
        image_2: null,
        image_3: null
      };
      
      return {
        ...sub,
        questions_cache: question || fakeQuestion
      };
    });
    
    return {
      session,
      submissions: submissionsWithQuestions
    };
  } catch (err) {
    console.error('getSessionDetail error:', err);
    throw err;
  }
}

// ========== GRADE SUBMISSION (THÊM MỚI) ==========
export async function gradeSubmission(submissionId, score) {
  // Cập nhật điểm cho submission
  const { error: gradeError } = await supabase
    .from('submissions')
    .update({
      score: score,
      graded_at: new Date().toISOString()
    })
    .eq('id', submissionId);
  
  if (gradeError) throw gradeError;
  
  // Lấy session_id từ submission vừa chấm
  const { data: submission, error: getSubError } = await supabase
    .from('submissions')
    .select('session_id')
    .eq('id', submissionId)
    .single();
  
  if (getSubError) throw getSubError;
  
  // Tính tổng điểm của tất cả submissions trong session
  const { data: allSubmissions, error: getAllError } = await supabase
    .from('submissions')
    .select('score')
    .eq('session_id', submission.session_id);
  
  if (getAllError) throw getAllError;
  
  const totalScore = allSubmissions.reduce((sum, s) => sum + (s.score || 0), 0);
  
  // Cập nhật tổng điểm cho session
  const { data: { user } } = await supabase.auth.getUser();
  
  const { error: updateSessionError } = await supabase
    .from('exam_sessions')
    .update({
      score: totalScore,
      status: 'graded',
      graded_by: user?.id,
      graded_at: new Date().toISOString()
    })
    .eq('id', submission.session_id);
  
  if (updateSessionError) throw updateSessionError;
  
  return { totalScore };
}

// ========== FEEDBACK ==========
export async function saveFeedback(submissionId, feedback, feedbackImages = []) {
  const { error } = await supabase
    .from('submissions')
    .update({
      feedback: feedback,
      feedback_images: feedbackImages
    })
    .eq('id', submissionId);
  if (error) throw error;
}
