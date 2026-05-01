import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase, getProfile, getAllSessions, getSessionDetail, getSubmittedSessions, gradeSubmission, saveFeedback } from '../../lib/supabase';
import Modal from '../../components/Modal';
import { useLanguage } from '../../contexts/LanguageContext';
import Statistics from '../../components/Statistics';
import styles from '../../styles/admin.module.css';

const SYNC_URL = '/.netlify/functions/sync-questions';

export default function AdminPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [sessions, setSessions] = useState([]);
  const [submittedSessions, setSubmittedSessions] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lightboxImage, setLightboxImage] = useState(null);
  const [tab, setTab] = useState('all');
  const [searchName, setSearchName] = useState('');
  const [filterSeries, setFilterSeries] = useState('');
  const [filterPosition, setFilterPosition] = useState('');
  const [seriesOptions, setSeriesOptions] = useState([]);
  const [positionOptions, setPositionOptions] = useState([]);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showRankingModal, setShowRankingModal] = useState(false);
  const [rankingData, setRankingData] = useState([]);
  const [rankingLoading, setRankingLoading] = useState(false);
  const limit = 20;

  // State cho feedback
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackImages, setFeedbackImages] = useState([]);
  const [uploadingFeedback, setUploadingFeedback] = useState(false);
  const [activeSubmissionId, setActiveSubmissionId] = useState(null);

  // Hàm hiển thị câu hỏi với cả 3 ngôn ngữ (cho admin)
  const getQuestionDisplay = (q) => {
    if (!q) return 'Câu hỏi không tồn tại';
    return (
      <div className={styles.questionLanguages}>
        <div className={styles.langItem}>
          <span className={styles.langLabel}>🇬🇧 English:</span>
          <span>{q.question_en || 'Không có'}</span>
        </div>
        <div className={styles.langItem}>
          <span className={styles.langLabel}>🇨🇳 中文:</span>
          <span>{q.question_zh || '没有'}</span>
        </div>
        <div className={styles.langItem}>
          <span className={styles.langLabel}>🇻🇳 Tiếng Việt:</span>
          <span>{q.question_vi || 'Không có'}</span>
        </div>
      </div>
    );
  };

  // Hàm format thời gian theo ngôn ngữ
  const formatDuration = (minutes, seconds) => {
    const currentLang = typeof window !== 'undefined' ? localStorage.getItem('language') || 'vi' : 'vi';
    if (currentLang === 'vi') {
      return `${minutes} phút ${seconds} giây`;
    } else if (currentLang === 'zh') {
      return `${minutes}分${seconds}秒`;
    } else {
      return `${minutes} min ${seconds} sec`;
    }
  };

  // Hàm tính xếp hạng thí sinh
  const calculateRanking = async () => {
    setRankingLoading(true);
    try {
      let query = supabase
        .from('exam_sessions')
        .select('*')
        .neq('status', 'in_progress');
      
      if (filterSeries) query = query.eq('series', filterSeries);
      if (filterPosition) query = query.eq('position', filterPosition);
      
      const { data: sessions, error } = await query;
      if (error) throw error;
      
      if (!sessions || sessions.length === 0) {
        setRankingData([]);
        setShowRankingModal(true);
        setRankingLoading(false);
        return;
      }
      
      const userIds = [...new Set(sessions.map(s => s.user_id).filter(Boolean))];
      let profileMap = {};
      
      if (userIds.length > 0) {
        const { data: profiles, error: profileError } = await supabase
          .from('profiles')
          .select('id, full_name, email, username')
          .in('id', userIds);
        
        if (!profileError && profiles) {
          profileMap = Object.fromEntries(profiles.map(p => [p.id, p]));
        }
      }
      
      const userStats = new Map();
      sessions.forEach(s => {
        const userId = s.user_id;
        const score = s.score || 0;
        const profile = profileMap[userId];
        
        if (!userStats.has(userId)) {
          userStats.set(userId, {
            user_id: userId,
            full_name: profile?.full_name || userId,
            username: profile?.username,
            email: profile?.email,
            totalScore: 0,
            examCount: 0,
            scores: []
          });
        }
        
        const stats = userStats.get(userId);
        stats.totalScore += score;
        stats.examCount++;
        stats.scores.push(score);
      });
      
      const ranking = Array.from(userStats.values())
        .filter(user => user.examCount > 0)
        .map(user => ({
          ...user,
          avgScore: user.totalScore / user.examCount,
          avgScoreFormatted: (user.totalScore / user.examCount).toFixed(1)
        }))
        .sort((a, b) => b.avgScore - a.avgScore)
        .map((user, index) => ({
          ...user,
          rank: index + 1
        }));
      
      setRankingData(ranking);
      setShowRankingModal(true);
    } catch (err) {
      console.error('Lỗi tính xếp hạng:', err);
      alert('Không thể tính xếp hạng: ' + err.message);
    } finally {
      setRankingLoading(false);
    }
  };

  async function loadFilterOptions() {
    try {
      // Dùng RPC thay vì select trực tiếp
      const { data: seriesData } = await supabase.rpc('get_distinct_series');
      const uniqueSeries = seriesData?.map(item => item.series).filter(Boolean) || [];
      setSeriesOptions(uniqueSeries);
  
      const { data: positionData } = await supabase.rpc('get_distinct_positions');
      const uniquePositions = positionData?.map(item => item.position).filter(Boolean) || [];
      setPositionOptions(uniquePositions);
    } catch (err) {
      console.error(err);
    }
  }
  
  useEffect(() => {
    loadFilterOptions();
  }, []);
  
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/'); return; }
      const profile = await getProfile(session.user.id).catch(() => null);
      if (profile?.role !== 'admin') { router.replace('/exam'); return; }
      fetchData();
    });
  }, [page, tab, filterSeries, filterPosition, searchName]);

  async function fetchData() {
    setLoading(true);
    try {
      if (tab === 'all') {
        let query = supabase
          .from('exam_sessions')
          .select('*, started_at, submitted_at, graded_by')
          .neq('status', 'in_progress')
          .order('submitted_at', { ascending: false });
        
        const { data: sessions, error } = await query;
        if (error) throw error;
        
        const userIds = [...new Set(sessions.map(s => s.user_id).filter(Boolean))];
        const graderIds = [...new Set(sessions.map(s => s.graded_by).filter(Boolean))];
        const allIds = [...new Set([...userIds, ...graderIds])];
        let profileMap = {};
        
        if (allIds.length > 0) {
          const { data: profiles, error: profileError } = await supabase
            .from('profiles')
            .select('id, full_name, email, username')
            .in('id', allIds);
          
          if (!profileError && profiles) {
            profileMap = Object.fromEntries(profiles.map(p => [p.id, p]));
          }
        }
        
        const sessionsWithProfiles = sessions.map(s => ({
          ...s,
          profiles: profileMap[s.user_id] || null,
          grader_profile: profileMap[s.graded_by] || null
        }));
        
        let filteredData = sessionsWithProfiles;
        if (filterSeries) filteredData = filteredData.filter(s => s.series === filterSeries);
        if (filterPosition) filteredData = filteredData.filter(s => s.position === filterPosition);
        if (searchName) {
          filteredData = filteredData.filter(s => 
            s.profiles?.full_name?.toLowerCase().includes(searchName.toLowerCase()) ||
            s.profiles?.username?.toLowerCase().includes(searchName.toLowerCase())
          );
        }
        
        setSessions(filteredData);
        setTotal(filteredData.length);
      } else {
        const { data: sessions, error } = await supabase
          .from('exam_sessions')
          .select('*')
          .eq('status', 'submitted')
          .order('submitted_at', { ascending: false });
        
        if (error) throw error;
        
        const userIds = [...new Set(sessions.map(s => s.user_id).filter(Boolean))];
        let profileMap = {};
        
        if (userIds.length > 0) {
          const { data: profiles, error: profileError } = await supabase
            .from('profiles')
            .select('id, full_name, email, username')
            .in('id', userIds);
          
          if (!profileError && profiles) {
            profileMap = Object.fromEntries(profiles.map(p => [p.id, p]));
          }
        }
        
        const sessionsWithProfiles = sessions.map(s => ({
          ...s,
          profiles: profileMap[s.user_id] || null
        }));
        
        setSubmittedSessions(sessionsWithProfiles);
      }
    } catch (err) {
      console.error('Fetch error:', err);
      alert('Lỗi tải dữ liệu: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(sessionId) {
    setDetail({ loading: true });
    try {
      const data = await getSessionDetail(sessionId);
      setDetail(data);
    } catch (err) {
      alert(err.message);
      setDetail(null);
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    
    try {
      const { error: subError } = await supabase
        .from('submissions')
        .delete()
        .eq('session_id', deleteTarget.sessionId);
      if (subError) throw subError;
      
      const { error: sessionError } = await supabase
        .from('exam_sessions')
        .delete()
        .eq('id', deleteTarget.sessionId);
      if (sessionError) throw sessionError;
      
      alert(t('delete_success'));
      fetchData();
    } catch (err) {
      alert(t('delete_failed') + err.message);
    } finally {
      setShowDeleteModal(false);
      setDeleteTarget(null);
    }
  };

  async function handleGrade(submissionId, isFullCorrect, isHalfCorrect) {
    const submission = detail.submissions.find(s => s.id === submissionId);
    const maxScore = submission?.questions_cache?.score || 0;
    let scoreToSet = 0;
    
    if (isFullCorrect) {
      scoreToSet = maxScore;
    } else if (isHalfCorrect) {
      scoreToSet = Math.round(maxScore / 2);
    } else {
      scoreToSet = 0;
    }
    
    await gradeSubmission(submissionId, scoreToSet);
    const updated = await getSessionDetail(detail.session.id);
    setDetail(updated);
  }
  async function syncQuestions() {
    setSyncing(true);
    try {
      const res = await fetch(SYNC_URL, {
        method: 'POST',
        headers: { 'x-sync-secret': process.env.NEXT_PUBLIC_SYNC_SECRET || '' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      alert(t('sync_success').replace('{count}', data.synced));
      fetchData();
    } catch (err) {
      alert(t('sync_failed') + err.message);
    } finally {
      setSyncing(false);
    }
  }

  const handlePasteFeedbackImage = async (event) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    
    const imageItems = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        imageItems.push(items[i]);
      }
    }
    
    if (imageItems.length === 0) return;
    
    if (feedbackImages.length + imageItems.length > 3) {
      alert(`⚠️ ${t('images_attached')}`);
      return;
    }
    
    setUploadingFeedback(true);
    const newImageUrls = [...feedbackImages];
    
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) continue;
      
      const fileName = `feedback_${Date.now()}_${Math.random().toString(36).substring(2)}.png`;
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
    
    setFeedbackImages(newImageUrls);
    setUploadingFeedback(false);
  };

  const removeFeedbackImage = (index) => {
    setFeedbackImages(feedbackImages.filter((_, i) => i !== index));
  };

  const saveFeedbackToDb = async (submissionId) => {
    if (!feedbackText.trim() && feedbackImages.length === 0) {
      alert(t('enter_feedback'));
      return;
    }
    
    try {
      await saveFeedback(submissionId, feedbackText, feedbackImages);
      alert('✅ ' + t('save_feedback'));
      setFeedbackText('');
      setFeedbackImages([]);
      setActiveSubmissionId(null);
      const updated = await getSessionDetail(detail.session.id);
      setDetail(updated);
    } catch (err) {
      alert('❌ ' + t('save_feedback') + ': ' + err.message);
    }
  };

  // Chi tiết bài thi
  if (detail && !detail.loading) {
    const { session, submissions } = detail;
    const totalPossible = submissions.reduce((sum, s) => sum + (s.questions_cache?.score || 0), 0);
    const currentTotal = submissions.reduce((sum, s) => sum + (s.score || 0), 0);
    const allGraded = currentTotal === totalPossible;
    
    return (
      <div className={styles.page}>
        <div className={styles.detailHeader}>
          <button className={styles.backBtn} onClick={() => setDetail(null)}>← {t('back')}</button>
          <div>
            <h2>{session.profiles?.full_name || session.user_id}</h2>
            <p>{session.profiles?.email || ''} · {t('submit_time')}: {new Date(session.submitted_at).toLocaleString()}</p>
          </div>
          <div className={styles.scoreBadge}>{t('score')}: {currentTotal}/100</div>
        </div>
        
        <div className={styles.submissionList}>
          {submissions.map((sub, idx) => {
            const q = sub.questions_cache;
            const isCorrectGraded = sub.score === (q?.score || 0);
            const isWrongGraded = sub.score === 0 && sub.graded_at;
            const questionImages = [q?.image_1, q?.image_2, q?.image_3].filter(url => url && url.trim());
            
            return (
              <div key={sub.id} className={styles.subCard}>
                <div className={styles.subHeader}>
                  <strong>{t('question')} {idx+1}:</strong>
                </div>
                
                {/* Hiển thị câu hỏi với 3 ngôn ngữ */}
                {getQuestionDisplay(q)}
                
                {/* Hiển thị 3 ảnh câu hỏi */}
                {questionImages.length > 0 && (
                  <div className={styles.questionImagesAdmin}>
                    {questionImages.map((url, imgIdx) => (
                      <img 
                        key={imgIdx}
                        src={url} 
                        alt={`Câu hỏi ảnh ${imgIdx + 1}`} 
                        className={styles.questionImgAdmin}
                        onClick={() => setLightboxImage(url)}
                        style={{ cursor: 'pointer' }}
                      />
                    ))}
                  </div>
                )}
                
                <div className={styles.subAnswer}>
                  <strong>{t('student_answer')}</strong>
                  <p className={styles.answerText}>{sub.user_answer || t('no_answer')}</p>
                </div>
                
                {sub.image_urls && sub.image_urls.length > 0 && (
                  <div className={styles.answerImages}>
                    <strong>{t('images')}</strong>
                    <div className={styles.imagesContainer}>
                      {sub.image_urls.map((url, i) => (
                        <img 
                          key={i} 
                          src={url} 
                          alt={`answer ${i+1}`} 
                          className={styles.thumbImage} 
                          onClick={() => setLightboxImage(url)}
                          style={{ cursor: 'pointer' }}
                        />
                      ))}
                    </div>
                  </div>
                )}
                
                <div className={styles.grading}>
                  <div className={styles.gradingButtons}>
                    <button 
                      className={`${styles.gradeBtn} ${sub.score === (q?.score || 0) ? styles.correctActive : ''}`}
                      onClick={() => handleGrade(sub.id, true, false)}
                    >
                      ✓ {t('correct')}
                    </button>
                    <button 
                      className={`${styles.gradeBtn} ${sub.score > 0 && sub.score < (q?.score || 0) ? styles.halfActive : ''}`}
                      onClick={() => handleGrade(sub.id, false, true)}
                    >
                      ½ {t('half_correct') || '半对'}
                    </button>
                    <button 
                      className={`${styles.gradeBtn} ${sub.score === 0 && sub.graded_at ? styles.wrongActive : ''}`}
                      onClick={() => handleGrade(sub.id, false, false)}
                    >
                      ✗ {t('wrong')}
                    </button>
                  </div>
                  <span className={styles.scoreDisplay}>
                    {t('point')}: {sub.score || 0} / {q?.score || 0}
                  </span>
                </div>

                {sub.feedback && (
                  <div className={styles.feedbackSection}>
                    <div className={styles.feedbackHeader}>📝 {t('examiner_feedback')}</div>
                    <div className={styles.feedbackText}>{sub.feedback}</div>
                    {sub.feedback_images && sub.feedback_images.length > 0 && (
                      <div className={styles.feedbackImages}>
                        {sub.feedback_images.map((url, i) => (
                          <img 
                            key={i} 
                            src={url} 
                            alt={`feedback ${i+1}`} 
                            className={styles.thumbImage}
                            onClick={() => setLightboxImage(url)}
                            style={{ cursor: 'pointer' }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {activeSubmissionId === sub.id ? (
                  <div className={styles.feedbackForm}>
                    <textarea
                      className={styles.feedbackTextarea}
                      rows={3}
                      value={feedbackText}
                      onChange={(e) => setFeedbackText(e.target.value)}
                      onPaste={handlePasteFeedbackImage}
                      placeholder={t('enter_feedback')}
                    />
                    <div className={styles.feedbackImagesContainer}>
                      <div className={styles.feedbackImagesGrid}>
                        {[0, 1, 2].map((idx) => {
                          const imageUrl = feedbackImages[idx];
                          return (
                            <div 
                              key={idx} 
                              className={`${styles.feedbackImageCard} ${imageUrl ? styles.hasImage : ''}`}
                            >
                              {imageUrl ? (
                                <>
                                  <img src={imageUrl} alt={`feedback ${idx+1}`} />
                                  <button
                                    className={styles.removeImageBtn}
                                    onClick={() => removeFeedbackImage(idx)}
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
                      {uploadingFeedback && <span className={styles.uploadingText}>⏳ {t('submitting')}</span>}
                    </div>
                    <div className={styles.feedbackActions}>
                      <button 
                        className={styles.saveFeedbackBtn} 
                        onClick={() => saveFeedbackToDb(sub.id)}
                      >
                        💾 {t('save_feedback')}
                      </button>
                      <button 
                        className={styles.cancelFeedbackBtn} 
                        onClick={() => {
                          setActiveSubmissionId(null);
                          setFeedbackText('');
                          setFeedbackImages([]);
                        }}
                      >
                        {t('cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button 
                    className={styles.addFeedbackBtn}
                    onClick={() => {
                      setActiveSubmissionId(sub.id);
                      setFeedbackText(sub.feedback || '');
                      setFeedbackImages(sub.feedback_images || []);
                    }}
                  >
                    ✏️ {sub.feedback ? t('edit_feedback') : t('add_feedback')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        
        <div className={styles.doneSection}>
          <button 
            className={styles.doneBtn} 
            onClick={() => { 
              setDetail(null); 
              setTab('all');
              setPage(1);
              fetchData();
            }}
          >
            {allGraded ? t('done_back') : t('save_and_back')}
          </button>
        </div>
  
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

  // Main admin dashboard
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('admin_dashboard')}</h1>
          <p className={styles.subtitle}>{t('manage_exams')}</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.syncBtn} onClick={syncQuestions} disabled={syncing}>
            {syncing ? '⏳...' : t('sync_questions')}
          </button>
          <button className={styles.logoutBtn} onClick={async () => { 
            await supabase.auth.signOut(); 
            router.replace('/'); 
          }}>
            {t('logout')}
          </button>
        </div>
      </header>
      
      <div className={styles.tabs}>
        <button className={tab === 'all' ? styles.activeTab : ''} onClick={() => { setTab('all'); setPage(1); }}>
          📋 {t('all_exams')}
        </button>
        <button className={tab === 'pending' ? styles.activeTab : ''} onClick={() => { setTab('pending'); setPage(1); }}>
          ⏳ {t('pending_exams')} ({submittedSessions.length})
        </button>
      </div>

      {/* Thống kê */}
      <Statistics sessions={sessions} />

      {tab === 'all' && (
        <div className={styles.filterBar}>
          <div className={styles.searchBox}>
            <input
              type="text"
              placeholder={t('search_student')}
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              className={styles.searchInput}
            />
          </div>
          <div className={styles.filterSelects}>
            <select 
              value={filterSeries} 
              onChange={(e) => setFilterSeries(e.target.value)}
              className={styles.filterSelect}
            >
              <option value="">{t('all_series')}</option>
              {seriesOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select 
              value={filterPosition} 
              onChange={(e) => setFilterPosition(e.target.value)}
              className={styles.filterSelect}
            >
              <option value="">{t('all_position')}</option>
              {positionOptions.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <button 
              className={styles.rankingBtn}
              onClick={calculateRanking}
              disabled={rankingLoading}
            >
              {rankingLoading ? '⏳ Đang tính...' : '🏆 排名'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className={styles.loadingBox}><div className={styles.spinner} /></div>
      ) : (
        <>
          {tab === 'all' && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t('student')}</th>
                    <th>{t('series')}</th>
                    <th>{t('position')}</th>
                    <th>{t('submit_time')}</th>
                    <th>{t('exam_duration')}</th>
                    <th>{t('score')}</th>
                    <th>{t('status')}</th>
                    <th>{t('grader')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.length === 0 ? (
                    <tr>
                      <td colSpan={9} className={styles.empty}>{t('no_exams')}</td>
                    </tr>
                  ) : (
                    sessions.map(s => {
                      const isFullyGraded = s.status === 'graded';
                      let examDuration = '—';
                      if (s.submitted_at && s.started_at) {
                        const diffMs = new Date(s.submitted_at) - new Date(s.started_at);
                        const diffMinutes = Math.floor(diffMs / 60000);
                        const diffSeconds = Math.floor((diffMs % 60000) / 1000);
                        examDuration = formatDuration(diffMinutes, diffSeconds);
                      }
                      
                      return (
                        <tr key={s.id}>
                          <td className={styles.nameCell}>
                            <strong>{s.profiles?.full_name || s.user_id}</strong>
                            {s.profiles?.username && (
                              <span className={styles.username}>({s.profiles.username})</span>
                            )}
                          </td>
                          <td className={styles.centerCell}>
                            <span className={styles.seriesBadge}>{s.series || '—'}</span>
                          </td>
                          <td className={styles.centerCell}>
                            <span className={styles.positionBadge}>{s.position || '—'}</span>
                          </td>
                          <td className={styles.timeCell}>
                            {s.submitted_at ? new Date(s.submitted_at).toLocaleString() : t('in_progress')}
                          </td>
                          <td className={styles.timeCell}>
                            {examDuration}
                          </td>
                          <td className={styles.centerCell}>
                            <span className={`${styles.scorePill} ${isFullyGraded ? styles.pass : styles.fail}`}>
                              {s.score || 0}/100
                            </span>
                          </td>
                          <td className={styles.centerCell}>
                            {s.score > 0 || s.status === 'graded' ? (
                              <span className={styles.badgeGraded}>✅ {t('graded')}</span>
                            ) : s.status === 'submitted' ? (
                              <span className={styles.badgePending}>⏳ {t('waiting')}</span>
                            ) : (
                              <span className={styles.badgeProgress}>📝 {t('in_progress')}</span>
                            )}
                          </td>
                          <td className={styles.centerCell}>
                            {s.graded_by ? (
                              <span className={styles.graderName}>
                                {s.grader_profile?.full_name || s.grader_profile?.username || 'Admin'}
                              </span>
                            ) : (
                              <span className={styles.notGraded}>—</span>
                            )}
                          </td>
                          <td className={styles.actionCell}>
                            <button className={styles.detailBtn} onClick={() => openDetail(s.id)}>
                              {s.status === 'submitted' ? t('grade') : t('view_detail')} →
                            </button>
                            <button 
                              className={styles.deleteBtn} 
                              onClick={() => {
                                setDeleteTarget({ 
                                  sessionId: s.id, 
                                  studentName: s.profiles?.full_name || s.user_id 
                                });
                                setShowDeleteModal(true);
                              }}
                            >
                              🗑️ {t('delete')}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'pending' && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t('student')}</th>
                    <th>{t('series')}</th>
                    <th>{t('position')}</th>
                    <th>{t('submit_time')}</th>
                    <th>{t('exam_duration')}</th>
                    <th>{t('score')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {submittedSessions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className={styles.empty}>{t('no_pending')}</td>
                    </tr>
                  ) : (
                    submittedSessions.map(s => {
                      let examDuration = '—';
                      if (s.submitted_at && s.started_at) {
                        const diffMs = new Date(s.submitted_at) - new Date(s.started_at);
                        const diffMinutes = Math.floor(diffMs / 60000);
                        const diffSeconds = Math.floor((diffMs % 60000) / 1000);
                        examDuration = formatDuration(diffMinutes, diffSeconds);
                      }
                      return (
                        <tr key={s.id}>
                          <td><strong>{s.profiles?.full_name || s.user_id}</strong></td>
                          <td><span className={styles.seriesBadge}>{s.series || '—'}</span></td>
                          <td><span className={styles.positionBadge}>{s.position || '—'}</span></td>
                          <td>{new Date(s.submitted_at).toLocaleString()}</td>
                          <td>{examDuration}</td>
                          <td className={styles.centerCell}>
                            <span className={styles.scorePending}>{(s.score || 0)}/100</span>
                          </td>
                          <td>
                            <button className={styles.detailBtn} onClick={() => openDetail(s.id)}>
                              {t('grade')} →
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Modal xếp hạng */}
      {showRankingModal && (
        <div className={styles.modalOverlay} onClick={() => setShowRankingModal(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>🏆 {t('ranking') || 'Bảng xếp hạng thí sinh'}</h3>
              <button className={styles.modalClose} onClick={() => setShowRankingModal(false)}>×</button>
            </div>
            <div className={styles.modalBody}>
              {rankingData.length === 0 ? (
                <div className={styles.emptyRanking}>Chưa có dữ liệu</div>
              ) : (
                <table className={styles.rankingTable}>
                  <thead>
                    <tr>
                      <th>{t('rank') || 'Hạng'}</th>
                      <th>{t('student') || 'Thí sinh'}</th>
                      <th>{t('username') || 'Tên đăng nhập'}</th>
                      <th>{t('exam_count') || 'Số bài thi'}</th>
                      <th>{t('avg_score') || 'Điểm TB'}</th>
                      <th>{t('scores') || 'Các lần thi'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankingData.map(user => (
                      <tr key={user.user_id} className={user.rank <= 3 ? styles.topRank : ''}>
                        <td className={styles.rankCell}>
                          {user.rank === 1 && '🥇'}
                          {user.rank === 2 && '🥈'}
                          {user.rank === 3 && '🥉'}
                          {user.rank > 3 && `${user.rank}`}
                        </td>
                        <td>{user.full_name}</td>
                        <td>{user.username || '—'}</td>
                        <td className={styles.centerCell}>{user.examCount}</td>
                        <td className={styles.centerCell}>
                          <span className={styles.avgScoreBadge}>{user.avgScoreFormatted}</span>
                        </td>
                        <td className={styles.scoresCell}>
                          {user.scores.map((s, i) => (
                            <span key={i} className={styles.scoreChip}>{s}</span>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.modalBtn} onClick={() => setShowRankingModal(false)}>Đóng</button>
            </div>
          </div>
        </div>
      )}

      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title={t('confirm')}
        message={t('delete_confirm').replace('{name}', deleteTarget?.studentName || '')}
        onConfirm={confirmDelete}
        confirmText={t('delete')}
        cancelText={t('cancel')}
      />
    </div>
  );
}
