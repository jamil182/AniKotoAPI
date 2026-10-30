import { createHash, timingSafeEqual } from 'node:crypto';
import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library';
import { AccountError } from './accountError.js';

/** @param {NodeJS.ProcessEnv} [env] @returns {import('./googleOAuth.types.js').GoogleConfiguration | null} */
export function googleConfiguration(env = process.env) {
  const clientId = env.GOOGLE_CLIENT_ID?.trim(), clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  try {
    const redirect = new URL(env.GOOGLE_REDIRECT_URI);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname);
    if (!clientId || !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId) || clientId.length > 255
      || !clientSecret || clientSecret.length > 2048 || /\s/.test(clientSecret)
      || (redirect.protocol !== 'https:' && !(redirect.protocol === 'http:' && local && env.NODE_ENV !== 'production'))
      || redirect.pathname !== '/api/auth/google/callback' || redirect.search || redirect.hash || redirect.username || redirect.password) return null;
    return { clientId, clientSecret, redirectUri: redirect.href };
  } catch { return null; }
}

/** Validate identity fields only after the Google library has verified the ID token's signature and claims.
 * @param {unknown} payload @param {string} nonce @returns {import('./googleOAuth.types.js').GoogleIdentity} */
export function googleIdentity(payload, nonce) {
  const invalid = () => new AccountError('Identitas Google tidak dapat diverifikasi.', 401, 'verification_failed');
  if (!payload || typeof payload !== 'object') throw invalid();
  const claims = /** @type {Record<string, unknown>} */ (payload);
  if (typeof claims.nonce !== 'string' || Buffer.byteLength(claims.nonce) !== Buffer.byteLength(nonce)
    || !timingSafeEqual(Buffer.from(claims.nonce), Buffer.from(nonce))) throw invalid();
  const subject = claims.sub, email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  if (typeof subject !== 'string' || !subject || subject.length > 255 || /[\x00-\x20\x7f]/.test(subject)
    || claims.email_verified !== true || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw invalid();
  const name = typeof claims.name === 'string' ? claims.name.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 60) : '';
  return { subject, email, displayName: name.length >= 2 ? name : 'Pengguna Google' };
}

/** @param {import('./googleOAuth.types.js').GoogleConfiguration} config
 * @param {{client?: OAuth2Client}} [options] @returns {import('./googleOAuth.types.js').GoogleProvider} */
export function createGoogleProvider(config, { client = new OAuth2Client({ ...config, transporterOptions: { timeout: 10000, retry: false } }) } = {}) {
  return {
    authorize(state, nonce, verifier) {
      const url = new URL(client.generateAuthUrl({ response_type: 'code', scope: ['openid', 'email', 'profile'],
        access_type: 'online', prompt: 'select_account', state, redirect_uri: config.redirectUri,
        code_challenge_method: CodeChallengeMethod.S256, code_challenge: createHash('sha256').update(verifier).digest('base64url') }));
      url.searchParams.set('nonce', nonce);
      return url.href;
    },
    async exchange(code, verifier, nonce) {
      const { tokens } = await client.getToken({ code, codeVerifier: verifier, redirect_uri: config.redirectUri });
      if (!tokens.id_token) throw new AccountError('Google tidak mengirim identitas akun.', 401, 'verification_failed');
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.clientId });
      const payload = ticket.getPayload();
      if (payload?.azp && payload.azp !== config.clientId) throw new AccountError('Identitas Google tidak sesuai.', 401, 'verification_failed');
      return googleIdentity(payload, nonce);
    },
  };
}
