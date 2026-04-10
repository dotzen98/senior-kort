(function () {
  const SESSION_KEY = 'auth';
  const LOGIN_PAGE  = 'login.html';

  function checkAuth() {
    const session = sessionStorage.getItem(SESSION_KEY);
    if (!session) {
      window.location.replace(LOGIN_PAGE);
      return;
    }
    document.documentElement.style.visibility = '';
  }

  function getSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); }
    catch { return null; }
  }

  function setSession(username) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ loggedIn: true, username: username }));
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  function logout() {
    clearSession();
    window.location.replace(LOGIN_PAGE);
  }

  window.auth = { checkAuth: checkAuth, getSession: getSession, setSession: setSession, clearSession: clearSession, logout: logout };

  checkAuth();
})();
