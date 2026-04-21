// src/components/LanguageSelector.jsx
import { useLanguage } from '../contexts/LanguageContext';
import styles from '../styles/languageSelector.module.css';

export default function LanguageSelector() {
  const { language, changeLanguage, t } = useLanguage();

  const languages = [
    { code: 'vi', label: 'VN', name: 'Tiếng Việt' },
    { code: 'zh', label: '中文', name: '中文' },
    { code: 'en', label: 'EN', name: 'English' }
  ];

  return (
    <div className={styles.languageSelector}>
      {languages.map((lang) => (
        <button
          key={lang.code}
          className={`${styles.langBtn} ${language === lang.code ? styles.active : ''}`}
          onClick={() => changeLanguage(lang.code)}
          title={lang.name}
        >
          {lang.label}
        </button>
      ))}
    </div>
  );
}
