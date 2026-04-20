import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase, signUp, signInWithUsername, getProfile } from '../lib/supabase';
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

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await signInWithUsername(username, password);
        const { data: { user } } = await supabase.auth.getUser();
        const profile = await getProfile(user.id);
        if (profile?.role === 'admin') router.replace('/admin');
        else router.replace('/exam');
      } else {
        await signUp(username, password, fullName);
        alert('Đăng ký thành công! Bạn có thể đăng nhập ngay.');
        setMode('login');
        setUsername('');
        setPassword('');
        setFullName('');
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
        <div className={styles.brand}>
          <div className={styles.brandIcon}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="8" fill="#1a1a2e"/>
              <path d="M8 10h16M8 16h10M8 22h13" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
          </div>
          <h1 className={styles.brandName}>ExamFlow</h1>
        </div>
        <h2 className={styles.title}>{mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}</h2>
        <p className={styles.subtitle}>
          {mode === 'login' ? 'Nhập tên đăng nhập và mật khẩu' : 'Điền thông tin để tạo tài khoản'}
        </p>
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label className={styles.label}>Tên đăng nhập</label>
            <input
              className={styles.input}
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Ví dụ: nguyenvana"
              required
              autoComplete="username"
            />
          </div>
          {mode === 'register' && (
            <div className={styles.field}>
              <label className={styles.label}>Họ và tên</label>
              <input
                className={styles.input}
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Nguyễn Văn A"
                required
              />
            </div>
          )}
          <div className={styles.field}>
            <label className={styles.label}>Mật khẩu</label>
            <input
              className={styles.input}
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={6}
            />
          </div>
          {error && <div className={styles.error}>{error}</div>}
          <button className={styles.btn} type="submit" disabled={loading}>
            {loading ? <span className={styles.spinner} /> : (mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản')}
          </button>
        </form>
        <p className={styles.switchMode}>
          {mode === 'login' ? 'Chưa có tài khoản?' : 'Đã có tài khoản?'}
          {' '}
          <button
            className={styles.link}
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
          >
            {mode === 'login' ? 'Đăng ký ngay' : 'Đăng nhập'}
          </button>
        </p>
      </div>
    </div>
  );
}
