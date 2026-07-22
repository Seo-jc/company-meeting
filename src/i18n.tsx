import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

export type Lang = 'ko' | 'en';

const LANG_KEY = 'appLanguage';

/** Read the persisted language without React (for non-component code, e.g. lib/). */
export function getLang(): Lang {
  const v = (typeof localStorage !== 'undefined' && localStorage.getItem(LANG_KEY)) || '';
  return v === 'en' ? 'en' : 'ko';
}

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
};

const LanguageContext = createContext<Ctx>({
  lang: 'ko',
  setLang: () => undefined,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => getLang());

  const setLang = (l: Lang) => {
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      // ignore quota
    }
    setLangState(l);
  };

  // Keep <html lang> in sync for accessibility.
  useEffect(() => {
    try {
      document.documentElement.lang = lang;
    } catch {
      // ignore
    }
  }, [lang]);

  return (
    <LanguageContext.Provider value={{ lang, setLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

/** Access the current language and setter inside React components. */
export function useLang(): Ctx {
  return useContext(LanguageContext);
}

/**
 * Convenience: pick the current-language strings from a per-component table.
 *
 *   const STR = { ko: { hi: '안녕' }, en: { hi: 'Hi' } };
 *   const t = useT(STR);   // t.hi
 */
export function useT<T extends Record<Lang, unknown>>(table: T): T['ko'] {
  const { lang } = useLang();
  return (table[lang] ?? table.ko) as T['ko'];
}

/** Non-React equivalent of useT for lib/ code. */
export function pickT<T extends Record<Lang, unknown>>(table: T): T['ko'] {
  const lang = getLang();
  return (table[lang] ?? table.ko) as T['ko'];
}
