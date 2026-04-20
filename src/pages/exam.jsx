import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import {
  supabase, getProfile, getActiveSession, createExamSession,
  getSessionWithQuestions, saveAnswer, getAnswers, submitExam
} from '../lib/supabase';
import styles from '../styles/exam.module.css';

export default function ExamPage() {
  const router = useRouter();
  const [phase, setPhase] = useState('loading');
  const [session, setSession] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState({}); // { questionId: { text: '', images: [] } }
  const [timeLeft, setTimeLeft] = useState(0);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const timerRef = useRef(null);
  const textareaRef = useRef(null);

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
      const active = await getActiveSession().catch(() => null);
      if (active) {
        await loadSession(active);
      } else {
        await loadFilterOptions();
        setPhase('select');
      }
    });
  }, []);

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
      console.error(err);
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
    setSession(sess);
    setQuestions(qs);
    setAnswers(savedAnswers);
    const elapsed = Math.floor((Date.now() - new Date(sess.started_at).getTime()) / 1000);
    const remaining = Math.max(0, sess.duration_minutes * 60 - elapsed);
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

  // Xử lý dán ảnh
  const handlePasteImage = async (questionId, event) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    
    const imageItems = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        imageItems.push(items[i]);
      }
    }
    
    if (imageItems.length === 0) return;
    
    const currentAnswer = answers[questionId] || { text: '', images: [] };
    if (currentAnswer.images.length + imageItems.length > 3) {
      alert('⚠️ Chỉ được dán tối đa 3 ảnh mỗi câu!');
      return;
    }
    
    setUploading(true);
    const newImageUrls = [...currentAnswer.images];
    
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) continue;
      
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(2)}.png`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('exam-images')
        .upload(fileName, file);
      
      if (uploadError) {
        console.error('Upload lỗi:', uploadError);
        continue;
      }
      
      const { data: urlData } = supabase.storage
        .from('exam-images')
        .getPublicUrl(fileName);
      
      newImageUrls.push(urlData.publicUrl);
    }
    
    setAnswers(prev => ({
      ...prev,
      [questionId]: { text: currentAnswer.text, images: newImageUrls }
    }));
    
    setSaving(true);
    try {
      await saveAnswer(session.id, questionId, currentAnswer.text, newImageUrls);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
      setUploading(false);
    }
  };
  
  const handleTextChange = async (questionId, text) => {
    const currentImages = answers[questionId]?.images || [];
    setAnswers(prev => ({
      ...prev,
      [questionId]: { text, images: currentImages }
    }));
    setSaving(true);
    try {
      await saveAnswer(session.id, questionId, text, currentImages);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };
  
  const removeImage = async (questionId, imageIndex) => {
    const current = answers[questionId];
    if (!current) return;
    const newImages = current.images.filter((_, i) => i !== imageIndex);
    setAnswers(prev => ({
      ...prev,
      [questionId]: { text: current.text, images: newImages }
    }));
    setSaving(true);
    try {
      await saveAnswer(session.id, questionId, current.text, newImages);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

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

  const answeredCount = Object.keys(answers).filter(id => answers[id]?.text?.trim()).length;
  const q = questions[current];

  if (phase === 'loading') {
    return (
      <div className={styles.center}>
        <div className={styles.spinner} />
        <p className={styles.loadingText}>Đang tải...</p>
      </div>
    );
  }

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
  const currentAnswer = answers[q.id] || { text: '', images: [] };

  return (
    <div className={styles.examPage}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.logo}>📝 ExamFlow</span>
          <div className={styles.progressBadge}>
            <span className={styles.progressCount}>{answeredCount}</span>
            <span className={styles.progressTotal}>/{questions.length}</span>
            <span className={styles.progressLabel}>đã trả lời</span>
          </div>
          {saving && <span className={styles.savingBadge}>💾 Đang lưu...</span>}
        </div>
        <div className={`${styles.timer} ${isLow ? styles.timerLow : ''}`}>
          <span className={styles.timerIcon}>⏱️</span>
          <span className={styles.timerText}>{formatTime(timeLeft)}</span>
        </div>
        <button
          className={styles.submitBtn}
          onClick={() => handleSubmit(false)}
          disabled={submitting}
        >
          {submitting ? '📤 Đang nộp...' : '📮 Nộp bài'}
        </button>
      </header>

      <div className={styles.examBody}>
        <main className={styles.questionPanel}>
          <div className={styles.questionMeta}>
            <div className={styles.questionBadge}>
              <span className={styles.qNumber}>Câu {current + 1}</span>
              <span className={styles.qTotal}>/{questions.length}</span>
            </div>
            {q.topic && <span className={styles.qTopic}>{q.topic}</span>}
            <span className={`${styles.qDiff} ${styles[q.difficulty]}`}>
              {q.difficulty === 'easy' ? '⭐ Dễ' : q.difficulty === 'medium' ? '⭐⭐ Trung bình' : '⭐⭐⭐ Khó'}
            </span>
            <span className={styles.qScore}>🎯 {q.score} điểm</span>
          </div>

          <div className={styles.questionContent}>
            <p className={styles.questionText}>{q.question}</p>
          </div>

          {/* Ô nhập câu trả lời */}
          <div className={styles.answerSection}>
            <label className={styles.answerLabel}>
              📝 Câu trả lời của bạn:
            </label>
            <textarea
              ref={textareaRef}
              className={styles.answerTextarea}
              rows={5}
              value={currentAnswer.text || ''}
              onChange={(e) => handleTextChange(q.id, e.target.value)}
              onPaste={(e) => handlePasteImage(q.id, e)}
              placeholder="✍️ Nhập câu trả lời của bạn vào đây... (💡 Có thể dán ảnh: Ctrl+V)"
            />
            {uploading && (
              <div className={styles.uploadingIndicator}>
                <span className={styles.spinnerSmall}></span>
                Đang tải ảnh lên...
              </div>
            )}
          </div>

          {/* Hiển thị danh sách ảnh đã dán */}
          {currentAnswer.images.length > 0 && (
            <div className={styles.imageSection}>
              <label className={styles.imageLabel}>
                🖼️ Ảnh đính kèm ({currentAnswer.images.length}/3):
              </label>
              <div className={styles.imagesGrid}>
                {currentAnswer.images.map((url, idx) => (
                  <div key={idx} className={styles.imageCard}>
                    <img src={url} alt={`answer ${idx + 1}`} className={styles.imagePreview} />
                    <button
                      type="button"
                      className={styles.removeImageBtn}
                      onClick={() => removeImage(q.id, idx)}
                      title="Xóa ảnh"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Navigation buttons */}
          <div className={styles.navButtons}>
            <button
              className={`${styles.navBtn} ${styles.navPrev}`}
              onClick={() => setCurrent(c => Math.max(0, c - 1))}
              disabled={current === 0}
            >
              ← Câu trước
            </button>
            <div className={styles.navProgress}>
              {current + 1} / {questions.length}
            </div>
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
          <div className={styles.sidebarHeader}>
            <span className={styles.sidebarIcon}>📋</span>
            <span className={styles.sidebarTitle}>Danh sách câu hỏi</span>
          </div>
          <div className={styles.qMap}>
            {questions.map((question, idx) => {
              const hasAnswer = answers[question.id]?.text?.trim();
              const hasImages = answers[question.id]?.images?.length > 0;
              return (
                <button
                  key={question.id}
                  className={`${styles.qMapBtn} 
                    ${idx === current ? styles.qMapCurrent : ''} 
                    ${hasAnswer ? styles.qMapAnswered : ''}
                    ${hasImages ? styles.qMapHasImage : ''}`}
                  onClick={() => setCurrent(idx)}
                  title={hasAnswer ? 'Đã trả lời' : (hasImages ? 'Có ảnh' : 'Chưa trả lời')}
                >
                  {idx + 1}
                  {hasImages && <span className={styles.imageIcon}>🖼️</span>}
                </button>
              );
            })}
          </div>
          <div className={styles.legend}>
            <div className={styles.legendItem}>
              <span className={`${styles.legendDot} ${styles.legendAnswered}`}></span>
              <span>Đã trả lời</span>
            </div>
            <div className={styles.legendItem}>
              <span className={`${styles.legendDot} ${styles.legendCurrent}`}></span>
              <span>Đang xem</span>
            </div>
            <div className={styles.legendItem}>
              <span className={`${styles.legendDot}`}></span>
              <span>Chưa trả lời</span>
            </div>
            <div className={styles.legendItem}>
              <span className={styles.imageIconSmall}>🖼️</span>
              <span>Có ảnh</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
