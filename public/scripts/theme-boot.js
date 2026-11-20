// Theme preference only; no financial records are stored in localStorage.
try {
  const dark = localStorage.getItem('finance-theme') === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
} catch {
  document.documentElement.dataset.theme = 'light';
}
