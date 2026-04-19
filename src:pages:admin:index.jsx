import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase, getProfile, getAllSessions, getSessionDetail } from '../../lib/supabase';
import styles from '../../styles/admin.module.css';

const SYNC_URL = '/.netlify/functions/sync-questions';

export default function AdminPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/'); return; }
      const profile = await getProfile(session.user.id).catch(() => null);
      if (profile?.role !== 'admin') { router.replace('/exam'); return; }
      fetchSessions();
    });
  }, [page]);

  async function fetchSessions() {
    setLoading(true);
    try {
      const { data, count } = await getAllSessions({ page, limit: 20 });
      setSessions(data);
      setTotal(count);
    } catch (err) {
      console.error(err);
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

  const filtered = sessions.filter(s =>
    !search ||
    s.profiles?.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    s.profiles?.email?.toLowerCase().includes(search.toLowerCase())
  );

  if (detail && !detail.loading) return (
    <div className={styles.page}>
      <div className={styles.detailHeader}>
        <button className={styles.backBtn} onClick={() => setDetail(null)}>← Quay lại</button>
        <div>
          <h2 className={styles.detailName}>{detail.session.profiles?.full_name}</h2>
          <p className={styles.detailMeta}>
            {detail.session.profiles?.email} · {new Date(detail.session.submitted_at).toLocaleString('vi-VN')}
          </p>
        </div>
        <div className={`${styles.scoreBadge} ${detail.session.score >= 70 ? styles.pass : styles.fail}`}>
          {detail.session.score} điểm
        </div>
      </div>
      <div className={styles.detailStats}>
        <div className={styles.statBox}><span className={styles.statNum}>{detail.session.correct_count}</span><span className={styles.statLabel}>Câu đúng</span></div>
        <div className={styles.statBox}><span className={styles.statNum}>{detail.session.total_questions - detail.session.correct_count}</span><span className={styles.statLabel}>Câu sai</span></div>
        <div className={styles.statBox}><span className={styles.statNum}>{detail.session.total_questions}</span><span className={styles.statLabel}>Tổng câu</span></div>
        <div className={styles.statBox}><span className={styles.statNum}>{detail.session.duration_minutes} phút</span><span className={styles.statLabel}>Thời gian</span></div>
      </div>
      <div className={styles.submissionList}>
        {detail.submissions.map((sub, idx) => {
          const q = sub.questions_cache;
          return (
            <div key={sub.id} className={`${styles.subCard} ${sub.is_correct ? styles.correct : styles.wrong}`}>
              <div className={styles.subHeader}>
                <span className={styles.subNum}>Câu {idx + 1}</span>
                {q?.topic && <span className={styles.subTopic}>{q.topic}</span>}
                <span className={`${styles.subResult} ${sub.is_correct ? styles.correct : styles.wrong}`}>
                  {sub.is_correct ? '✓ Đúng' : '✗ Sai'}
                </span>
              </div>
              <p className={styles.subQuestion}>{q?.question}</p>
              <div className={styles.subAnswers}>
                {['a','b','c','d'].map(opt => (
                  <div key={opt} className={`${styles.subOpt} ${q?.correct_answer === opt ? styles.correctOpt : ''} ${sub.user_answer === opt && !sub.is_correct ? styles.wrongOpt : ''}`}>
                    <span className={styles.optLetter}>{opt.toUpperCase()}</span>
                    {q?.[`option_${opt}`]}
                    {q?.correct_answer === opt && <span className={styles.correctTag}>✓ Đáp án</span>}
                    {sub.user_answer === opt && <span className={styles.chosenTag}>Đã chọn</span>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div><h1 className={styles.title}>Admin Dashboard</h1><p className={styles.subtitle}>{total} bài thi đã nộp</p></div>
        <div className={styles.headerActions}>
          <button className={styles.syncBtn} onClick={syncQuestions} disabled={syncing}>{syncing ? '⏳ Đang sync...' : '🔄 Sync Google Sheets'}</button>
          <button className={styles.logoutBtn} onClick={async () => { await supabase.auth.signOut(); router.replace('/'); }}>Đăng xuất</button>
        </div>
      </header>
      <div className={styles.searchBar}>
        <input className={styles.searchInput} type="text" placeholder="🔍 Tìm theo tên hoặc email thí sinh..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      {loading ? (
        <div className={styles.loadingBox}><div className={styles.spinner} /></div>
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Thí sinh</th><th>Email</th><th>Thời gian nộp</th><th>Câu đúng</th><th>Điểm</th><th>Kết quả</th><th></th></tr></thead>
              <tbody>
                {filtered.length === 0 ? <tr><td colSpan={7} className={styles.empty}>Chưa có bài thi nào</td></tr> : filtered.map(s => (
                  <tr key={s.id}>
                    <td className={styles.nameCell}>{s.profiles?.full_name || '—'}</td>
                    <td className={styles.emailCell}>{s.profiles?.email}</td>
                    <td className={styles.timeCell}>{s.submitted_at ? new Date(s.submitted_at).toLocaleString('vi-VN') : <span className={styles.inProgress}>Đang thi</span>}</td>
                    <td className={styles.centerCell}>{s.correct_count ?? '—'} / {s.total_questions ?? '—'}</td>
                    <td className={styles.centerCell}><span className={`${styles.scorePill} ${(s.score ?? 0) >= 70 ? styles.pass : styles.fail}`}>{s.score ?? '—'}</span></td>
                    <td className={styles.centerCell}>{s.score !== null && <span className={`${styles.resultText} ${s.score >= 70 ? styles.passText : styles.failText}`}>{s.score >= 70 ? 'Đạt' : 'Không đạt'}</span>}</td>
                    <td><button className={styles.detailBtn} onClick={() => openDetail(s.id)}>Xem chi tiết →</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > 20 && <div className={styles.pagination}><button disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Trước</button><span>Trang {page} / {Math.ceil(total / 20)}</span><button disabled={page >= Math.ceil(total / 20)} onClick={() => setPage(p => p + 1)}>Tiếp →</button></div>}
        </>
      )}
    </div>
  );
}