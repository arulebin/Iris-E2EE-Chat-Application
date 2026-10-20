// Apply the saved/system theme before first paint to avoid a light→dark flash.
// Kept as an external file (not inline) so the CSP can forbid inline scripts.
(function () {
  try {
    var p = localStorage.getItem("iris-theme");
    var t = p === "light" || p === "dark"
      ? p
      : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = t;
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", t === "dark" ? "#0b0d12" : "#f7f8fb");
  } catch (e) {}
})();
