interface TrustCard {
  id: string;
  name?: string;
  first_mes?: string;
  extensions?: Record<string, unknown>;
}

export async function cardTrustKey(card: TrustCard): Promise<string> {
  const e = card.extensions ?? {};
  const payload = JSON.stringify([
    card.id,
    card.first_mes,
    e.alternate_greetings,
    e.regex_scripts,
    e.tavern_helper,
    e.TavernHelper_scripts,
  ]);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return `comfysilly:card-trust:v1:${card.id}:${Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function cardIdTrustKey(cardId: string): string {
  return `comfysilly:card-id-trust:v1:${cardId}`;
}

export function readCardTrust(key: string, cardId?: string): boolean {
  try {
    if (cardId) {
      const grant = localStorage.getItem(cardIdTrustKey(cardId));
      // Older builds wrote a broad ID flag alongside a content-specific grant.
      // Only the matching content grant can authorize that legacy record.
      if (grant != null && grant !== 'trusted') return grant === key;
    }
    if (localStorage.getItem(key) === 'trusted') return true;
    return false;
  } catch {
    return false;
  }
}

export function writeCardTrust(key: string, enabled: boolean, cardId?: string): void {
  if (cardId) {
    // One atomic storage write; a revoked grant also overrides legacy hash grants.
    localStorage.setItem(cardIdTrustKey(cardId), enabled ? key : 'revoked');
    return;
  }
  if (enabled) {
    localStorage.setItem(key, 'trusted');
  } else {
    localStorage.removeItem(key);
  }
}
