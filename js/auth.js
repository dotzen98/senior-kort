window.auth = {
  logout: async function () {
    await sb.auth.signOut();
    window.location.replace('login.html');
  }
};

(async function () {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.replace('login.html');
    return;
  }
  document.documentElement.style.visibility = 'visible';
})();
