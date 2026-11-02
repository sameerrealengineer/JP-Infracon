import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { isLanguage, translate, type Language } from "./strings";

export { languageNames, type Language } from "./strings";

const KEY = "jp-infracon.language.v1";

type I18n = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (text: string, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18n>({
  language: "en",
  setLanguage: () => undefined,
  t: (text, vars) => translate("en", text, vars),
});

/** Remembers the chosen language on this phone (per device, not per account). */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en");
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(KEY)
      .then((saved) => {
        if (active && isLanguage(saved)) setLanguageState(saved);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    AsyncStorage.setItem(KEY, next).catch(() => undefined);
  }, []);
  const value = useMemo<I18n>(
    () => ({
      language,
      setLanguage,
      t: (text, vars) => translate(language, text, vars),
    }),
    [language, setLanguage],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  return useContext(I18nContext);
}
