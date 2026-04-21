import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase, getProfile, getAllSessions, getSessionDetail, getSubmittedSessions, gradeSubmission } from '../../lib/supabase';
import Modal from '../../components/Modal';
import styles from '../../styles/admin.module.css';

const SYNC_URL = '/.netlify/functions/sync-questions';

export default function AdminPage() {
  const router = useRouter();
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
  const limit = 20;

  // Lấy danh sách series và position để hiển thị trong dropdown
  async function loadFilterOptions() {
    try {
      const { data: seriesData } = await supabase
        .from('questions_cache')
        .select('series')
        .eq('is_active', true)
        .not('series', 'is', null);
      const uniqueSeries = [...new Set(seriesData.map(item => item.series).filter(Boolean))];
      setSeriesOptions(uniqueSeries);
  
      const { data: positionData } = await supabase
        .from('questions_cache')
        .select('position')
        .eq('is_active', true)
        .not('position', 'is', null);
      const uniquePositions = [...new Set(positionData.map(item => item.position).filter(Boolean))];
      setPositionOptions(uniquePositions);
    } catch (err) {
      console.error(err);
    }
  }
  
  // Gọi hàm này trong useEffect khi component mount
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
        // Lấy tất cả session (không join)
        let query = supabase
          .from('exam_sessions')
          .select('*')
          .neq('status', 'in_progress')
          .order('submitted_at', { ascending: false });
        
        const { data: sessions, error } = await query;
        if (error) throw error;
        
        console.log('Sessions:', sessions);
        
        // Lấy thông tin profiles riêng
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
        
        // Gắn profiles vào từng session
        const sessionsWithProfiles = sessions.map(s => ({
          ...s,
          profiles: profileMap[s.user_id] || null
        }));
        
        // Lọc theo series, position, searchName
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
        // Tương tự cho submittedSessions
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

  // Xác nhận xoá bài thi
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    
    try {
      // Xóa submissions trước
      const { error: subError } = await supabase
        .from('submissions')
        .delete()
        .eq('session_id', deleteTarget.sessionId);
      if (subError) throw subError;
      
      // Xóa session
      const { error: sessionError } = await supabase
        .from('exam_sessions')
        .delete()
        .eq('id', deleteTarget.sessionId);
      if (sessionError) throw sessionError;
      
      alert('✅ Đã xoá bài thi thành công!');
      fetchData();
    } catch (err) {
      alert('❌ Xoá thất bại: ' + err.message);
    } finally {
      setShowDeleteModal(false);
      setDeleteTarget(null);
    }
  };

  async function handleGrade(submissionId, isCorrect) {
    const submission = detail.submissions.find(s => s.id === submissionId);
    const maxScore = submission?.questions_cache?.score || 0;
    const scoreToSet = isCorrect ? maxScore : 0;
    
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
      alert(`✅ Sync thành công! Đã cập nhật ${data.synced} câu hỏi.`);
      fetchData();
    } catch (err) {
      alert(`❌ Sync lỗi: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  }

  // Chi tiết bài thi với 2 nút Đúng/Sai
  if (detail && !detail.loading) {
    const { session, submissions } = detail;
    const totalPossible = submissions.reduce((sum, s) => sum + (s.questions_cache?.score || 0), 0);
    const currentTotal = submissions.reduce((sum, s) => sum + (s.score || 0), 0);
    const allGraded = currentTotal === totalPossible;
    
    return (
      <div className={styles.page}>
        <div className={styles.detailHeader}>
          <button className={styles.backBtn} onClick={() => setDetail(null)}>← Quay lại</button>
          <div>
            <h2>{session.profiles?.full_name || session.user_id}</h2>
            <p>{session.profiles?.email || ''} · Nộp lúc {new Date(session.submitted_at).toLocaleString()}</p>
          </div>
          <div className={styles.scoreBadge}>Điểm: {currentTotal}/{totalPossible}</div>
        </div>
        
        <div className={styles.submissionList}>
          {submissions.map((sub, idx) => {
            const q = sub.questions_cache;
            const isCorrectGraded = sub.score === (q?.score || 0);
            const isWrongGraded = sub.score === 0 && sub.graded_at;
            
            return (
              <div key={sub.id} className={styles.subCard}>
                <div className={styles.subHeader}>
                  <strong>Câu {idx+1}:</strong> {q?.question || 'Câu hỏi không tồn tại'}
                </div>
                <div className={styles.subAnswer}>
                  <strong>Câu trả lời của thí sinh:</strong>
                  <p className={styles.answerText}>{sub.user_answer || '(chưa có câu trả lời)'}</p>
                </div>
                
                {/* Hiển thị ảnh - bấm vào để xem to */}
                {sub.image_urls && sub.image_urls.length > 0 && (
                  <div className={styles.answerImages}>
                    <strong>Ảnh đính kèm:</strong>
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
                
                {/* 2 nút Đúng/Sai */}
                <div className={styles.grading}>
                  <div className={styles.gradingButtons}>
                    <button 
                      className={`${styles.gradeBtn} ${isCorrectGraded ? styles.correctActive : ''}`}
                      onClick={() => handleGrade(sub.id, true)}
                    >
                      ✓ Đúng
                    </button>
                    <button 
                      className={`${styles.gradeBtn} ${isWrongGraded ? styles.wrongActive : ''}`}
                      onClick={() => handleGrade(sub.id, false)}
                    >
                      ✗ Sai
                    </button>
                  </div>
                  <span className={styles.scoreDisplay}>
                    Điểm: {sub.score || 0} / {q?.score || 0}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        
        {/* Nút Xong */}
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
            {allGraded ? '✅ Xong - Quay lại danh sách' : '📝 Lưu và quay lại'}
          </button>
        </div>
  
        {/* Modal xem ảnh to */}
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
          <h1 className={styles.title}>Admin Dashboard</h1>
          <p className={styles.subtitle}>Quản lý bài thi và chấm điểm</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.syncBtn} onClick={syncQuestions} disabled={syncing}>
            {syncing ? '⏳ Đang sync...' : '🔄 Sync Google Sheets'}
          </button>
          <button className={styles.logoutBtn} onClick={async () => { 
            await supabase.auth.signOut(); 
            router.replace('/'); 
          }}>
            Đăng xuất
          </button>
        </div>
      </header>
      
      {/* Tabs */}
      <div className={styles.tabs}>
        <button className={tab === 'all' ? styles.activeTab : ''} onClick={() => { setTab('all'); setPage(1); }}>
          📋 Tất cả bài thi
        </button>
        <button className={tab === 'pending' ? styles.activeTab : ''} onClick={() => { setTab('pending'); setPage(1); }}>
          ⏳ Chờ chấm điểm ({submittedSessions.length})
        </button>
      </div>

      {/* Bộ lọc - chỉ hiển thị khi ở tab "Tất cả bài thi" */}
      {tab === 'all' && (
        <div className={styles.filterBar}>
          <div className={styles.searchBox}>
            <input
              type="text"
              placeholder="🔍 Tìm theo tên thí sinh..."
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
              <option value="">📋 Tất cả系列</option>
              {seriesOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select 
              value={filterPosition} 
              onChange={(e) => setFilterPosition(e.target.value)}
              className={styles.filterSelect}
            >
              <option value="">📋 Tất cả岗位</option>
              {positionOptions.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Nội dung chính */}
      {loading ? (
        <div className={styles.loadingBox}><div className={styles.spinner} /></div>
      ) : (
        <>
          {/* Tab Tất cả bài thi */}
          {tab === 'all' && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Thí sinh</th>
                    <th>系列 (Series)</th>
                    <th>岗位 (Position)</th>
                    <th>Thời gian nộp</th>
                    <th>Điểm</th>
                    <th>Trạng thái</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className={styles.empty}>
                        {loading ? '⏳ Đang tải...' : '📭 Chưa có bài thi nào'}
                      </td>
                    </tr>
                  ) : (
                    sessions.map(s => {
                      const isFullyGraded = s.status === 'graded';
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
                            {s.submitted_at ? new Date(s.submitted_at).toLocaleString() : 'Chưa nộp'}
                          </td>
                          <td className={styles.centerCell}>
                            <span className={`${styles.scorePill} ${isFullyGraded ? styles.pass : styles.fail}`}>
                              {s.score || 0}/{s.total_questions || 0}
                            </span>
                          </td>
                          <td className={styles.centerCell}>
                            {s.status === 'graded' ? (
                              <span className={styles.badgeGraded}>✅ Đã chấm</span>
                            ) : s.status === 'submitted' ? (
                              <span className={styles.badgePending}>⏳ Chờ chấm</span>
                            ) : (
                              <span className={styles.badgeProgress}>📝 Đang thi</span>
                            )}
                          </td>
                          <td className={styles.actionCell}>
                            <button className={styles.detailBtn} onClick={() => openDetail(s.id)}>
                              {s.status === 'submitted' ? 'Chấm điểm →' : 'Xem chi tiết →'}
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
                              🗑️ Xoá
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

          {/* Tab Chờ chấm điểm */}
          {tab === 'pending' && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Thí sinh</th>
                    <th>系列 (Series)</th>
                    <th>岗位 (Position)</th>
                    <th>Thời gian nộp</th>
                    <th>Điểm</th>
                    <th>Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {submittedSessions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className={styles.empty}>🎉 Không có bài thi nào chờ chấm!</td>
                    </tr>
                  ) : (
                    submittedSessions.map(s => (
                      <tr key={s.id}>
                        <td><strong>{s.profiles?.full_name || s.user_id}</strong></td>
                        <td><span className={styles.seriesBadge}>{s.series || '—'}</span></td>
                        <td><span className={styles.positionBadge}>{s.position || '—'}</span></td>
                        <td className={styles.timeCell}>
                          {new Date(s.submitted_at).toLocaleString()}
                        </td>
                        <td className={styles.centerCell}>
                          <span className={styles.scorePending}>{(s.score || 0)}/{s.total_questions || 0}</span>
                        </td>
                        <td>
                          <button className={styles.detailBtn} onClick={() => openDetail(s.id)}>
                            Chấm điểm →
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Modal xác nhận xoá */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Xác nhận xoá"
        message={`Bạn có chắc chắn muốn xoá bài thi của thí sinh "${deleteTarget?.studentName}"?\nHành động này không thể hoàn tác!`}
        onConfirm={confirmDelete}
        confirmText="Xoá"
        cancelText="Hủy"
      />
    </div>
  );
}
