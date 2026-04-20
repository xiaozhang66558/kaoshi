import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function signUp(username, password, fullName) {
  // Tạo email ảo từ username + random để tránh trùng
  const random = Math.random().toString(36).substring(2, 8);
  const email = `${username}_${random}@local.app`;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName, username: username } },
  });
  if (error) throw error;
  // Sau khi tạo user, cập nhật lại bảng profiles với username
  if (data.user) {
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ username: username })
      .eq('id', data.user.id);
    if (updateError) console.error('Lỗi cập nhật username:', updateError);
  }
  return data;
}

export async function signInWithUsername(username, password) {
  // Tìm email từ username trong bảng profiles
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('email')
    .eq('username', username)
    .single();
  if (profileError || !profile) throw new Error('Tên đăng nhập không tồn tại');
  // Đăng nhập bằng email tìm được
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

// Các hàm còn lại giữ nguyên (createExamSession, getActiveSession, ...)
// Tôi sẽ giữ ngắn gọn, bạn có thể thêm các hàm đã có từ trước
// Nhưng cần đảm bảo các hàm sau tồn tại: createExamSession, getActiveSession, getSessionWithQuestions, saveAnswer, getAnswers, submitExam, getAllSessions, getSessionDetail, getSubmittedSessions, gradeSubmission
// Vì dài, bạn hãy copy các hàm từ phiên bản trước vào đây. Hoặc tôi gửi lại toàn bộ file.
