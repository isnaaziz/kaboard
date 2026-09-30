(function () {
  var pref;
  try {
    pref = localStorage.getItem("kaboard-theme");
  } catch (e) {}
  if (pref !== "light" && pref !== "dark") pref = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.dataset.theme = pref;
})();
