export interface GoogleConfiguration { clientId: string; clientSecret: string; redirectUri: string }
export interface GoogleIdentity { subject: string; email: string; displayName: string }
export interface GoogleFlow {
  stateHash: string; browserHash: string; verifier: string; nonce: string;
  next: string; userId: number | null; expiresAt: number;
}
export interface StoredGoogleFlow {
  state_hash: string; browser_hash: string; verifier: string; nonce: string;
  return_path: string; user_id: number | null; expires_at: number;
}
export interface GoogleProvider {
  authorize(state: string, nonce: string, verifier: string): string;
  exchange(code: string, verifier: string, nonce: string): Promise<GoogleIdentity>;
}
