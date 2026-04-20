if (phase === 'result') return (
  <div className={styles.center}>
    <div className={styles.resultCard}>
      <div className={styles.pendingIcon}>📝</div>
      <h2 className={styles.resultTitle}>Bài thi đã được nộp!</h2>
      <p className={styles.resultStat}>
        Cảm ơn bạn đã hoàn thành bài thi.<br />
        Kết quả sẽ được admin chấm điểm và cập nhật sau.
      </p>
      <button className={styles.startBtn} onClick={() => {
        supabase.auth.signOut();
        router.replace('/');
      }}>Về trang chủ</button>
    </div>
  </div>
);
