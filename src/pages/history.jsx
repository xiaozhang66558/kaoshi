import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase, getProfile } from '../lib/supabase';
import { useLanguage } from '../contexts/LanguageContext';
import styles from '../styles/history.module.css';

export default function HistoryPage() {
  const router = useRouter();
  const { language, t } = useLanguage();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState(null);
  const [lightboxImage, setLightboxImage] = useState(null);

  const getQuestionByLanguage = (q) => {
    if (!q) return '⚠️ Câu hỏi không tồn tại';
    if (language === 'en') return q.question_en || q.question;
    if (language === 'zh') return q.question_zh || q.question;
    return q.question_vi || q.question;
  };

  const getQuestionImages = (q) => {
    return [q?.image_1, q?.image_2, q?.image_3].filter(url => url && url.trim());
  };

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        router.replace('/');
        return;
      }
      const profile = await getProfile(session.user.id).catch(() => null);
      if (profile?.role === 'admin') {
        router.replace('/admin');
        return;
      }
      loadHistory(session.user.id);
    });
  }, []);

  async function loadHistory(userId) {
    setLoading(true);
    try {
      // Lấy tất cả session của thí sinh
      const { data: sessions, error } = await supabase
        .from('exam_sessions')
        .select('*')
        .eq('user_id', userId)
        .neq('status', 'in_progress')
        .order('submitted_at', { ascending: false });
      
      if (error) throw error;
      
      if (!sessions || sessions.length === 0) {
        setSessions([]);
        setLoading(false);
        return;
      }
      
      // Lấy submissions và questions cho từng session
      const sessionsWithDetails = await Promise.all(
        sessions.map(async (session) => {
          // Lấy submissions
          const { data: submissions } = await supabase
            .from('submissions')
            .select('*')
            .eq('session_id', session.id);
          
          // Lấy questions_cache cho các question_id
          const questionIds = session.question_ids || [];
          let questions = [];
          if (questionIds.length > 0) {
            const { data: qData } = await supabase
              .from('questions_cache')
              .select('*')
              .in('id', questionIds);
            if (qData) questions = qData;
          }
          
          // Tạo map answers theo question_id
          const answersMap = {};
          if (submissions) {
            submissions.forEach(sub => {
              answersMap[sub.question_id] = sub;
            });
          }
          
          // Sắp xếp câu hỏi theo đúng thứ tự
          const orderedQuestions = questionIds
            .map(id => questions.find(q => q.id === id))
            .filter(Boolean);
          
          return {
            ...session,
            questions: orderedQuestions,
            answers: answersMap,
            submissions: submissions || []
          };
        })
      );
      
      setSessions(sessionsWithDetails);
    } catch (err) {
      console.error('Lỗi tải lịch sử:', err);
    } finally {
      setLoading(false);
    }
  }

  const toggleSessionDetail = (sessionId) => {
    setSelectedSession(selectedSession === sessionId ? null : sessionId);
  };

  const getStatusText = (status, score, totalScore) => {
    if (status === 'graded') {
      return `${score}/${totalScore} ${t('total_score')}`;
    }
    return t('waiting_score');
  };

  if (loading) {
    return (
      <div className={styles.center}>
        <div className={styles.spinner} />
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <button className={styles.backBtn} onClick={() => router.push('/exam')}>← {t('back')}</button>
            <h1 className={styles.title}>{t('exam_history')}</h1>
          </div>
          <button className={styles.logoutBtn} onClick={async () => { await supabase.auth.signOut(); router.replace('/'); }}>{t('logout')}</button>
        </header>
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}>📭</span>
          <p>{t('no_exams')}</p>
          <button className={styles.startBtn} onClick={() => router.push('/exam')}>{t('start_exam')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.backBtn} onClick={() => router.push('/exam')}>← {t('back')}</button>
          <h1 className={styles.title}>{t('exam_history')}</h1>
        </div>
        <button className={styles.logoutBtn} onClick={async () => { await supabase.auth.signOut(); router.replace('/'); }}>{t('logout')}</button>
      </header>

      <div className={styles.historyList}>
        {sessions.map((session, idx) => {
          const totalScore = session.questions?.reduce((sum, q) => sum + (q?.score || 0), 0) || 0;
          const achievedScore = session.score || 0;
          const isGraded = session.status === 'graded';
          
          return (
            <div key={session.id} className={styles.historyCard}>
              <div className={styles.cardHeader} onClick={() => toggleSessionDetail(session.id)}>
                <div className={styles.cardInfo}>
                  <span className={styles.cardNumber}>{t('exam_no')} #{idx + 1}</span>
                  <span className={styles.cardDate}>{new Date(session.submitted_at).toLocaleString()}</span>
                </div>
                <div className={styles.cardStats}>
                  <span className={`${styles.score} ${isGraded ? styles.graded : styles.pending}`}>
                    {getStatusText(session.status, achievedScore, totalScore)}
                  </span>
                  <span className={styles.expandIcon}>{selectedSession === session.id ? '▲' : '▼'}</span>
                </div>
              </div>
              
              {selectedSession === session.id && (
                <div className={styles.cardDetail}>
                  <div className={styles.detailHeader}>
                    <span>{t('series')}: {session.series || '—'}</span>
                    <span>{t('position')}: {session.position || '—'}</span>
                    <span>{t('total_questions')}: {session.total_questions}</span>
                  </div>
                  
                  {session.questions && session.questions.length > 0 ? (
                    <div className={styles.questionsList}>
                      {session.questions.map((q, qIdx) => {
                        const answer = session.answers[q.id];
                        const maxScore = q?.score || 0;
                        const achievedQScore = answer?.score || 0;
                        const isCorrect = achievedQScore === maxScore && maxScore > 0;
                        const questionImages = getQuestionImages(q);
                        
                        return (
                          <div key={q.id} className={styles.questionItem}>
                            <div className={styles.questionHeader}>
                              <span className={styles.questionNumber}>{t('question')} {qIdx + 1}</span>
                              <span className={`${styles.questionScore} ${isCorrect ? styles.fullScore : ''}`}>
                                {isGraded ? `${achievedQScore}/${maxScore}` : `${maxScore} ${t('points')}`}
                              </span>
                            </div>
                            
                            {questionImages.length > 0 && (
                              <div className={styles.questionImagesHistory}>
                                {questionImages.map((url, imgIdx) => (
                                  <img key={imgIdx} src={url} alt={`img${imgIdx+1}`} className={styles.questionImgHistory} onClick={() => setLightboxImage(url)} style={{ cursor: 'pointer' }} />
                                ))}
                              </div>
                            )}
                            
                            <div className={styles.questionText}>{getQuestionByLanguage(q)}</div>
                            
                            <div className={styles.answerSection}>
                              <div className={styles.answerLabel}>{t('your_answer_history')}</div>
                              <div className={styles.answerText}>{answer?.user_answer || t('no_answer')}</div>
                              
                              {answer?.image_urls && answer.image_urls.length > 0 && (
                                <div className={styles.answerImages}>
                                  {answer.image_urls.map((url, i) => (
                                    <img key={i} src={url} alt={`answer ${i+1}`} className={styles.answerImage} onClick={() => setLightboxImage(url)} style={{ cursor: 'pointer' }} />
                                  ))}
                                </div>
                              )}
                              
                              {isGraded && (
                                <div className={`${styles.gradeResult} ${isCorrect ? styles.correct : styles.wrong}`}>
                                  {isCorrect ? `✓ ${t('correct')}` : `✗ ${t('wrong')}`}
                                </div>
                              )}
                              
                              {answer?.feedback && (
                                <div className={styles.feedbackSection}>
                                  <div className={styles.feedbackLabel}>📝 {t('feedback_from_examiner')}</div>
                                  <div className={styles.feedbackText}>{answer.feedback}</div>
                                  {answer.feedback_images && answer.feedback_images.length > 0 && (
                                    <div className={styles.feedbackImages}>
                                      {answer.feedback_images.map((url, i) => (
                                        <img key={i} src={url} alt={`feedback ${i+1}`} className={styles.feedbackImage} onClick={() => setLightboxImage(url)} style={{ cursor: 'pointer' }} />
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className={styles.noQuestions}>
                      <p>⚠️ Không thể tải câu hỏi</p>
                      <p className={styles.note}>Điểm của bạn: {achievedScore}/{totalScore}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Lightbox */}
      {lightboxImage && (
        <div className={styles.lightbox} onClick={() => setLightboxImage(null)}>
          <div className={styles.lightboxContent}>
            <span className={styles.lightboxClose} onClick={() => setLightboxImage(null)}>&times;</span>
            <img className={styles.lightboxImage} src={lightboxImage} alt="Ảnh to" />
          </div>
        </div>
      )}
    </div>
  );
}
