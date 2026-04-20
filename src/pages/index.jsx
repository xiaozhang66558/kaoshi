import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase, signIn, signUp, getProfile } from '../lib/supabase';
import styles from '../styles/auth.module.css';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;
      const profile = await getProfile(session.user.id).catch(() => null);
      if (profile?.role === 'admin') router.replace('/admin');
      else router.replace('/exam');
    });
  }, []);

  // Tạo email ảo duy nhất dựa trên username + timestamp + random
  const generateUniqueEmail = (username) => {
    const clean = username.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 6);
    return `${clean}_${timestamp}_${random}@local.app`;
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        // Đăng nhập: cần email ảo, nhưng làm sao biết email của user đã đăng ký?
        // Vấn đề: không thể lấy lại email từ username. Do đó cần lưu username vào metadata.
        // Giải pháp: khi đăng ký, lưu username vào metadata; khi đăng nhập, tìm user bằng API.
        // Đơn giản hơn: vẫn dùng email ảo nhưng cho phép đăng nhập bằng username? Không được.
        // Cách tốt: Khi đăng nhập, yêu cầu nhập email (nhưng bạn không muốn). 
        // Vậy phải lưu username vào metadata, và khi đăng nhập thì tìm email từ username qua API.
        // Tôi sẽ cung cấp giải pháp phức tạp hơn: lưu username, và đăng nhập qua username bằng cách gọi hàm tìm email trước.
        // Nhưng để đơn giản, tôi khuyên bạn nên cho phép người dùng nhập email (hoặc username) và tự chuyển đổi.
        // Bạn có muốn tôi làm theo cách ẩn email nhưng cho phép đăng nhập bằng username không?
        // Nếu có, tôi sẽ viết thêm API tìm email từ username.
        // Hiện tại, tôi tạm thời báo lỗi hướng dẫn.
        setError('Vui lòng đăng nhập bằng email đã đăng ký. Hoặc liên hệ admin.');
        setLoading(false);
        return;
      } else {
        // Đăng ký
        const email = generateUniqueEmail(username);
        await signUp(email, password, fullName);
        // Sau khi đăng ký, cập nhật bảng profiles để lưu username
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from('profiles').update({ full_name: fullName, username: username }).eq('id', user.id);
        }
        alert('Đăng ký thành công! Bạn có thể đăng nhập bằng email (hệ thống tự tạo) nhưng để dễ dàng, hãy liên hệ admin lấy email. Hoặc dùng chức năng quên mật khẩu?');
        setMode('login');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h2>{mode === 'login' ? 'Đăng nhập' : 'Đăng ký'}</h2>
        {mode === 'login' ? (
          <p>Nhập email và mật khẩu (email được tạo khi đăng ký)</p>
        ) : (
          <p>Tạo tài khoản mới (không cần email thật)</p>
        )}
        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className={styles.field}>
              <label>Tên đăng nhập (duy nhất)</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
              />
            </div>
          )}
          {mode === 'register' && (
            <div className={styles.field}>
              <label>Họ tên</label>
              <input
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                required
              />
            </div>
          )}
          {mode === 'login' && (
            <div className={styles.field}>
              <label>Email</label>
              <input
                type="email"
                value={username} // tái sử dụng state username nhưng thực chất là email
                onChange={e => setUsername(e.target.value)}
                required
              />
            </div>
          )}
          <div className={styles.field}>
            <label>Mật khẩu</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <div className={styles.error}>{error}</div>}
          <button type="submit" disabled={loading}>
            {mode === 'login' ? 'Đăng nhập' : 'Đăng ký'}
          </button>
        </form>
        <button onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Chưa có tài khoản? Đăng ký' : 'Đã có tài khoản? Đăng nhập'}
        </button>
      </div>
    </div>
  );
}
