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
  const [tab, setTab] = useState('all'); // 'all' or 'pending'

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

  async function handleGrade(submissionId, currentScore, newScore) {
    if (currentScore === newScore) return;
    await gradeSubmission(submissionId, newScore);
    // Cập nhật lại detail
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
    } catch (err) {
      alert(`❌ Sync lỗi: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  }

  // Chi tiết bài thi (kèm giao diện chấm điểm)
  if (detail && !detail.loading) {
    const { session, submissions } = detail;
    const totalPossible = session.total_questions;
    const currentTotal = submissions.reduce((sum, s) => sum + (s.score || 0), 0);
    return (
      <div className={styles.page}>
        <div className={styles.detailHeader}>
          <button className={styles.backBtn} onClick={() => setDetail(null)}>← Quay lại</button>
          <div>
            <h2>{session.profiles?.full_name}</h2>
            <p>{session.profiles?.email} · Nộp lúc {new Date(session.submitted_at).toLocaleString()}</p>
          </div>
          <div className={styles.scoreBadge}>Điểm tạm tính: {currentTotal}/{totalPossible}</div>
        </div>
        <div className={styles.submissionList}>
          {submissions.map((sub, idx) => {
            const q = sub.questions_cache;
            return (
              <div key={sub.id} className={styles.subCard}>
                <div className={styles.subHeader}>
                  <strong>Câu {idx+1}:</strong> {q?.question}
                </div>
                <div className={styles.subAnswer}>
                  <span>Thí sinh chọn: </span>
                  <strong>{sub.user_answer?.toUpperCase()} - {q?.[`option_${sub.user_answer}`]}</strong>
                </div>
                <div className={styles.grading}>
                  <label>Điểm (0-1): </label>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="1"
                    value={sub.score || 0}
                    onChange={(e) => handleGrade(sub.id, sub.score, parseInt(e.target.value))}
                    style={{ width: '60px', marginLeft: '8px' }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 20, fontWeight: 'bold' }}>
          Tổng điểm: {currentTotal} / {totalPossible}
          {currentTotal === totalPossible && <span style={{ color: 'green' }}> (Đã chấm xong)</span>}
        </div>
      </div>
    );
  }

  // Main admin dashboard
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div><h1>Admin Dashboard</h1><p>Quản lý bài thi và chấm điểm</p></div>
        <div>
          <button className={styles.syncBtn} onClick={syncQuestions} disabled={syncing}>{syncing ? 'Đang sync...' : '🔄 Sync câu hỏi'}</button>
          <button className={styles.logoutBtn} onClick={async () => { await supabase.auth.signOut(); router.replace('/'); }}>Đăng xuất</button>
        </div>
      </header>
      <div className={styles.tabs}>
        <button className={tab === 'all' ? styles.activeTab : ''} onClick={() => setTab('all')}>Tất cả bài thi</button>
        <button className={tab === 'pending' ? styles.activeTab : ''} onClick={() => setTab('pending')}>Chờ chấm điểm</button>
      </div>
      {loading ? (
        <div>Đang tải...</div>
      ) : (
        <>
          {tab === 'all' && (
            <table className={styles.table}>
              <thead><tr><th>Thí sinh</th><th>Email</th><th>Thời gian nộp</th><th>Điểm</th><th>Trạng thái</th><th></th></tr></thead>
              <tbody>
                {sessions.map(s => (
                  <tr key={s.id}>
                    <td>{s.profiles?.full_name}</td>
                    <td>{s.profiles?.email}</td>
                    <td>{s.submitted_at ? new Date(s.submitted_at).toLocaleString() : 'Chưa nộp'}</td>
                    <td>{s.score !== null ? `${s.score}/${s.total_questions}` : '—'}</td>
                    <td>{s.status === 'graded' ? 'Đã chấm' : s.status === 'submitted' ? 'Chờ chấm' : 'Đang thi'}</td>
                    <td><button onClick={() => openDetail(s.id)}>Xem chi tiết</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === 'pending' && (
            <table className={styles.table}>
              <thead><tr><th>Thí sinh</th><th>Email</th><th>Thời gian nộp</th><th>Hành động</th></tr></thead>
              <tbody>
                {submittedSessions.map(s => (
                  <tr key={s.id}>
                    <td>{s.profiles?.full_name}</td>
                    <td>{s.profiles?.email}</td>
                    <td>{new Date(s.submitted_at).toLocaleString()}</td>
                    <td><button onClick={() => openDetail(s.id, true)}>Chấm điểm</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
