/* Apply the saved rail preference before the first stylesheet paints. */
(() => {
  try {
    if (localStorage.getItem('finance-sidebar-collapsed') === '0') {
      document.documentElement.classList.remove('finance-nav-boot-collapsed');
    }
  } catch { /* Default to the compact rail when storage is unavailable. */ }
})();
