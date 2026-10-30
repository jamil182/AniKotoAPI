export class AccountError extends Error {
  constructor(message, status = 400, code = undefined) {
    super(message);
    this.name = 'AccountError';
    this.status = status;
    this.code = code;
  }
}
