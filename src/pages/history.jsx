import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase, getProfile } from '../lib/supabase';
import styles from '../styles/history.module.css';

export default function HistoryPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState(null);
  const [lightboxImage, setLightboxImage] = useState(null);
  const [user, setUser] = useState(null);

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
      setUser(session.user);
      loadHistory(session.user.id);
    });
  }, []);

  async function loadHistory(userId) {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('exam_sessions')
        .select('*')
        .eq('user_id', userId)
        .neq('status', 'in_progress')
        .order('submitted_at', { ascending: false });
      
      if (error) throw error;
      
      const sessionsWithDetails = await Promise.all(
        data.map(async (session) => {
          const { data: questions, error: qErr } = await supabase
            .from('questions_cache')
            .select('*')
            .in('id', session.question_ids);
          
          if (qErr) throw qErr;
          
          const orderedQuestions = session.question_ids
            .map(id => questions.find(q => q.id === id))
            .filter(Boolean);
          
          const { data: submissions, error: subErr } = await supabase
            .from('submissions')
            .select('*')
            .eq('session_id', session.id);
          
          if (subErr) throw subErr;
          
          const answersMap = {};
          submissions.forEach(sub => {
            answersMap[sub.question_id] = sub;
          });
          
          return {
            ...session,
            questions: orderedQuestions,
            answers: answersMap,
            submissions: submissions
          };
        })
      );
      
      setSessions(sessionsWithDetails);
    } catch (err) {
      console.error('Lỗi tải lịch sử:', err);
      alert('Không thể tải lịch sử bài thi');
    } finally {
      setLoading(false);
    }
  }

  const toggleSessionDetail = (sessionId) => {
    if (selectedSession === sessionId) {
      setSelectedSession(null);
    } else {
      setSelectedSession(sessionId);
    }
  };

  // Kiểm tra câu trả lời đúng hay sai (dựa trên score)
  const isAnswerCorrect = (answer, maxScore) => {
    return answer?.score === maxScore;
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.backBtn} onClick={() => router.push('/exam')}>
            ← Quay lại
          </button>
          <h1 className={styles.title}>Lịch sử bài thi</h1>
        </div>
        <button className={styles.logoutBtn} onClick={async () => {
          await supabase.auth.signOut();
          router.replace('/');
        }}>
          Đăng xuất
        </button>
      </header>

      {loading ? (
        <div className={styles.loadingBox}><div className={styles.spinner} /></div>
      ) : sessions.length === 0 ? (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}>📭</span>
          <p>Bạn chưa có bài thi nào</p>
          <button className={styles.startBtn} onClick={() => router.push('/exam')}>
            Bắt đầu làm bài
          </button>
        </div>
      ) : (
        <div className={styles.historyList}>
          {sessions.map((session, idx) => {
            const totalScore = session.questions.reduce((sum, q) => sum + (q.score || 0), 0);
            const achievedScore = session.score || 0;
            const isGraded = session.status === 'graded';
            
            return (
              <div key={session.id} className={styles.historyCard}>
                <div className={styles.cardHeader} onClick={() => toggleSessionDetail(session.id)}>
                  <div className={styles.cardInfo}>
                    <span className={styles.cardNumber}>Bài thi #{idx + 1}</span>
                    <span className={styles.cardDate}>
                      {new Date(session.submitted_at).toLocaleString()}
                    </span>
                  </div>
                  <div className={styles.cardStats}>
                    <span className={`${styles.score} ${isGraded ? styles.graded : styles.pending}`}>
                      {isGraded ? `${achievedScore}/${totalScore} điểm` : 'Chờ chấm điểm'}
                    </span>
                    <span className={styles.expandIcon}>
                      {selectedSession === session.id ? '▲' : '▼'}
                    </span>
                  </div>
                </div>
                
                {selectedSession === session.id && (
                  <div className={styles.cardDetail}>
                    <div className={styles.detailHeader}>
                      <span>系列: {session.series || '—'}</span>
                      <span>岗位: {session.position || '—'}</span>
                      <span>Số câu: {session.total_questions}</span>
                    </div>
                    
                    <div className={styles.questionsList}>
                      {session.questions.map((q, qIdx) => {
                        const answer = session.answers[q.id];
                        const maxScore = q.score || 0;
                        const achievedQScore = answer?.score || 0;
                        const isCorrect = achievedQScore === maxScore && maxScore > 0;
                        
                        return (
                          <div key={q.id} className={styles.questionItem}>
                            <div className={styles.questionHeader}>
                              <span className={styles.questionNumber}>Câu {qIdx + 1}</span>
                              <span className={`${styles.questionScore} ${isCorrect ? styles.fullScore : ''}`}>
                                {isGraded ? `${achievedQScore}/${maxScore}` : `${maxScore} điểm`}
                              </span>
                            </div>
                            <div className={styles.questionText}>{q.question}</div>
                            <div className={styles.answerSection}>
                              <div className={styles.answerLabel}>Câu trả lời của bạn:</div>
                              <div className={styles.answerText}>
                                {answer?.user_answer || 'Chưa có câu trả lời'}
                              </div>
                              {answer?.image_urls && answer.image_urls.length > 0 && (
                                <div className={styles.answerImages}>
                                  {answer.image_urls.map((url, i) => (
                                    <img 
                                      key={i} 
                                      src={url} 
                                      alt={`answer ${i+1}`} 
                                      className={styles.answerImage}
                                      onClick={() => setLightboxImage(url)}
                                      style={{ cursor: 'pointer' }}
                                    />
                                  ))}
                                </div>
                              )}
                              {isGraded && (
                                <div className={`${styles.gradeResult} ${isCorrect ? styles.correct : styles.wrong}`}>
                                  {isCorrect ? '✓ Đúng' : '✗ Sai'}
                                </div>
                              )}
                              {/* Hiển thị nhận xét của giám khảo */}
                              {answer?.feedback && (
                                <div className={styles.feedbackSection}>
                                  <div className={styles.feedbackLabel}>📝 Nhận xét của giám khảo:</div>
                                  <div className={styles.feedbackText}>{answer.feedback}</div>
                                  {answer.feedback_images && answer.feedback_images.length > 0 && (
                                    <div className={styles.feedbackImages}>
                                      {answer.feedback_images.map((url, i) => (
                                        <img 
                                          key={i} 
                                          src={url} 
                                          alt={`feedback ${i+1}`} 
                                          className={styles.feedbackImage}
                                          onClick={() => setLightboxImage(url)}
                                          style={{ cursor: 'pointer' }}
                                        />
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
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Lightbox xem ảnh to */}
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
