// Tokens stay in memory; the opaque session cookie is HttpOnly.
const authenticatedFetch = window.fetch.bind(window);
const browserIdentity = authenticatedFetch('/api/auth/session').then(async response => {
  if (!response.ok) { window.location.assign('/'); throw Error('Sign in required'); }
  const identity = await response.json();
  const bar = document.createElement('div');
  bar.textContent = 'Signed in as ' + identity.subject + ' · ' + identity.tenant + ' ';
  const logout = document.createElement('button'); logout.textContent = 'Sign out';
  logout.onclick = async () => {
    const response = await window.fetch('/auth/logout', {method:'POST'});
    if (response.ok || response.status === 401) window.location.assign('/');
  };
  bar.append(logout); document.body.prepend(bar);
  return identity;
});
window.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
  const method = (options.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
  if (url.origin === window.location.origin && !['GET','HEAD'].includes(method)) {
    const identity = await browserIdentity;
    const headers = new Headers(options.headers || (typeof input === 'object' ? input.headers : undefined));
    headers.set('X-CSRF-Token', identity.csrfToken);
    options = {...options, headers};
  }
  const response = await authenticatedFetch(input, options);
  if (url.origin === window.location.origin && response.status === 401) window.location.assign('/');
  return response;
};
void browserIdentity.catch(() => {});
