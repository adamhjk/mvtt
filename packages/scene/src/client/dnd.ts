/**
 * MIME type for the picker → canvas drag-and-drop channel. Held in a
 * shared module so the picker (which writes the payload) and the
 * renderer (which reads it) can't drift on the format.
 */
export const TOKEN_DND_MIME = "application/x-vtt-token";

export interface TokenDndPayload {
  slug: string;
  label: string;
}

export function encodeTokenDnd(p: TokenDndPayload): string {
  return JSON.stringify(p);
}

export function decodeTokenDnd(raw: string): TokenDndPayload | null {
  try {
    const parsed = JSON.parse(raw) as Partial<TokenDndPayload>;
    if (typeof parsed.slug !== "string" || typeof parsed.label !== "string") {
      return null;
    }
    return { slug: parsed.slug, label: parsed.label };
  } catch {
    return null;
  }
}
