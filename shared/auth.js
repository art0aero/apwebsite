(function () {
  const SUPABASE_URL = 'https://dvszkmkxamilxocawbml.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_IPiv65AiEjXlmbebq-3jOQ_aVR-5_RY';

  if (!window.supabase || !window.supabase.createClient) {
    throw new Error('Supabase SDK is not loaded. Include @supabase/supabase-js before shared/auth.js');
  }

  const { createClient } = window.supabase;
  const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  function buildAbsoluteUrl(path) {
    const cleanedPath = path.startsWith('/') ? path : `/${path}`;
    return `${window.location.origin}${cleanedPath}`;
  }

  function normalizeAuthError(error) {
    if (!error) return 'Неизвестная ошибка';
    if (error.message === 'Invalid login credentials') {
      return 'Неверный email или пароль';
    }
    return error.message || 'Ошибка авторизации';
  }

  function createAuthController(config) {
    const redirectPath = config?.redirectPath || '/test.html';
    const emailRedirectPath = config?.emailRedirectPath || redirectPath;
    const onSignedIn = typeof config?.onSignedIn === 'function' ? config.onSignedIn : function () {};
    const onSignedOut = typeof config?.onSignedOut === 'function' ? config.onSignedOut : function () {};

    let currentUser = null;

    supabaseClient.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        currentUser = session.user;
        onSignedIn(currentUser, { source: 'listener' });
      }
      if (event === 'SIGNED_OUT') {
        currentUser = null;
        onSignedOut({ source: 'listener' });
      }
    });

    async function consumeOAuthHashIfNeeded() {
      if (!window.location.hash) return null;
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      const accessToken = hashParams.get('access_token');
      if (!accessToken) return null;

      const {
        data: { session },
        error,
      } = await supabaseClient.auth.getSession();

      if (error) throw error;

      if (session?.user) {
        currentUser = session.user;
      }

      window.history.replaceState({}, document.title, window.location.pathname);
      return session?.user || null;
    }

    async function checkAuth() {
      const {
        data: { session },
        error,
      } = await supabaseClient.auth.getSession();
      if (error) throw error;
      currentUser = session?.user || null;
      return currentUser;
    }

    async function init() {
      await consumeOAuthHashIfNeeded();
      const user = await checkAuth();
      if (user) {
        onSignedIn(user, { source: 'init' });
      }
      return user;
    }

    async function login(email, password) {
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw new Error(normalizeAuthError(error));
      currentUser = data.user;
      onSignedIn(currentUser, { source: 'login' });
      return currentUser;
    }

    async function register(email, password, confirmPassword) {
      if (password.length < 8) {
        throw new Error('Пароль должен быть не менее 8 символов');
      }
      if (password !== confirmPassword) {
        throw new Error('Пароли не совпадают');
      }

      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: buildAbsoluteUrl(emailRedirectPath),
        },
      });

      if (error) throw new Error(normalizeAuthError(error));

      if (data.user && !data.session) {
        return { needsEmailConfirmation: true, user: data.user };
      }

      if (data.user?.identities?.length === 0) {
        return { alreadyExists: true, user: data.user };
      }

      currentUser = data.user || null;
      if (currentUser) {
        onSignedIn(currentUser, { source: 'register' });
      }

      return { user: currentUser };
    }

    async function oauth(provider) {
      const { error } = await supabaseClient.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: buildAbsoluteUrl(redirectPath),
        },
      });
      if (error) throw new Error(normalizeAuthError(error));
    }

    async function signOut() {
      const { error } = await supabaseClient.auth.signOut();
      if (error) throw new Error(normalizeAuthError(error));
      currentUser = null;
      onSignedOut({ source: 'signout' });
    }

    async function getAccessToken() {
      const {
        data: { session },
      } = await supabaseClient.auth.getSession();
      return session?.access_token || null;
    }

    return {
      init,
      login,
      register,
      oauth,
      signOut,
      checkAuth,
      getClient: function () {
        return supabaseClient;
      },
      getCurrentUser: function () {
        return currentUser;
      },
      getAccessToken,
    };
  }

  window.AppAuth = {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    normalizeAuthError,
    createAuthController,
  };
})();
