/** An expected failure with a stable code; the server answers it as `{ code }`. */
export class DomainError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
