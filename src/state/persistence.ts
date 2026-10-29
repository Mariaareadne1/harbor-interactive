import { parseDoc, type HarborDoc } from './document';

const KEY = 'harbor.scene';

/** Read the saved harbour; null when there is none or it cannot be trusted. */
export function loadDoc(): HarborDoc | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseDoc(JSON.parse(raw)) : null;
  } catch {
    return null; // private mode, blocked storage or corrupt JSON: start fresh
  }
}

export function saveDoc(doc: HarborDoc): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(doc));
    return true;
  } catch {
    return false;
  }
}

export function clearSaved(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}

export function exportDocFile(doc: HarborDoc): void {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  downloadBlob(blob, 'harbor.scene.json');
}

export async function importDocFile(file: File): Promise<HarborDoc> {
  if (file.size > 256 * 1024) throw new Error('That file is too large to be a harbour.');
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const doc = parseDoc(json);
  if (!doc) throw new Error('That file is not a HARBOR scene.');
  return doc;
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
