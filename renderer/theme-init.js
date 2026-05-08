// Runs synchronously before paint to prevent flash of wrong theme.
(function () {
  try {
    var stored = localStorage.getItem("gpuhunter:theme");
    var theme = stored
      ? stored
      : matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
})();
