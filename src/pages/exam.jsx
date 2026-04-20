import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import {
  supabase, getProfile, getActiveSession, createExamSession,
  getSessionWithQuestions, saveAnswer, getAnswers, submitExam
} from '../lib/supabase';
import styles from '../styles/exam.module.css';

const OPTION_LABELS = { a: 'A', b: 'B', c: 'C', d: 'D' };

export default function ExamPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [phase, setPhase] = useState('loading'); // loading | start | exam | result
  const [session, setSession] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      if (!s) { router.replace('/'); return; }
      const profile = await getProfile(s.user.id).catch(() => null);
      if (profile?.role === 'admin') { router.replace('/admin'); return; }
      setUser({ ...s.user, profile });
      const active = await getActiveSession().catch(() => null);
      if (active) {
        await loadSession(active);
      } else {
        setPhase('start');
      }
    });
  }, []);

  useEffect(() => {
    if (phase !== 'exam' || timeLeft <= 0) return;
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          handleSubmit(true);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [phase]);

  async function loadSession(s) {
    const { session: sess, questions: qs } = await getSessionWithQuestions(s.id);
    const savedAnswers = await getAnswers(s.id);
    const elapsed = Math.floor((Date.now() - new Date(sess.started_at).getTime()) / 1000);
    const remaining = Math.max(0, sess.duration_minutes * 60 - elapsed);
    setSession(sess);
    setQuestions(qs);
    setAnswers(savedAnswers);
    setTimeLeft(remaining);
    setPhase('exam');
  }

  async function handleStart() {
    setPhase('loading');
    try {
      await createExamSession({ numQuestions: 20, durationMins: 30 });
      const active = await getActiveSession();
      await loadSession(active);
    } catch (err) {
      alert(err.message);
      setPhase('start');
    }
  }

  const handleAnswer = useCallback(async (questionId, answer) => {
    setAnswers(prev => ({ ...prev, [questionId]: answer }));
    setSaving(true);
    try {
      await saveAnswer(session.id, questionId, answer);
    } catch (e) {
      console.error('Lỗi lưu câu trả lời:', e);
    } finally {
      setSaving(false);
    }
  }, [session]);

  async function handleSubmit(auto = false) {
    if (!auto && !confirm('Bạn có chắc muốn nộp bài không?')) return;
    clearInterval(timerRef.current);
    setSubmitting(true);
    try {
      await submitExam(session.id);
      setPhase('result');
    } catch (err) {
      alert(err.message);
      setSubmitting(false);
    }
  }

  const formatTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const answeredCount = Object.keys(answers).length;
  const q = questions[current];

  // ─── RENDER CÁC MÀN HÌNH DỰA VÀO phase ─────────────────
  if (phase === 'loading') {
    return (
      <div className={styles.center}>
        <div className={styles.spinner} />
        <p className={styles.loadingText}>Đang tải...</p>
      </div>
    );
  }

  if (phase === 'start') {
    return (
      <div className={styles.center}>
        <div className={styles.startCard}>
          <div className={styles.startIcon}>📋</div>
          <h1 className={styles.startTitle}>Sẵn sàng làm bài thi?</h1>
          <div className={styles.startInfo}>
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>Số câu hỏi</span>
              <span className={styles.infoValue}>20 câu</span>
            </div>
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>Thời gian</span>
              <span className={styles.infoValue}>30 phút</span>
            </div>
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>Câu hỏi random</span>
              <span className={styles.infoValue}>Mỗi người một đề</span>
            </div>
          </div>
          <p className={styles.startNote}>
            ⚠️ Sau khi bắt đầu, đồng hồ sẽ chạy. Câu trả lời được lưu tự động.
          </p>
          <button className={styles.startBtn} onClick={handleStart}>
            Bắt đầu làm bài
          </button>
          <button
            className={styles.logoutLink}
            onClick={async () => {
              await supabase.auth.signOut();
              router.replace('/');
            }}
          >
            Đăng xuất
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'result') {
    return (
      <div className={styles.center}>
        <div className={styles.resultCard}>
          <div className={styles.pendingIcon}>📝</div>
          <h2 className={styles.resultTitle}>Bài thi đã được nộp!</h2>
          <p className={styles.resultStat}>
            Cảm ơn bạn đã hoàn thành bài thi.<br />
            Kết quả sẽ được admin chấm điểm và cập nhật sau.
          </p>
          <button
            className={styles.startBtn}
            onClick={() => {
              supabase.auth.signOut();
              router.replace('/');
            }}
          >
            Về trang chủ
          </button>
        </div>
      </div>
    );
  }

  if (!q) return null;
  const isLow = timeLeft < 300;

  return (
    <div className={styles.examPage}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.logo}>ExamFlow</span>
          <span className={styles.progress}>
            {answeredCount}/{questions.length} đã trả lời
          </span>
          {saving && <span className={styles.saving}>Đang lưu...</span>}
        </div>
        <div className={`${styles.timer} ${isLow ? styles.timerLow : ''}`}>
          ⏱ {formatTime(timeLeft)}
        </div>
        <button
          className={styles.submitBtn}
          onClick={() => handleSubmit(false)}
          disabled={submitting}
        >
          {submitting ? 'Đang nộp...' : 'Nộp bài'}
        </button>
      </header>

      <div className={styles.examBody}>
        <main className={styles.questionPanel}>
          <div className={styles.questionMeta}>
            <span className={styles.qNumber}>Câu {current + 1} / {questions.length}</span>
            {q.topic && <span className={styles.qTopic}>{q.topic}</span>}
            <span className={`${styles.qDiff} ${styles[q.difficulty]}`}>{q.difficulty}</span>
          </div>

          <p className={styles.questionText}>{q.question}</p>

          <div className={styles.options}>
            {['a', 'b', 'c', 'd'].map(opt => (
              <button
                key={opt}
                className={`${styles.option} ${answers[q.id] === opt ? styles.selected : ''}`}
                onClick={() => handleAnswer(q.id, opt)}
              >
                <span className={styles.optLabel}>{OPTION_LABELS[opt]}</span>
                <span className={styles.optText}>{q[`option_${opt}`]}</span>
              </button>
            ))}
          </div>

          <div className={styles.nav}>
            <button
              className={styles.navBtn}
              onClick={() => setCurrent(c => Math.max(0, c - 1))}
              disabled={current === 0}
            >
              ← Câu trước
            </button>
            <button
              className={`${styles.navBtn} ${styles.navNext}`}
              onClick={() => setCurrent(c => Math.min(questions.length - 1, c + 1))}
              disabled={current === questions.length - 1}
            >
              Câu tiếp →
            </button>
          </div>
        </main>

        <aside className={styles.sidebar}>
          <p className={styles.sidebarTitle}>Danh sách câu hỏi</p>
          <div className={styles.qMap}>
            {questions.map((question, idx) => (
              <button
                key={question.id}
                className={`${styles.qMapBtn} ${idx === current ? styles.qMapCurrent : ''} ${answers[question.id] ? styles.qMapAnswered : ''}`}
                onClick={() => setCurrent(idx)}
              >
                {idx + 1}
              </button>
            ))}
          </div>
          <div className={styles.legend}>
            <span><span className={`${styles.dot} ${styles.dotAnswered}`} />Đã trả lời</span>
            <span><span className={`${styles.dot} ${styles.dotCurrent}`} />Đang xem</span>
            <span><span className={styles.dot} />Chưa trả lời</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
