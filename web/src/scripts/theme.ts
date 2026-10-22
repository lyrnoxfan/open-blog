// Constants
const THEME = "theme";
const LIGHT = "light";
const DARK = "dark";

// Initial color scheme
// Can be "light", "dark", or empty string for system's prefers-color-scheme
const initialColorScheme = "";

function getPreferTheme(): string {
  // get theme data from local storage (user's explicit choice)
  let currentTheme: string | null = null;
  try {
    currentTheme = localStorage.getItem(THEME);
  } catch {
    /* 存储被禁用时按系统主题显示 */
  }
  if (currentTheme) return currentTheme;

  // return initial color scheme if it is set (site default)
  if (initialColorScheme) return initialColorScheme;

  // return user device's prefer color scheme (system fallback)
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? DARK
    : LIGHT;
}

// Use existing theme value from inline script if available, otherwise detect
let themeValue = window.theme?.themeValue ?? getPreferTheme();

function setPreference(): void {
  try {
    localStorage.setItem(THEME, themeValue);
  } catch {
    /* 私密模式 / 存储被禁用：只在本次会话生效 */
  }
  reflectPreference();
}

function reflectPreference(): void {
  document.firstElementChild?.setAttribute("data-theme", themeValue);

  document
    .querySelector("#theme-btn")
    ?.setAttribute(
      "aria-label",
      themeValue === DARK ? "切换到日间模式" : "切换到夜间模式"
    );

  // 读令牌而不是 body 的计算色：body 有 320ms 背景过渡，切换瞬间读到的还是旧色
  const bgColor = getComputedStyle(document.documentElement)
    .getPropertyValue("--paper")
    .trim();
  if (bgColor) {
    document
      .querySelector("meta[name='theme-color']")
      ?.setAttribute("content", bgColor);
  }
}

// Update the global theme API
if (window.theme) {
  window.theme.setPreference = setPreference;
  window.theme.reflectPreference = reflectPreference;
} else {
  window.theme = {
    themeValue,
    setPreference,
    reflectPreference,
    getTheme: () => themeValue,
    setTheme: (val: string) => {
      themeValue = val;
    },
  };
}

// Ensure theme is reflected (in case body wasn't ready when inline script ran)
reflectPreference();

function onThemeButtonClick(): void {
  themeValue = themeValue === LIGHT ? DARK : LIGHT;
  window.theme?.setTheme(themeValue);
  setPreference();
}

function setThemeFeature(): void {
  // set on load so screen readers can get the latest value on the button
  reflectPreference();

  // prevent duplicated listeners after astro:after-swap
  const themeButton = document.querySelector("#theme-btn");
  if (!themeButton) return;

  themeButton.removeEventListener("click", onThemeButtonClick);
  themeButton.addEventListener("click", onThemeButtonClick);
}

// Set up theme features after page load
setThemeFeature();

// Runs on view transitions navigation
document.addEventListener("astro:after-swap", setThemeFeature);

// Set theme-color value before page transition
// to avoid navigation bar color flickering in Android dark mode
document.addEventListener("astro:before-swap", event => {
  const astroEvent = event;
  const bgColor = document
    .querySelector("meta[name='theme-color']")
    ?.getAttribute("content");

  if (bgColor) {
    astroEvent.newDocument
      .querySelector("meta[name='theme-color']")
      ?.setAttribute("content", bgColor);
  }
});

// sync with system changes
// 只在用户没有手动选过主题时跟随系统；手动选择后系统切换不再覆盖它，
// 也不再回写 localStorage（否则用户的显式选择会被系统变化永久改掉）。
window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", ({ matches: isDark }) => {
    try {
      if (localStorage.getItem(THEME)) return;
    } catch {
      /* 读不到本地偏好时按系统主题跟随 */
    }
    themeValue = isDark ? DARK : LIGHT;
    window.theme?.setTheme(themeValue);
    reflectPreference();
  });

// 页面可能来自 bfcache（返回键）或 speculation rules 预渲染：那时页面脚本早已跑完，
// data-theme 还停在旧值。页面重新可见时按 localStorage 里的最新选择再同步一次。
function syncFromStorage(): void {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(THEME);
  } catch {
    return;
  }
  if (!stored || stored === themeValue) return;
  themeValue = stored;
  window.theme?.setTheme(themeValue);
  reflectPreference();
}

window.addEventListener("pageshow", syncFromStorage);
document.addEventListener("prerenderingchange", syncFromStorage);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") syncFromStorage();
});
// 另一个标签页切换主题时同步
window.addEventListener("storage", event => {
  if (event.key === THEME) syncFromStorage();
});
