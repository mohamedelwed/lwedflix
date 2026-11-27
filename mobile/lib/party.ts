/** Accepts a bare code or a pasted room link (lwedflix:// or https://) — src/app/watch/page.tsx. */
export function parseRoomCode(input: string): string | null {
  const last = input.trim().replace(/[?#].*$/, '').split('/').filter(Boolean).pop() ?? '';
  const code = last.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length >= 4 && code.length <= 12 ? code : null;
}

