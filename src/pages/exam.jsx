import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import {
  supabase, getProfile, getActiveSession, createExamSession,
  getSessionWithQuestions, saveAnswer, getAnswers, submitExam
} from '../lib/supabase';
import Modal from '../components/Modal';
import styles from '../styles/exam.module.css';

export default function ExamPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [phase, setPhase] = useState('loading');
  const [session, setSession] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const timerRef = useRef(null);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [autoSubmit, setAutoSubmit] = useState(false);
  const imagesCache = useRef({});

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
    } catch (err) { console.error(err); } 
    finally { setLoadingOptions(false); }
  }

  useEffect(() => {
    if (phase !== 'exam' || timeLeft <= 0) return;
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          setAutoSubmit(true);
          setShowSubmitModal(true);
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
      await createExamSession({ numQuestions: 10, durationMins: 30, series: selectedSeries, position: selectedPosition });
      const active = await getActiveSession();
      await loadSession(active);
    } catch (err) {
      alert(err.message);
      setPhase('select');
    }
  }

  const handleAnswer = useCallback(async (questionId, text) => {
    setSaving(true);
    try {
      const currentImages = imagesCache.current[questionId] || answers[questionId]?.images || [];
      
      setAnswers(prev => ({
        ...prev,
        [questionId]: { text, images: currentImages }
      }));
      
      await saveAnswer(session.id, questionId, text, currentImages);
    } catch (e) { 
      console.error(e); 
    } finally { 
      setSaving(false); 
    }
  }, [session, answers]);

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
    
    setSaving(true);
    const newImageUrls = [...currentAnswer.images];
    
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) continue;
      
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(2)}.png`;
      const { error: uploadError } = await supabase.storage
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
    
    // Cập nhật cache
    imagesCache.current[questionId] = newImageUrls;
    
    setAnswers(prev => ({
      ...prev,
      [questionId]: { text: currentAnswer.text, images: newImageUrls }
    }));
    
    try {
      await saveAnswer(session.id, questionId, currentAnswer.text, newImageUrls);
    } catch (e) { console.error(e); } 
    finally { setSaving(false); }
  };
  
  const removeImage = async (questionId, imageIndex) => {
    const current = answers[questionId];
    if (!current) return;
    const newImages = current.images.filter((_, i) => i !== imageIndex);
    imagesCache.current[questionId] = newImages;
    setAnswers(prev => ({
      ...prev,
      [questionId]: { text: current.text, images: newImages }
    }));
    setSaving(true);
    try {
      await saveAnswer(session.id, questionId, current.text, newImages);
    } catch (e) { console.error(e); } 
    finally { setSaving(false); }
  };

  const confirmSubmit = async () => {
    setShowSubmitModal(false);
    clearInterval(timerRef.current);
    setSubmitting(true);
    try {
      await submitExam(session.id);
      setPhase('result');
    } catch (err) {
      alert(err.message);
      setSubmitting(false);
    }
  };

  const handleSubmit = () => {
    setShowSubmitModal(true);
  };

  const formatTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const answeredCount = Object.keys(answers).filter(id => answers[id]?.text?.trim()).length;
  const q = questions[current];

  if (phase === 'loading') {
    return (
      <div className={styles.center}>
        <div className={styles.spinner} />
      </div>
    );
  }

  if (phase === 'select') {
    return (
      <div className={styles.selectPage}>
        <div className={styles.selectContainer}>
          <div className={styles.selectHeader}>
            <div className={styles.selectIcon}>📋</div>
            <h1 className={styles.selectTitle}>Chọn bộ câu hỏi</h1>
            <p className={styles.selectSubtitle}>Vui lòng chọn Series và Position để bắt đầu làm bài</p>
          </div>
          
          <div className={styles.selectForm}>
            <div className={styles.selectGroup}>
              <label className={styles.selectLabel}>
                <span className={styles.labelIcon}>🏷️</span>
                系列 (Series)
              </label>
              <div className={styles.selectWrapper}>
                <select 
                  value={selectedSeries} 
                  onChange={(e) => setSelectedSeries(e.target.value)}
                  className={styles.selectInput}
                  disabled={loadingOptions}
                >
                  <option value="">-- Chọn series --</option>
                  {seriesList.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <span className={styles.selectArrow}>▼</span>
              </div>
            </div>

            <div className={styles.selectGroup}>
              <label className={styles.selectLabel}>
                <span className={styles.labelIcon}>💼</span>
                岗位 (Position)
              </label>
              <div className={styles.selectWrapper}>
                <select 
                  value={selectedPosition} 
                  onChange={(e) => setSelectedPosition(e.target.value)}
                  className={styles.selectInput}
                  disabled={loadingOptions}
                >
                  <option value="">-- Chọn position --</option>
                  {positionList.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <span className={styles.selectArrow}>▼</span>
              </div>
            </div>

            <button 
              className={styles.startExamBtn} 
              onClick={handleStart} 
              disabled={loadingOptions || !selectedSeries || !selectedPosition}
            >
              <span>▶</span>
              Bắt đầu làm bài
            </button>

            <button 
              className={styles.backHomeBtn} 
              onClick={async () => {
                await supabase.auth.signOut();
                router.push('/');
              }}
            >
              <span>🏠</span>
              Quay về trang chủ
            </button>

            <button 
              className={styles.historyBtn} 
              onClick={() => router.push('/history')}
            >
              <span>📜</span>
              Lịch sử bài thi
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'result') {
    return (
      <div className={styles.center}>
        <div className={styles.resultCard}>
          <h2>📝 Bài thi đã được nộp!</h2>
          <p>Kết quả sẽ được admin chấm điểm sau.</p>
          <button className={styles.startBtn} onClick={() => router.replace('/')}>Về trang chủ</button>
          <button 
            className={styles.historyBtn} 
            onClick={() => router.push('/history')}
            style={{ marginTop: '0.5rem' }}
          >
            <span>📜</span>
            Xem lịch sử bài thi
          </button>
        </div>
      </div>
    );
  }

  if (!q) return null;
  const isLow = timeLeft < 300;
  const currentAnswer = answers[q.id] || { text: '', images: [] };

  return (
    <>
      <div className={styles.examPage}>
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.logo}>📝 ExamFlow</span>
            <span className={styles.progress}>✅ {answeredCount}/{questions.length}</span>
            {saving && <span className={styles.saving}>💾</span>}
          </div>
          <div className={`${styles.timer} ${isLow ? styles.timerLow : ''}`}>
            ⏱️ {formatTime(timeLeft)}
          </div>
          <button className={styles.submitBtn} onClick={handleSubmit} disabled={submitting}>
            {submitting ? '📤 Đang nộp...' : '📮 Nộp bài'}
          </button>
        </header>

        <div className={styles.examBody}>
          <main className={styles.questionPanel}>
            <div className={styles.questionBox}>
              <div className={styles.questionHeader}>
                <span className={styles.qNumber}>Câu {current + 1}</span>
                <span className={styles.qTotal}>/{questions.length}</span>
                <span className={`${styles.qDiff} ${styles[q.difficulty]}`}>
                  {q.difficulty === 'easy' ? 'Dễ' : q.difficulty === 'medium' ? 'Trung bình' : 'Khó'}
                </span>
                <span className={styles.qScore}>🎯 {q.score} điểm</span>
              </div>
              <div className={styles.questionText}>
                <p>{q.question}</p>
              </div>
            </div>

            <div className={styles.answerBox}>
              <div className={styles.answerHeader}>
                <span>📝 Câu trả lời của bạn</span>
                <span className={styles.answerHint}>(Ctrl+V để dán ảnh)</span>
              </div>
              <textarea
                className={styles.answerTextarea}
                rows={5}
                value={currentAnswer.text || ''}
                onChange={(e) => handleAnswer(q.id, e.target.value)}
                onPaste={(e) => handlePasteImage(q.id, e)}
                placeholder="Nhập câu trả lời của bạn vào đây..."
              />

              <div className={styles.imagesBox}>
                <div className={styles.imagesHeader}>🖼️ Ảnh đính kèm (tối đa 3 ảnh)</div>
                <div className={styles.imagesGrid}>
                  {[0, 1, 2].map((idx) => {
                    const imageUrl = currentAnswer.images[idx];
                    return (
                      <div 
                        key={idx} 
                        className={`${styles.imageCard} ${imageUrl ? styles.hasImage : ''}`}
                      >
                        {imageUrl ? (
                          <>
                            <img src={imageUrl} alt={`answer ${idx + 1}`} />
                            <button
                              className={styles.removeImageBtn}
                              onClick={() => removeImage(q.id, idx)}
                              title="Xóa ảnh"
                            >
                              ✕
                            </button>
                          </>
                        ) : (
                          <div className={styles.imagePlaceholder}>
                            <span>🖼️</span>
                            <span>Chưa có ảnh</span>
                            <span className={styles.imageHint}>(Ctrl+V để dán)</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className={styles.navSection}>
              <button className={styles.navPrev} onClick={() => setCurrent(c => c-1)} disabled={current === 0}>
                ← Câu trước
              </button>
              <span className={styles.navInfo}>{current+1} / {questions.length}</span>
              <button className={styles.navNext} onClick={() => setCurrent(c => c+1)} disabled={current === questions.length-1}>
                Câu tiếp →
              </button>
            </div>
          </main>

          <aside className={styles.sidebar}>
            <div className={styles.sidebarHeader}>
              <span>📋</span>
              <span>Danh sách câu hỏi</span>
            </div>
            <div className={styles.qGrid}>
              {questions.map((_, idx) => {
                const hasAnswer = answers[questions[idx].id]?.text?.trim();
                const hasImage = answers[questions[idx].id]?.images?.length > 0;
                return (
                  <button
                    key={idx}
                    className={`${styles.qBtn} ${idx === current ? styles.qCurrent : ''} ${hasAnswer ? styles.qAnswered : ''}`}
                    onClick={() => setCurrent(idx)}
                    title={hasImage ? 'Có ảnh đính kèm' : (hasAnswer ? 'Đã trả lời' : 'Chưa trả lời')}
                  >
                    {idx+1}
                    {hasImage && <span className={styles.qImageIcon}>📷</span>}
                  </button>
                );
              })}
            </div>
            <div className={styles.legend}>
              <div className={styles.legendItem}>
                <span className={styles.legendDotAnswered}></span>
                <span>Đã trả lời</span>
              </div>
              <div className={styles.legendItem}>
                <span className={styles.legendDotCurrent}></span>
                <span>Đang xem</span>
              </div>
              <div className={styles.legendItem}>
                <span className={styles.legendDot}></span>
                <span>Chưa trả lời</span>
              </div>
              <div className={styles.legendItem}>
                <span>📷</span>
                <span>Có ảnh</span>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <Modal
        isOpen={showSubmitModal}
        onClose={() => setShowSubmitModal(false)}
        title="Xác nhận nộp bài"
        message={autoSubmit ? "Đã hết thời gian! Bài thi sẽ được tự động nộp." : "Bạn có chắc chắn muốn nộp bài không?"}
        onConfirm={confirmSubmit}
        confirmText="Nộp bài"
        cancelText="Hủy"
      />
    </>
  );
}
