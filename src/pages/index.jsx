import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase, signUp, signInWithUsername, getProfile } from '../lib/supabase';
import { useLanguage } from '../contexts/LanguageContext';
import LanguageSelector from '../components/LanguageSelector';
import styles from '../styles/auth.module.css';

export default function LoginPage() {
  const router = useRouter();
  const { t } = useLanguage();
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
        alert(t('register_success'));
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
    <div className={styles.container}>
      <div className={styles.background}>
        <div className={styles.overlay}></div>
      </div>
      
      <div className={styles.card}>
        <div className={styles.cardInner}>
          <div className={styles.header}>
            <div className={styles.logo}>
              <div className={styles.logoIcon}>📘</div>
              <h1 className={styles.logoText}>{t('app_name')}</h1>
            </div>
            <p className={styles.subtitle}>ExamFlow - {t('sign_in')}</p>
          </div>

          {/* Language Selector */}
          <div className={styles.languageWrapper}>
            <LanguageSelector />
          </div>

          <div className={styles.tabs}>
            <button
              className={`${styles.tab} ${mode === 'login' ? styles.activeTab : ''}`}
              onClick={() => { setMode('login'); setError(''); }}
            >
              {t('sign_in')}
            </button>
            <button
              className={`${styles.tab} ${mode === 'register' ? styles.activeTab : ''}`}
              onClick={() => { setMode('register'); setError(''); }}
            >
              {t('sign_up')}
            </button>
          </div>

          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.inputGroup}>
              <div className={styles.inputIcon}>👤</div>
              <input
                type="text"
                className={styles.input}
                placeholder={t('enter_username')}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>

            <div className={styles.inputGroup}>
              <div className={styles.inputIcon}>🔒</div>
              <input
                type="password"
                className={styles.input}
                placeholder={t('enter_password')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {mode === 'register' && (
              <div className={styles.inputGroup}>
                <div className={styles.inputIcon}>📝</div>
                <input
                  type="text"
                  className={styles.input}
                  placeholder={t('enter_fullname')}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>
            )}

            {mode === 'login' && (
              <div className={styles.forgotPassword}>
                <a href="#" onClick={(e) => e.preventDefault()}>{t('forgot_password')}</a>
              </div>
            )}

            {error && <div className={styles.error}>{error}</div>}

            <button type="submit" className={styles.submitBtn} disabled={loading}>
              {loading ? <div className={styles.spinner}></div> : (mode === 'login' ? t('sign_in') : t('sign_up'))}
            </button>
          </form>

          <div className={styles.footer}>
            {mode === 'login' ? (
              <p>
                {t('no_account')}{' '}
                <button
                  className={styles.switchBtn}
                  onClick={() => { setMode('register'); setError(''); }}
                >
                  {t('sign_up_now')}
                </button>
              </p>
            ) : (
              <p>
                {t('has_account')}{' '}
                <button
                  className={styles.switchBtn}
                  onClick={() => { setMode('login'); setError(''); }}
                >
                  {t('sign_in_now')}
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
