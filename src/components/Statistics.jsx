import { useEffect, useState } from 'react';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title } from 'chart.js';
import { Pie, Bar } from 'react-chartjs-2';
import styles from '../styles/statistics.module.css';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title);

export default function Statistics({ sessions }) {
  const [stats, setStats] = useState({
    avgScore: 0,
    avgTime: 0,
    totalExams: 0,
    seriesStats: [],
    positionStats: []
  });

  useEffect(() => {
    if (!sessions || sessions.length === 0) return;

    // Tính tổng điểm
    const totalScore = sessions.reduce((sum, s) => sum + (s.score || 0), 0);
    const avgScore = totalScore / sessions.length;

    // Tính thời gian làm bài trung bình (giây)
    let totalTime = 0;
    let timeCount = 0;
    sessions.forEach(s => {
      if (s.submitted_at && s.started_at) {
        const diffMs = new Date(s.submitted_at) - new Date(s.started_at);
        totalTime += diffMs / 1000;
        timeCount++;
      }
    });
    const avgTime = timeCount > 0 ? totalTime / timeCount : 0;

    // Thống kê theo series
    const seriesMap = new Map();
    sessions.forEach(s => {
      if (s.series) {
        if (!seriesMap.has(s.series)) {
          seriesMap.set(s.series, { total: 0, count: 0 });
        }
        seriesMap.get(s.series).total += (s.score || 0);
        seriesMap.get(s.series).count++;
      }
    });
    const seriesStats = Array.from(seriesMap.entries()).map(([name, data]) => ({
      name,
      avg: data.total / data.count,
      count: data.count
    }));

    // Thống kê theo position
    const positionMap = new Map();
    sessions.forEach(s => {
      if (s.position) {
        if (!positionMap.has(s.position)) {
          positionMap.set(s.position, { total: 0, count: 0 });
        }
        positionMap.get(s.position).total += (s.score || 0);
        positionMap.get(s.position).count++;
      }
    });
    const positionStats = Array.from(positionMap.entries()).map(([name, data]) => ({
      name,
      avg: data.total / data.count,
      count: data.count
    }));

    setStats({
      avgScore: avgScore.toFixed(1),
      avgTime: formatTime(avgTime),
      totalExams: sessions.length,
      seriesStats,
      positionStats
    });
  }, [sessions]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins} phút ${secs} giây`;
  };

  // Dữ liệu biểu đồ tròn cho series
  const pieData = {
    labels: stats.seriesStats.map(s => s.name),
    datasets: [
      {
        label: 'Điểm trung bình',
        data: stats.seriesStats.map(s => s.avg),
        backgroundColor: ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'],
        borderWidth: 0,
      },
    ],
  };

  // Dữ liệu biểu đồ cột cho position
  const barData = {
    labels: stats.positionStats.map(p => p.name),
    datasets: [
      {
        label: 'Điểm trung bình',
        data: stats.positionStats.map(p => p.avg),
        backgroundColor: '#4f46e5',
        borderRadius: 8,
      },
    ],
  };

  const barOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
      },
      title: {
        display: false,
      },
    },
  };

  if (sessions.length === 0) {
    return (
      <div className={styles.statisticsEmpty}>
        <p>📊 Chưa có dữ liệu thống kê</p>
      </div>
    );
  }

  return (
    <div className={styles.statistics}>
      <div className={styles.statsHeader}>
        <h3>📊 Thống kê bài thi</h3>
      </div>

      <div className={styles.statsCards}>
        <div className={styles.statCard}>
          <div className={styles.statIcon}>📝</div>
          <div className={styles.statInfo}>
            <div className={styles.statValue}>{stats.totalExams}</div>
            <div className={styles.statLabel}>Tổng số bài thi</div>
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statIcon}>⭐</div>
          <div className={styles.statInfo}>
            <div className={styles.statValue}>{stats.avgScore}</div>
            <div className={styles.statLabel}>Điểm trung bình</div>
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statIcon}>⏱️</div>
          <div className={styles.statInfo}>
            <div className={styles.statValue}>{stats.avgTime}</div>
            <div className={styles.statLabel}>Thời gian TB</div>
          </div>
        </div>
      </div>

      <div className={styles.chartsContainer}>
        <div className={styles.chartCard}>
          <div className={styles.chartTitle}>
            <span>📊 Điểm TB theo 系列</span>
          </div>
          <div className={styles.pieChartContainer}>
            {stats.seriesStats.length > 0 ? (
              <Pie data={pieData} options={{ maintainAspectRatio: true }} />
            ) : (
              <div className={styles.noData}>Chưa có dữ liệu</div>
            )}
          </div>
          <div className={styles.chartLegend}>
            {stats.seriesStats.map((s, idx) => (
              <div key={idx} className={styles.legendItem}>
                <span className={styles.legendColor} style={{ backgroundColor: ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'][idx % 6] }}></span>
                <span>{s.name}: {s.avg} điểm ({s.count} bài)</span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.chartCard}>
          <div className={styles.chartTitle}>
            <span>📊 Điểm TB theo 岗位</span>
          </div>
          <div className={styles.barChartContainer}>
            {stats.positionStats.length > 0 ? (
              <Bar data={barData} options={barOptions} />
            ) : (
              <div className={styles.noData}>Chưa có dữ liệu</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
