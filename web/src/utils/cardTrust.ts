interface TrustCard {
  id: string;
  first_mes?: string;
  extensions?: Record<string, unknown>;
}
/** A grant applies to this local card and its executable payload, never to every card. */
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
export function readCardTrust(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'trusted';
  } catch {
    return false;
  }
}
export function writeCardTrust(key: string, enabled: boolean): void {
  if (enabled) localStorage.setItem(key, 'trusted');
  else localStorage.removeItem(key);
}
