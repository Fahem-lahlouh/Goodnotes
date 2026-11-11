/** Identifiant unique (UUID v4). `crypto.randomUUID` existe depuis Safari 15.4. */
export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

let orderCounter = 0;
/**
 * Ordre d'empilement croissant et unique dans un même onglet.
 * Basé sur l'horloge pour rester cohérent entre onglets/sessions.
 */
export function nextOrder(): number {
  orderCounter = (orderCounter + 1) % 1000;
  return Date.now() + orderCounter / 1000;
}
