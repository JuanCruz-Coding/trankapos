// Validación de CUIT/CUIL por algoritmo módulo 11 (AFIP).
//
// Formato: 11 dígitos. Los últimos 10 se ponderan por [5,4,3,2,7,6,5,4,3,2],
// se suman, se calcula mod 11 y se resta de 11 → ese debe ser el dígito 11
// (verificador). Hay 2 casos borde:
//   - Si resto = 0 → verificador 0.
//   - Si resto = 1 → CUIT inválido (no se asigna).

export function isValidCuit(input: string): boolean {
  if (typeof input !== 'string') return false;
  const cuit = input.replace(/\D/g, '');
  if (cuit.length !== 11) return false;

  const digits = cuit.split('').map(Number);
  const multipliers = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = multipliers.reduce((acc, m, i) => acc + m * digits[i], 0);

  const mod = sum % 11;
  let expected: number;
  if (mod === 0) expected = 0;
  else if (mod === 1) return false; // CUIT no asignable
  else expected = 11 - mod;

  return digits[10] === expected;
}

/**
 * Valida un DNI: 7 u 8 dígitos.
 * No tiene checksum, así que solo chequeamos formato.
 */
export function isValidDni(input: string): boolean {
  if (typeof input !== 'string') return false;
  const dni = input.replace(/\D/g, '');
  return dni.length >= 7 && dni.length <= 8;
}

/**
 * Formatea un CUIT XX-XXXXXXXX-X para mostrar en UI.
 * Si la entrada no tiene 11 dígitos, devuelve el original sin formatear.
 */
export function formatCuit(input: string): string {
  const cuit = input.replace(/\D/g, '');
  if (cuit.length !== 11) return input;
  return `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;
}

/**
 * Validador genérico que recibe tipo doc + número. Devuelve mensaje de error
 * o null si está OK.
 */
export function validateDocument(docType: number, docNumber: string): string | null {
  if (!docNumber || !docNumber.trim()) {
    return 'El número de documento es obligatorio.';
  }
  if (!/^\d+$/.test(docNumber)) {
    return 'El documento debe contener solo dígitos (sin guiones).';
  }
  if (docType === 80 || docType === 86) {
    // CUIT o CUIL: mismo algoritmo
    if (!isValidCuit(docNumber)) {
      return docType === 80
        ? 'CUIT inválido. Verificá que sean 11 dígitos y el dígito verificador.'
        : 'CUIL inválido. Verificá que sean 11 dígitos y el dígito verificador.';
    }
  } else if (docType === 96) {
    if (!isValidDni(docNumber)) {
      return 'DNI inválido. Deben ser 7 u 8 dígitos.';
    }
  } else {
    return 'Tipo de documento no soportado.';
  }
  return null;
}
