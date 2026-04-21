import '../styles/globals.css';
import { LanguageProvider } from '../contexts/LanguageContext';

export default function MyApp({ Component, pageProps }) {
  return (
    <LanguageProvider>
      <Component {...pageProps} />
    </LanguageProvider>
  );
}
