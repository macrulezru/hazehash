import { PlaceholderError } from '../../errors';
import type { Io } from '../io';

/** The hash given on the command line, or read from standard input for "-". */
export async function readHashArgument(arg: string, io: Io): Promise<string> {
  if (arg !== '-') return arg.trim();
  const bytes = await io.readStdin();
  return new TextDecoder().decode(bytes).trim();
}

/** A plain-language reason why a hash was rejected. */
export function explainHashError(error: PlaceholderError): string {
  switch (error.code) {
    case 'InvalidCharacter':
      return 'this is not a HazeHash: it contains characters outside the base64url alphabet (A–Z a–z 0–9 - _)';
    case 'InvalidLength':
      return 'this is not a HazeHash: its length is not valid (a hash has at least 10 characters)';
    case 'UnsupportedVersion':
      return 'this hash was made by a newer format version that this tool cannot read';
    default:
      return error.message;
  }
}
