// mvtt, an RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of mvtt.
//
// mvtt is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.
//
// mvtt is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with mvtt.  If not, see <https://www.gnu.org/licenses/>.

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

/**
 * Separate MIME type for the Characters tab → canvas drop channel.
 * Distinct from TOKEN_DND_MIME so the canvas can dispatch the right
 * command (PlaceCharacterToken vs CreateToken) based on which payload
 * the dataTransfer carries — and so a character drop can't be
 * misinterpreted as a raw icon drop if both payloads were ever set.
 */
export const CHARACTER_DND_MIME = "application/x-vtt-character";

export interface CharacterDndPayload {
  characterId: string;
  label: string;
  /** Default fallback icon when no portrait was uploaded. */
  iconSlug: string;
  /**
   * URL of the character's uploaded portrait, or null if none. Lives
   * under `/plugin-data/<worldId>/...` (server validates).
   */
  imageUrl: string | null;
}

export function encodeCharacterDnd(p: CharacterDndPayload): string {
  return JSON.stringify(p);
}

export function decodeCharacterDnd(raw: string): CharacterDndPayload | null {
  try {
    const parsed = JSON.parse(raw) as Partial<CharacterDndPayload>;
    if (
      typeof parsed.characterId !== "string" ||
      typeof parsed.label !== "string" ||
      typeof parsed.iconSlug !== "string"
    ) {
      return null;
    }
    const imageUrl =
      parsed.imageUrl === null || typeof parsed.imageUrl === "string"
        ? parsed.imageUrl
        : null;
    return {
      characterId: parsed.characterId,
      label: parsed.label,
      iconSlug: parsed.iconSlug,
      imageUrl: imageUrl ?? null,
    };
  } catch {
    return null;
  }
}
