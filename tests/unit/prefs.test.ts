import { describe, expect, it } from 'vitest';
import { normalizePrefs } from '../../src/ui/prefs';

describe('reprise des préférences de la version précédente', () => {
  it('mode doigt « auto » + stylet détecté → stylet uniquement ; outil lasso → sélection ; stylo conservé', () => {
    const p = normalizePrefs({
      penDetected: true,
      tool: 'lasso' as never,
      settings: { touchMode: 'auto', eraserSize: 14 } as never,
      styles: { pen: { color: '#c0392b', width: 3.6 } } as never,
      toolbar: 'left' as never,
    });
    expect(p.settings.fingerMode).toBe('pen-only');
    expect(p.tool).toBe('select');
    expect(p.styles.pens.pen).toMatchObject({ color: '#c0392b', width: 3.6 });
    expect(p.settings.eraserSize).toBe(14);
    expect(p.toolbar).toBe('top');
    expect('touchMode' in p.settings).toBe(false);
  });

  it('mode « draw » → doigt et stylet', () => {
    expect(normalizePrefs({ settings: { touchMode: 'draw' } as never }).settings.fingerMode).toBe('finger-and-pen');
  });
});
