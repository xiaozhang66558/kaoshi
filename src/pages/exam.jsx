import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import {
  supabase, getProfile, getActiveSession, createExamSession,
  getSessionWithQuestions, saveAnswer, getAnswers, submitExam
} from '../lib/supabase';
import styles from '../styles/exam.module.css';

export default function ExamPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [phase, setPhase] = useState('loading'); // loading | select | exam | result
  const [session, setSession] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const timerRef = useRef(null);

  // State cho màn hình chọn series/position
  const [seriesList, setSeriesList] = useState([]);
  const [positionList, setPositionList] = useState([]);
  const [selectedSeries, setSelectedSeries] = useState('');
  const [selectedPosition, setSelectedPosition] = useState('');
  const [loadingOptions, setLoadingOptions] = useState(false);

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
        await loadFilterOptions();
        setPhase('select');
      }
    });
  }, []);

  // Lấy danh sách series và position từ database
  async function loadFilterOptions() {
    setLoadingOptions(true);
    try {
      const { data: seriesData } = await supabase
        .from('questions_cache')
        .select('series')
        .eq('is_active', true)
        .not('series', 'is', null);
      const uniqueSeries = [...new Set(seriesData.map(item => item.series).filter(Boolean))];
      setSeriesList(uniqueSeries);

      const { data: positionData } = await supabase
        .from('questions_cache')
        .select('position')
        .eq('is_active', true)
        .not('position', 'is', null);
      const uniquePositions = [...new Set(positionData.map(item => item.position).filter(Boolean))];
      setPositionList(uniquePositions);
    } catch (err) {
      console.error('Lỗi tải danh sách lọc:', err);
    } finally {
      setLoadingOptions(false);
    }
  }

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
    if (!selectedSeries || !selectedPosition) {
      alert('Vui lòng chọn Series và Position');
      return;
    }
    setPhase('loading');
    try {
      await createExamSession({
        numQuestions: 10,
        durationMins: 30,
        series: selectedSeries,
        position: selectedPosition
      });
      const active = await getActiveSession();
      await loadSession(active);
    } catch (err) {
      alert(err.message);
      setPhase('select');
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

  // ─── MÀN HÌNH LOADING ─────────────────
  if (phase === 'loading') {
    return (
      <div className={styles.center}>
        <div className={styles.spinner} />
        <p className={styles.loadingText}>Đang tải...</p>
      </div>
    );
  }

  // ─── MÀN HÌNH CHỌN SERIES & POSITION ─────────────────
  if (phase === 'select') {
    return (
      <div className={styles.center}>
        <div className={styles.startCard}>
          <div className={styles.startIcon}>📋</div>
          <h1 className={styles.startTitle}>Chọn bộ câu hỏi</h1>
          <div className={styles.selectGroup}>
            <label className={styles.selectLabel}>系列 (Series)</label>
            <select
              className={styles.select}
              value={selectedSeries}
              onChange={(e) => setSelectedSeries(e.target.value)}
              disabled={loadingOptions}
            >
              <option value="">-- Chọn series --</option>
              {seriesList.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className={styles.selectGroup}>
            <label className={styles.selectLabel}>岗位 (Position)</label>
            <select
              className={styles.select}
              value={selectedPosition}
              onChange={(e) => setSelectedPosition(e.target.value)}
              disabled={loadingOptions}
            >
              <option value="">-- Chọn position --</option>
              {positionList.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <button className={styles.startBtn} onClick={handleStart} disabled={loadingOptions}>
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

  // ─── MÀN HÌNH KẾT QUẢ ─────────────────
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

  // ─── MÀN HÌNH LÀM BÀI (TỰ LUẬN) ─────────────────
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
            <span className={styles.qScore}>Điểm: {q.score}</span>
          </div>

          {/* Hiển thị hình ảnh nếu có */}
          {q.image_url && (
            <div className={styles.questionImage}>
              <img src={q.image_url} alt="Câu hỏi hình ảnh" />
            </div>
          )}

          <p className={styles.questionText}>{q.question}</p>

          {/* Ô nhập câu trả lời tự luận */}
          <div className={styles.essayAnswer}>
            <label className={styles.answerLabel}>Câu trả lời của bạn:</label>
            <textarea
              className={styles.answerTextarea}
              rows={6}
              value={answers[q.id] || ''}
              onChange={(e) => handleAnswer(q.id, e.target.value)}
              placeholder="Nhập câu trả lời của bạn vào đây..."
            />
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
