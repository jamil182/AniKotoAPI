export interface Account {
  id: number;
  email: string;
  displayName: string;
  createdAt: number;
}
export interface AccountRow {
  id: number;
  email: string;
  display_name: string;
  password_hash: string;
  created_at: number;
}
export interface Registration {
  email: string;
  displayName: string;
  password: string;
}
