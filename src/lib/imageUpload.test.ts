import { describe, it, expect } from 'vitest';
import {
  LOGO_MAX_BYTES,
  logoExtensionFor,
  validateLogoFile,
} from './imageUpload';

// Helper para construir un File falso con el size que queramos sin crear
// realmente un blob de 1 MB en memoria.
function fakeFile(size: number, type: string, name = 'logo'): File {
  const blob = new Blob(['x'], { type });
  const file = new File([blob], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('validateLogoFile — MIME', () => {
  it('acepta image/png', async () => {
    const r = await validateLogoFile(fakeFile(1024, 'image/png'));
    expect(r.ok).toBe(true);
  });

  it('acepta image/jpeg', async () => {
    const r = await validateLogoFile(fakeFile(1024, 'image/jpeg'));
    expect(r.ok).toBe(true);
  });

  it('acepta image/webp', async () => {
    const r = await validateLogoFile(fakeFile(1024, 'image/webp'));
    expect(r.ok).toBe(true);
  });

  it('rechaza image/svg+xml', async () => {
    const r = await validateLogoFile(fakeFile(1024, 'image/svg+xml'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/PNG|JPG|WebP/);
  });

  it('rechaza image/gif', async () => {
    const r = await validateLogoFile(fakeFile(1024, 'image/gif'));
    expect(r.ok).toBe(false);
  });

  it('rechaza application/pdf', async () => {
    const r = await validateLogoFile(fakeFile(1024, 'application/pdf'));
    expect(r.ok).toBe(false);
  });

  it('rechaza tipo vacío (file de origen ambiguo)', async () => {
    const r = await validateLogoFile(fakeFile(1024, ''));
    expect(r.ok).toBe(false);
  });
});

describe('validateLogoFile — tamaño', () => {
  it('acepta justo en el límite', async () => {
    const r = await validateLogoFile(fakeFile(LOGO_MAX_BYTES, 'image/png'));
    expect(r.ok).toBe(true);
  });

  it('rechaza un byte sobre el límite', async () => {
    const r = await validateLogoFile(fakeFile(LOGO_MAX_BYTES + 1, 'image/png'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/MB/);
  });

  it('rechaza archivo de 5 MB', async () => {
    const r = await validateLogoFile(fakeFile(5 * 1_048_576, 'image/png'));
    expect(r.ok).toBe(false);
  });
});

describe('logoExtensionFor', () => {
  it('jpg para image/jpeg', () => {
    expect(logoExtensionFor('image/jpeg')).toBe('jpg');
  });

  it('webp para image/webp', () => {
    expect(logoExtensionFor('image/webp')).toBe('webp');
  });

  it('png como fallback', () => {
    expect(logoExtensionFor('image/png')).toBe('png');
    expect(logoExtensionFor('lo-que-sea')).toBe('png');
  });
});
