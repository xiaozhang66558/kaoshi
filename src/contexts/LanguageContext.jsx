// src/contexts/LanguageContext.jsx
import { createContext, useState, useContext, useEffect } from 'react';
import locales from '../locales';

const LanguageContext = createContext();

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState('vi'); // vi, zh, en

  useEffect(() => {
    const savedLang = localStorage.getItem('language');
    if (savedLang && ['vi', 'zh', 'en'].includes(savedLang)) {
      setLanguage(savedLang);
    }
  }, []);

  const changeLanguage = (lang) => {
    setLanguage(lang);
    localStorage.setItem('language', lang);
  };

  const t = (key) => {
    return locales[language]?.[key] || locales.vi[key] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, changeLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
}
