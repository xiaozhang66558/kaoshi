import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase, getProfile, getAllSessions, getSessionDetail, getSubmittedSessions, gradeSubmission } from '../../lib/supabase';
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
  const [tab, setTab] = useState('all');

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/'); return; }
      const profile = await getProfile(session.user.id).catch(() => null);
      if (profile?.role !== 'admin') { router.replace('/exam'); return; }
      fetchData();
    });
  }, [page, tab]);

  async function fetchData() {
    setLoading(true);
    try {
      if (tab === 'all') {
        const { data, count } = await getAllSessions({ page, limit: 20 });
        setSessions(data);
        setTotal(count);
      } else {
        const data = await getSubmittedSessions();
        setSubmittedSessions(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(sessionId, isSubmitted = false) {
    setDetail({ loading: true, isSubmitted });
    try {
      const data = await getSessionDetail(sessionId);
      setDetail(data);
    } catch (err) {
      alert(err.message);
      setDetail(null);
    }
  }

  async function handleGrade(submissionId, questionId, isCorrect) {
    // Tìm submission để lấy điểm tối đa từ questions_cache
    const submission = detail.submissions.find(s => s.id === submissionId);
    const maxScore = submission.questions_cache?.score || 0;
    const scoreToSet = isCorrect ? maxScore : 0;
    
    await gradeSubmission(submissionId, scoreToSet);
    
    // Cập nhật lại detail sau khi chấm
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

  // Chi tiết bài thi (kèm giao diện chấm điểm)
  if (detail && !detail.loading) {
    const { session, submissions } = detail;
    const totalPossible = submissions.reduce((sum, s) => sum + (s.questions_cache?.score || 0), 0);
    const currentTotal = submissions.reduce((sum, s) => sum + (s.score || 0), 0);
    
    return (
      <div className={styles.page}>
        <div className={styles.detailHeader}>
          <button className={styles.backBtn} onClick={() => setDetail(null)}>← Quay lại</button>
          <div>
            <h2>{session.profiles?.full_name || session.user_id}</h2>
            <p>{session.profiles?.email || ''} · Nộp lúc {new Date(session.submitted_at).toLocaleString()}</p>
          </div>
          <div className={styles.scoreBadge}>Điểm tạm tính: {currentTotal}/{totalPossible}</div>
        </div>
        
        <div className={styles.submissionList}>
          {submissions.map((sub, idx) => {
            const q = sub.questions_cache;
            return (
              <div key={sub.id} className={styles.subCard}>
                <div className={styles.subHeader}>
                  <strong>Câu {idx+1}:</strong> {q?.question || 'Câu hỏi không tồn tại'}
                </div>
                <div className={styles.subAnswer}>
                  <strong>Câu trả lời của thí sinh:</strong>
                  <p className={styles.answerText}>{sub.user_answer || '(chưa có câu trả lời)'}</p>
                </div>
                {/* Hiển thị ảnh nếu có */}
                {sub.image_urls && sub.image_urls.length > 0 && (
                  <div className={styles.answerImages}>
                    <strong>Ảnh đính kèm:</strong>
                    <div className={styles.imagesContainer}>
                      {sub.image_urls.map((url, i) => (
                        <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                          <img src={url} alt={`answer ${i+1}`} className={styles.thumbImage} />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* 2 nút Đúng/Sai */}
                <div className={styles.grading}>
                  <div className={styles.gradingButtons}>
                    <button 
                      className={`${styles.gradeBtn} ${sub.score === (q?.score || 0) ? styles.correctActive : ''}`}
                      onClick={() => handleGrade(sub.id, sub.question_id, true)}
                    >
                      ✓ Đúng
                    </button>
                    <button 
                      className={`${styles.gradeBtn} ${sub.score === 0 && sub.graded_at ? styles.wrongActive : ''}`}
                      onClick={() => handleGrade(sub.id, sub.question_id, false)}
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
              fetchData();
            }}
          >
            ✅ Xong - Quay lại danh sách
          </button>
        </div>
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
      
      <div className={styles.tabs}>
        <button className={tab === 'all' ? styles.activeTab : ''} onClick={() => setTab('all')}>
          Tất cả bài thi
        </button>
        <button className={tab === 'pending' ? styles.activeTab : ''} onClick={() => setTab('pending')}>
          Chờ chấm điểm
        </button>
      </div>
      
      {loading ? (
        <div className={styles.loadingBox}><div className={styles.spinner} /></div>
      ) : (
        <>
          {tab === 'all' && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Thí sinh</th>
                    <th>Email</th>
                    <th>Thời gian nộp</th>
                    <th>Điểm</th>
                    <th>Trạng thái</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map(s => (
                    <tr key={s.id}>
                      <td>{s.profiles?.full_name || s.user_id}</td>
                      <td>{s.profiles?.email || ''}</td>
                      <td>{s.submitted_at ? new Date(s.submitted_at).toLocaleString() : 'Chưa nộp'}</td>
                      <td>{s.score !== null ? `${s.score}/${s.total_questions}` : '—'}</td>
                      <td>
                        {s.status === 'graded' ? 'Đã chấm' : 
                         s.status === 'submitted' ? 'Chờ chấm' : 'Đang thi'}
                      </td>
                      <td>
                        <button className={styles.detailBtn} onClick={() => openDetail(s.id)}>
                          Xem chi tiết →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          
          {tab === 'pending' && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Thí sinh</th>
                    <th>Email</th>
                    <th>Thời gian nộp</th>
                    <th>Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {submittedSessions.map(s => (
                    <tr key={s.id}>
                      <td>{s.profiles?.full_name || s.user_id}</td>
                      <td>{s.profiles?.email || ''}</td>
                      <td>{new Date(s.submitted_at).toLocaleString()}</td>
                      <td>
                        <button className={styles.detailBtn} onClick={() => openDetail(s.id, true)}>
                          Chấm điểm →
                        </button>
                      </td>
                    </tr>
                  ))}
                  {submittedSessions.length === 0 && (
                    <tr><td colSpan={4} className={styles.empty}>Chưa có bài thi nào chờ chấm</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          
          {tab === 'all' && total > 20 && (
            <div className={styles.pagination}>
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Trước</button>
              <span>Trang {page} / {Math.ceil(total / 20)}</span>
              <button disabled={page >= Math.ceil(total / 20)} onClick={() => setPage(p => p + 1)}>Tiếp →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
