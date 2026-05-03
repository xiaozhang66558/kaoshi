import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import {
  supabase, getProfile, getActiveSession, saveAnswer, submitExam
} from '../lib/supabase';
import Modal from '../components/Modal';
import { useLanguage } from '../contexts/LanguageContext';
import styles from '../styles/exam.module.css';

export default function ExamPage() {
  const router = useRouter();
  const { language, t } = useLanguage();
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
  const [lightboxImage, setLightboxImage] = useState(null);

  // State cho màn hình chọn series/position
  const [seriesList, setSeriesList] = useState([]);
  const [positionList, setPositionList] = useState([]);
  const [selectedSeries, setSelectedSeries] = useState('');
  const [selectedPosition, setSelectedPosition] = useState('');
  const [loadingOptions, setLoadingOptions] = useState(false);

  // Hàm lấy câu hỏi theo ngôn ngữ
  const getQuestionByLanguage = (q) => {
    if (!q) return '⚠️ Câu hỏi không tồn tại';
    if (language === 'en') return q.question_en || q.question;
    if (language === 'zh') return q.question_zh || q.question;
    return q.question_vi || q.question;
  };

  // ✅ Đọc danh sách series/position trực tiếp từ Google Sheet
  async function loadFilterOptions() {
    setLoadingOptions(true);
    try {
      const sheetsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEETS_ID}/values/Sheet1!A2:J10000?key=${process.env.GOOGLE_API_KEY}`;
      const response = await fetch(sheetsUrl);
      const data = await response.json();
      const rows = data.values || [];
      
      const seriesSet = new Set();
      const positionSet = new Set();
      
      for (const row of rows) {
        const series = row[0]?.trim();
        const position = row[1]?.trim();
        const hasQuestion = (row[2]?.trim()) || (row[3]?.trim()) || (row[4]?.trim());
        
        if (hasQuestion) {
          if (series) seriesSet.add(series);
          if (position) positionSet.add(position);
        }
      }
      
      setSeriesList(Array.from(seriesSet).sort());
      setPositionList(Array.from(positionSet).sort());
      console.log(`📋 Đã load ${seriesSet.size} series, ${positionSet.size} positions từ Google Sheet`);
    } catch (err) { 
      console.error('Lỗi load filter options:', err);
    } finally { 
      setLoadingOptions(false); 
    }
  }

  // ✅ Đọc câu hỏi trực tiếp từ Google Sheet theo series và position
  async function loadQuestionsFromSheet(series, position) {
    const sheetsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${process.env.NEXT_PUBLIC_GOOGLE_SHEETS_ID}/values/Sheet1!A2:J10000?key=${process.env.NEXT_PUBLIC_GOOGLE_API_KEY}`;
    const response = await fetch(sheetsUrl);
    const data = await response.json();
    const rows = data.values || [];
    
    // Lọc theo series và position
    const filtered = rows.filter(row => {
      const rowSeries = row[0]?.trim();
      const rowPosition = row[1]?.trim();
      return rowSeries === series && rowPosition === position;
    });
    
    // Chuyển đổi thành câu hỏi
    const questions = filtered.map((row, idx) => {
      const diffValue = String(row[6] || '1').trim();
      let difficulty = 'medium';
      if (diffValue === '1') difficulty = 'easy';
      else if (diffValue === '2') difficulty = 'medium';
      else if (diffValue === '3') difficulty = 'hard';
      
      return {
        id: `sheet_${Date.now()}_${idx}_${Math.random()}`,
        series: row[0]?.trim() || '',
        position: row[1]?.trim() || '',
        question_en: row[2]?.trim() || '',
        question_zh: row[3]?.trim() || '',
        question_vi: row[4]?.trim() || '',
        score: parseInt(row[5]) || 10,
        difficulty: difficulty,
        image_1: row[7]?.trim() || '',
        image_2: row[8]?.trim() || '',
        image_3: row[9]?.trim() || '',
      };
    });
    
    return questions;
  }

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
    // Lấy câu hỏi từ session_data nếu có (bài thi cũ)
    if (s.questions_data) {
      setQuestions(s.questions_data);
    } else {
      // Nếu không có, load từ database (cách cũ)
      const { data: questions } = await supabase
        .from('questions_cache')
        .select('*')
        .in('id', s.question_ids || []);
      setQuestions(questions || []);
    }
    
    const { data: answersData } = await supabase
      .from('submissions')
      .select('question_id, user_answer, image_urls')
      .eq('session_id', s.id);
    
    const savedAnswers = {};
    (answersData || []).forEach(a => {
      savedAnswers[a.question_id] = { text: a.user_answer || '', images: a.image_urls || [] };
    });
    
    setSession(s);
    setAnswers(savedAnswers);
    const elapsed = Math.floor((Date.now() - new Date(s.started_at).getTime()) / 1000);
    const remaining = Math.max(0, s.duration_minutes * 60 - elapsed);
    setTimeLeft(remaining);
    setPhase('exam');
  }

  async function handleStart() {
    if (!selectedSeries || !selectedPosition) {
      alert(t('please_select_series_position'));
      return;
    }
    setPhase('loading');
    try {
      // ✅ Đọc câu hỏi trực tiếp từ Google Sheet
      const questionsData = await loadQuestionsFromSheet(selectedSeries, selectedPosition);
      
      if (!questionsData || questionsData.length === 0) {
        alert('Không có câu hỏi nào cho series và position này');
        setPhase('select');
        return;
      }
      
      // Tạo session mới với dữ liệu câu hỏi
      const { data: sessionData, error: sessionError } = await supabase
        .from('exam_sessions')
        .insert({
          user_id: user.id,
          series: selectedSeries,
          position: selectedPosition,
          questions_data: questionsData,  // ✅ Lưu toàn bộ câu hỏi vào session
          duration_minutes: 30,
          total_questions: questionsData.length,
          status: 'in_progress',
          started_at: new Date().toISOString()
        })
        .select()
        .single();
      
      if (sessionError) throw sessionError;
      
      setQuestions(questionsData);
      setSession(sessionData);
      setAnswers({});
      setTimeLeft(30 * 60);
      setPhase('exam');
    } catch (err) {
      alert(err.message);
      setPhase('select');
    }
  }

  const debounceTimer = useRef(null);

  const handleAnswer = useCallback((questionId, text) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: { text, images: prev[questionId]?.images || [] }
    }));
    
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    
    debounceTimer.current = setTimeout(async () => {
      try {
        const currentImages = answers[questionId]?.images || [];
        await saveAnswer(session.id, questionId, text, currentImages);
      } catch (e) {
        console.error('Save error:', e);
      }
    }, 800);
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
      alert(`⚠️ ${t('images_attached')}`);
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

  const getDifficultyText = (difficulty) => {
    if (difficulty === 'easy') return t('easy');
    if (difficulty === 'medium') return t('medium');
    if (difficulty === 'hard') return t('hard');
    return difficulty;
  };

  const questionImages = [q?.image_1, q?.image_2, q?.image_3].filter(url => url && url.trim());

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
            <h1 className={styles.selectTitle}>{t('select_questions')}</h1>
            <p className={styles.selectSubtitle}>{t('please_select_series_position')}</p>
          </div>
          
          <div className={styles.selectForm}>
            <div className={styles.selectGroup}>
              <label className={styles.selectLabel}>
                <span className={styles.labelIcon}>🏷️</span>
                {t('select_series')}
              </label>
              <div className={styles.selectWrapper}>
                <select 
                  value={selectedSeries} 
                  onChange={(e) => setSelectedSeries(e.target.value)}
                  className={styles.selectInput}
                  disabled={loadingOptions}
                >
                  <option value="">-- {t('select_series')} --</option>
                  {seriesList.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <span className={styles.selectArrow}>▼</span>
              </div>
            </div>

            <div className={styles.selectGroup}>
              <label className={styles.selectLabel}>
                <span className={styles.labelIcon}>💼</span>
                {t('select_position')}
              </label>
              <div className={styles.selectWrapper}>
                <select 
                  value={selectedPosition} 
                  onChange={(e) => setSelectedPosition(e.target.value)}
                  className={styles.selectInput}
                  disabled={loadingOptions}
                >
                  <option value="">-- {t('select_position')} --</option>
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
              {t('start_exam')}
            </button>

            <button 
              className={styles.backHomeBtn} 
              onClick={async () => {
                await supabase.auth.signOut();
                router.push('/');
              }}
            >
              <span>🏠</span>
              {t('back_home')}
            </button>

            <button 
              className={styles.historyBtn} 
              onClick={() => router.push('/history')}
            >
              <span>📜</span>
              {t('history')}
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
          <h2>📝 {t('submitted')}</h2>
          <p>{t('result_pending')}</p>
          <button className={styles.startBtn} onClick={() => router.replace('/')}>{t('back_home')}</button>
          <button 
            className={styles.historyBtn} 
            onClick={() => router.push('/history')}
            style={{ marginTop: '0.5rem' }}
          >
            <span>📜</span>
            {t('history')}
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
            {submitting ? `📤 ${t('submitting')}` : `📮 ${t('submit_exam')}`}
          </button>
        </header>

        <div className={styles.examBody}>
          <main className={styles.questionPanel}>
            <div className={styles.questionBox}>
              <div className={styles.questionHeader}>
                <span className={styles.qNumber}>{t('question')} {current + 1}</span>
                <span className={styles.qTotal}>/{questions.length}</span>
                <span className={`${styles.qDiff} ${styles[q.difficulty]}`}>
                  {getDifficultyText(q.difficulty)}
                </span>
                <span className={styles.qScore}>🎯 {q.score} {t('points')}</span>
              </div>
              
              {questionImages.length > 0 && (
                <div className={styles.questionImagesGrid}>
                  {questionImages.map((url, idx) => (
                    <div key={idx} className={styles.questionImageItem}>
                      <img 
                        src={url} 
                        alt={`Câu hỏi hình ảnh ${idx + 1}`} 
                        className={styles.questionImg} 
                        onClick={() => setLightboxImage(url)}
                        style={{ cursor: 'pointer' }}
                      />
                    </div>
                  ))}
                </div>
              )}
              
              <div className={styles.questionText}>
                <p>{getQuestionByLanguage(q)}</p>
              </div>
            </div>

            <div className={styles.answerBox}>
              <div className={styles.answerHeader}>
                <span>📝 {t('your_answer')}</span>
                <span className={styles.answerHint}>{t('paste_hint')}</span>
              </div>
              <textarea
                className={styles.answerTextarea}
                rows={5}
                value={currentAnswer.text || ''}
                onChange={(e) => handleAnswer(q.id, e.target.value)}
                onPaste={(e) => handlePasteImage(q.id, e)}
                placeholder={t('enter_answer')}
              />

              <div className={styles.imagesBox}>
                <div className={styles.imagesHeader}>🖼️ {t('images_attached')}</div>
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
                              title={t('delete')}
                            >
                              ✕
                            </button>
                          </>
                        ) : (
                          <div className={styles.imagePlaceholder}>
                            <span>🖼️</span>
                            <span>{t('no_image')}</span>
                            <span className={styles.imageHint}>{t('paste_image')}</span>
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
                {t('prev_question')}
              </button>
              <span className={styles.navInfo}>{current+1} / {questions.length}</span>
              <button className={styles.navNext} onClick={() => setCurrent(c => c+1)} disabled={current === questions.length-1}>
                {t('next_question')}
              </button>
            </div>
          </main>

          <aside className={styles.sidebar}>
            <div className={styles.sidebarHeader}>
              <span>📋</span>
              <span>{t('question_list')}</span>
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
                    title={hasImage ? t('has_image') : (hasAnswer ? t('answered') : t('unanswered'))}
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
                <span>{t('answered')}</span>
              </div>
              <div className={styles.legendItem}>
                <span className={styles.legendDotCurrent}></span>
                <span>{t('viewing')}</span>
              </div>
              <div className={styles.legendItem}>
                <span className={styles.legendDot}></span>
                <span>{t('unanswered')}</span>
              </div>
              <div className={styles.legendItem}>
                <span>📷</span>
                <span>{t('has_image')}</span>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <Modal
        isOpen={showSubmitModal}
        onClose={() => setShowSubmitModal(false)}
        title={t('confirm')}
        message={autoSubmit ? t('time_expired') : t('submit_confirm')}
        onConfirm={confirmSubmit}
        confirmText={t('submit_exam')}
        cancelText={t('cancel')}
      />

      {lightboxImage && (
        <div className={styles.lightbox} onClick={() => setLightboxImage(null)}>
          <div className={styles.lightboxContent}>
            <span className={styles.lightboxClose} onClick={() => setLightboxImage(null)}>&times;</span>
            <img className={styles.lightboxImage} src={lightboxImage} alt="Ảnh to" />
          </div>
        </div>
      )}
    </>
  );
}
