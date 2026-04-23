// Hash local para el driver IndexedDB. En producción con Supabase la
// autenticación es provista por auth.users + bcrypt del lado del servidor.
export async function hashPassword(password: string): Promise<string> {
  const enc = new TextEncoder().encode(password + '::trankapos');
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const h = await hashPassword(password);
  return h === hash;
}
