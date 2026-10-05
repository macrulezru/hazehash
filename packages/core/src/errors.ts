export type PlaceholderErrorCode =
  | 'InvalidInput'
  | 'BudgetTooSmall' // encoder
  | 'InvalidLength'
  | 'InvalidCharacter'
  | 'UnsupportedVersion'; // decoder

export class PlaceholderError extends Error {
  readonly code: PlaceholderErrorCode;

  constructor(code: PlaceholderErrorCode, message?: string) {
    super(message ? `${code}: ${message}` : code);
    this.name = 'PlaceholderError';
    this.code = code;
  }
}
