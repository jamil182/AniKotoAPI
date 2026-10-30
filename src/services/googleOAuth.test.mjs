import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, createSign } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { googleConfiguration, googleIdentity, createGoogleProvider } from './googleOAuth.js';

const config = { clientId: '123-test.apps.googleusercontent.com', clientSecret: 'test-client-secret', redirectUri: 'https://anime.example/api/auth/google/callback' };
test('Google configuration requires complete credentials and an exact secure callback without exposing secrets', () => {
  const env = { GOOGLE_CLIENT_ID: config.clientId, GOOGLE_CLIENT_SECRET: config.clientSecret, GOOGLE_REDIRECT_URI: config.redirectUri, NODE_ENV: 'production' };
  assert.deepEqual(googleConfiguration(env), config);
  for (const change of [{ GOOGLE_CLIENT_ID: '' }, { GOOGLE_CLIENT_SECRET: '' }, { GOOGLE_CLIENT_ID: 'not-google' }, { GOOGLE_REDIRECT_URI: 'http://anime.example/api/auth/google/callback' },
    { GOOGLE_REDIRECT_URI: 'https://anime.example/api/auth/google/callback?next=evil' }, { GOOGLE_REDIRECT_URI: 'https://user:secret@anime.example/api/auth/google/callback' },
    { GOOGLE_REDIRECT_URI: 'https://anime.example/callback' }, { GOOGLE_REDIRECT_URI: 'http://localhost:4466/api/auth/google/callback' }]) assert.equal(googleConfiguration({ ...env, ...change }), null);
  assert.ok(googleConfiguration({ ...env, NODE_ENV: 'test', GOOGLE_REDIRECT_URI: 'http://localhost:4466/api/auth/google/callback' }));
  const url = new URL(createGoogleProvider(config).authorize('state', 'nonce', 'verifier'));
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('scope'), 'openid email profile');
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update('verifier').digest('base64url'));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('nonce'), 'nonce');
  assert.equal(url.searchParams.get('access_type'), 'online');
  assert.ok(!url.href.includes(config.clientSecret));
});

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKey = keys.publicKey.export({ format: 'pem', type: 'spki' });
function signed(claims) {
  const data = [Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url'), Buffer.from(JSON.stringify(claims)).toString('base64url')].join('.');
  return data + '.' + createSign('RSA-SHA256').update(data).end().sign(keys.privateKey, 'base64url');
}
async function exchange(claims, { brokenSignature = false, missingToken = false } = {}) {
  const client = new OAuth2Client(config), sent = [];
  client.transporter.request = async options => {
    sent.push(options);
    if (String(options.url).includes('/token')) {
      let token = signed(claims);
      if (brokenSignature) { const pieces = token.split('.'); pieces[2] = (pieces[2][0] === 'A' ? 'B' : 'A') + pieces[2].slice(1); token = pieces.join('.'); }
      return { data: missingToken ? {} : { id_token: token }, headers: new Headers() };
    }
    assert.ok(String(options.url).includes('googleapis.com/oauth2/'));
    return { data: { 'test-key': publicKey }, headers: new Headers({ 'cache-control': 'public, max-age=3600' }) };
  };
  const identity = await createGoogleProvider(config, { client }).exchange('authorization-code', 'private-pkce-verifier', 'expected-nonce');
  assert.match(String(sent[0].data), /code_verifier=private-pkce-verifier/);
  return identity;
}
test('Google verifies real RSA signatures, audience, issuer, lifetime, authorized party, nonce and verified email', async () => {
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: 'stable-google-subject', email: 'USER@Gmail.com', email_verified: true, name: 'Google User',
    iss: 'https://accounts.google.com', aud: config.clientId, nonce: 'expected-nonce', iat: now - 10, exp: now + 3600 };
  assert.deepEqual(await exchange(claims), { subject: 'stable-google-subject', email: 'user@gmail.com', displayName: 'Google User' });
  for (const changes of [{ aud: 'another-client' }, { iss: 'https://attacker.example' }, { exp: now - 1000, iat: now - 3600 }, { iat: now + 1000 },
    { azp: 'another-client' }, { nonce: 'incorrect-nonce' }, { nonce: undefined }, { email_verified: false }, { email_verified: 'true' }, { email: 'not-an-email' }, { sub: '' }]) await assert.rejects(exchange({ ...claims, ...changes }));
  await assert.rejects(exchange(claims, { brokenSignature: true }));
  await assert.rejects(exchange(claims, { missingToken: true }));
  assert.throws(() => googleIdentity({ ...claims, nonce: 'é'.repeat(claims.nonce.length) }, claims.nonce), /diverifikasi/);
});
