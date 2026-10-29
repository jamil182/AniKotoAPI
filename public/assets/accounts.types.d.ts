export interface Account {
  id: number;
  email: string;
  displayName: string;
  createdAt: number;
}
export interface AccountResponse { user: Account | null }
