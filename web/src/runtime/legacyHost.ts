/** A card-local legacy DOM facade. This never returns the desktop host window. */
export function installLegacyHost(onGlobal: (name: string, value: any) => void) {
  const real = window as any;
  const bound = new Map<PropertyKey, unknown>();
  const facade: any = new Proxy(Object.create(null), {
    get(_target, key) {
      if (['window', 'self', 'parent', 'top', 'globalThis'].includes(String(key))) return facade;
      const value = Reflect.get(real, key, real);
      if (
        typeof value === 'function' &&
        /^[a-z]/.test(String(key)) &&
        !['$', 'jQuery'].includes(String(key))
      ) {
        if (!bound.has(key)) bound.set(key, value.bind(real));
        return bound.get(key);
      }
      return value;
    },
    set(_target, key, value) {
      Reflect.set(real, key, value, real);
      bound.delete(key);
      if (key === 'Mvu' && value) onGlobal('Mvu', value);
      return true;
    },
    has: (_target, key) => key in real,
    deleteProperty: (_target, key) => Reflect.deleteProperty(real, key),
  });
  real.__COMFY_LEGACY_WINDOW__ = facade;
  return facade;
}

export function scopeLegacySource(source: string) {
  // Declarations stay lexical to the card's module, not the genuine Window.
  const names = ['window', 'parent', 'top'].filter(
    (n) => !new RegExp(`\\b(?:let|const|var|function|class)\\s+${n}\\b`).test(source),
  );
  return (
    names.map((n) => `const ${n}=globalThis.__COMFY_LEGACY_WINDOW__;`).join('\n') + '\n' + source
  );
}
