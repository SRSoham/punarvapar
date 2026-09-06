(function () {
  try {
    var nativeUrl = null;
    if (window.PunarvaparNative && typeof window.PunarvaparNative.getBackendUrl === "function") {
      nativeUrl = window.PunarvaparNative.getBackendUrl();
    }
    if (nativeUrl) {
      localStorage.setItem("api_base", nativeUrl.replace(/\/$/, ""));
    }
  } catch (e) {}
})();
