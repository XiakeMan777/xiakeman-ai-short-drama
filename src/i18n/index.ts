import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zh from "./locales/zh.json";
import zhHant from "./locales/zh-Hant.json";
import en from "./locales/en.json";
import ja from "./locales/ja.json";

const savedLang = localStorage.getItem("language") || "zh";

i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    "zh-Hant": { translation: zhHant },
    en: { translation: en },
    ja: { translation: ja },
  },
  lng: savedLang,
  fallbackLng: "zh",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
