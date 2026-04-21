import { useEffect, useState } from 'react';
import { Chart as ChartJS, Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { useLanguage } from '../contexts/LanguageContext';
import styles from '../styles/statistics.module.css';

ChartJS.register(Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title);

export default function Statistics({ sessions }) {
  const { t } = useLanguage();
  const [stats, setStats] = useState({
    avgScore: 0,
    avgTime: 0,
    avgTimeFormatted: '0 phút 0 giây',
    totalExams: 0,
    seriesStats: [],
    positionStats: []
  });

  // Hàm format thời gian theo ngôn ngữ (có fallback)
  const formatTimeByLang = (minutes, seconds) => {
    const currentLang = typeof window !== 'undefined' ? localStorage.getItem('language') || 'vi' : 'vi';
    
    if (currentLang === 'vi') {
      return `${minutes} phút ${seconds} giây`;
    } else if (currentLang === 'zh') {
      return `${minutes}分${seconds}秒`;
    } else {
      return `${minutes} min ${seconds} sec`;
    }
  };

  useEffect(() => {
    if (!sessions || sessions.length === 0) return;

    // Tính tổng điểm trung bình
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
    
    // Format thời gian theo ngôn ngữ (dùng hàm fallback)
    const mins = Math.floor(avgTime / 60);
    const secs = Math.floor(avgTime % 60);
    const avgTimeFormatted = formatTimeByLang(mins, secs);

    // Thống kê theo series
    const seriesMap = new Map();
    sessions.forEach(s => {
      const seriesName = s.series || t('other') || 'Khác';
      if (!seriesMap.has(seriesName)) {
        seriesMap.set(seriesName, { total: 0, count: 0 });
      }
      seriesMap.get(seriesName).total += (s.score || 0);
      seriesMap.get(seriesName).count++;
    });
    const seriesStats = Array.from(seriesMap.entries())
      .map(([name, data]) => ({
        name,
        avg: data.total / data.count,
        count: data.count
      }))
      .sort((a, b) => b.avg - a.avg);

    // Thống kê theo position
    const positionMap = new Map();
    sessions.forEach(s => {
      const positionName = s.position || t('other') || 'Khác';
      if (!positionMap.has(positionName)) {
        positionMap.set(positionName, { total: 0, count: 0 });
      }
      positionMap.get(positionName).total += (s.score || 0);
      positionMap.get(positionName).count++;
    });
    const positionStats = Array.from(positionMap.entries())
      .map(([name, data]) => ({
        name,
        avg: data.total / data.count,
        count: data.count
      }))
      .sort((a, b) => b.avg - a.avg);

    setStats({
      avgScore: avgScore.toFixed(1),
      avgTime: avgTime,
      avgTimeFormatted,
      totalExams: sessions.length,
      seriesStats,
      positionStats
    });
  }, [sessions, t]);

  // Dữ liệu biểu đồ cột cho series
  const seriesBarData = {
    labels: stats.seriesStats.map(s => s.name),
    datasets: [
      {
        label: t('avg_score') || 'Điểm trung bình',
        data: stats.seriesStats.map(s => s.avg),
        backgroundColor: 'rgba(79, 70, 229, 0.7)',
        borderRadius: 8,
        barPercentage: 0.7,
      },
    ],
  };

  // Dữ liệu biểu đồ cột cho position
  const positionBarData = {
    labels: stats.positionStats.map(p => p.name),
    datasets: [
      {
        label: t('avg_score') || 'Điểm trung bình',
        data: stats.positionStats.map(p => p.avg),
        backgroundColor: 'rgba(16, 185, 129, 0.7)',
        borderRadius: 8,
        barPercentage: 0.7,
      },
    ],
  };

  const barOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          font: { size: 11 },
          boxWidth: 12,
        },
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            return `${t('avg_score') || 'Điểm TB'}: ${context.raw.toFixed(1)} ${t('points') || 'điểm'}`;
          }
        }
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        max: 100,
        title: {
          display: true,
          text: t('score') || 'Điểm',
          font: { size: 11 },
        },
        grid: {
          color: '#e2e8f0',
        },
      },
      x: {
        ticks: {
          font: { size: 10 },
        },
      },
    },
  };

  if (sessions.length === 0) {
    return (
      <div className={styles.statisticsEmpty}>
        <p>📊 {t('no_stats_data') || 'Chưa có dữ liệu thống kê'}</p>
      </div>
    );
  }

  return (
    <div className={styles.statistics}>
      <div className={styles.statsHeader}>
        <h3>📊 {t('exam_statistics') || 'Thống kê bài thi'}</h3>
      </div>

      <div className={styles.statsCards}>
        <div className={styles.statCard}>
          <div className={styles.statIcon}>📝</div>
          <div className={styles.statInfo}>
            <div className={styles.statValue}>{stats.totalExams}</div>
            <div className={styles.statLabel}>{t('total_exams') || 'Tổng số bài thi'}</div>
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statIcon}>⭐</div>
          <div className={styles.statInfo}>
            <div className={styles.statValue}>{stats.avgScore}</div>
            <div className={styles.statLabel}>{t('avg_score_label') || 'Điểm trung bình'}</div>
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statIcon}>⏱️</div>
          <div className={styles.statInfo}>
            <div className={styles.statValue}>{stats.avgTimeFormatted}</div>
            <div className={styles.statLabel}>{t('avg_time_label') || 'Thời gian TB'}</div>
          </div>
        </div>
      </div>

      <div className={styles.chartsContainer}>
        <div className={styles.chartCard}>
          <div className={styles.chartTitle}>
            <span>📊 {t('avg_score_by_series') || 'Điểm TB theo 系列'}</span>
          </div>
          <div className={styles.barChartContainer}>
            {stats.seriesStats.length > 0 ? (
              <Bar data={seriesBarData} options={barOptions} />
            ) : (
              <div className={styles.noData}>{t('no_data') || 'Chưa có dữ liệu'}</div>
            )}
          </div>
          <div className={styles.chartLegend}>
            {stats.seriesStats.map((s, idx) => (
              <div key={idx} className={styles.legendItem}>
                <span className={styles.legendColor} style={{ backgroundColor: '#4f46e5' }}></span>
                <span>{s.name}: {s.avg.toFixed(1)} {t('points') || 'điểm'} ({s.count} {t('exams_count') || 'bài'})</span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.chartCard}>
          <div className={styles.chartTitle}>
            <span>📊 {t('avg_score_by_position') || 'Điểm TB theo 岗位'}</span>
          </div>
          <div className={styles.barChartContainer}>
            {stats.positionStats.length > 0 ? (
              <Bar data={positionBarData} options={barOptions} />
            ) : (
              <div className={styles.noData}>{t('no_data') || 'Chưa có dữ liệu'}</div>
            )}
          </div>
          <div className={styles.chartLegend}>
            {stats.positionStats.map((p, idx) => (
              <div key={idx} className={styles.legendItem}>
                <span className={styles.legendColor} style={{ backgroundColor: '#10b981' }}></span>
                <span>{p.name}: {p.avg.toFixed(1)} {t('points') || 'điểm'} ({p.count} {t('exams_count') || 'bài'})</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
