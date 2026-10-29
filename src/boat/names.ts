/** Names painted on the sterns. A drawn boat gets one by its seed; the die picks another. */
export const NAMES = [
  'Biscuit', 'Seaspray', 'Little Bean', 'Puffin', 'Marmalade', 'Pebble', 'Dumpling', 'Sea Pea', 'Kipper', 'Bramble',
  'Tern', 'Saffron', 'Moonbeam', 'Barnacle', 'Clementine', 'Periwinkle', 'Teacup', 'Starfish', 'Nutmeg', 'Wren',
  'Driftwood', 'Plum', 'Cockle', 'Bluebell', 'Toffee', 'Mackerel', 'Pip', 'Honey', 'Sandpiper', 'Mint Imperial',
];

export function nameFor(seed: number): string {
  return NAMES[seed % NAMES.length];
}

/** Another name, never the one it has. */
export function rollName(current: string, random = Math.random): string {
  const others = NAMES.filter((n) => n !== current);
  return others[Math.floor(random() * others.length)];
}

export const MAX_NAME = 18;

/** Tidy a typed name: trimmed, single-spaced, printable, and not too long. */
export function cleanName(raw: string): string {
  return [...raw].filter((ch) => ch >= ' ' && ch !== '\u007f').join('').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}
