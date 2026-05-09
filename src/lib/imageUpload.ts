/**
 * Validación de imágenes que se suben como logo del comercio.
 *
 * Mantener en sync con la migration 016 (bucket tenant-logos):
 *   - file_size_limit  = 1 MB
 *   - allowed_mime_types = image/png, image/jpeg, image/webp
 *
 * Si esto cambia, actualizar las constantes acá Y la migration.
 */

export const LOGO_MAX_BYTES = 1_048_576; // 1 MB
export const LOGO_ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const LOGO_MIN_DIMENSION = 64;
export const LOGO_MAX_DIMENSION = 2000;

export const LOGO_REQUIREMENTS_TEXT =
  'PNG, JPG o WebP · máx 1 MB · entre 64×64 y 2000×2000 px';

export type LogoValidationResult =
  | { ok: true; width: number; height: number }
  | { ok: false; error: string };

/**
 * Valida un File contra las reglas de logo. Es asincrónica porque las
 * dimensiones requieren cargar la imagen.
 *
 * En entorno de tests sin DOM (Node), si globalThis.Image no existe,
 * la validación de dimensiones se saltea (devuelve width/height = 0).
 */
export async function validateLogoFile(file: File): Promise<LogoValidationResult> {
  if (!file) {
    return { ok: false, error: 'No se eligió ningún archivo.' };
  }

  // 1. MIME type
  if (!LOGO_ALLOWED_MIME.includes(file.type as (typeof LOGO_ALLOWED_MIME)[number])) {
    return {
      ok: false,
      error: `Tipo de archivo no permitido (${file.type || 'desconocido'}). Aceptamos solo PNG, JPG o WebP.`,
    };
  }

  // 2. Tamaño
  if (file.size > LOGO_MAX_BYTES) {
    const mb = (file.size / 1_048_576).toFixed(2);
    return {
      ok: false,
      error: `El archivo pesa ${mb} MB. El máximo permitido es 1 MB.`,
    };
  }

  // 3. Dimensiones — carga la imagen para leer naturalWidth/Height.
  // En Node (tests) Image puede no existir; en ese caso skipeamos.
  if (typeof Image === 'undefined' || typeof URL?.createObjectURL !== 'function') {
    return { ok: true, width: 0, height: 0 };
  }

  const dim = await loadImageDimensions(file).catch(() => null);
  if (!dim) {
    return { ok: false, error: 'No se pudo leer la imagen. ¿Está corrupta?' };
  }

  if (dim.width < LOGO_MIN_DIMENSION || dim.height < LOGO_MIN_DIMENSION) {
    return {
      ok: false,
      error: `La imagen es muy chica (${dim.width}×${dim.height}). El mínimo es ${LOGO_MIN_DIMENSION}×${LOGO_MIN_DIMENSION} px.`,
    };
  }

  if (dim.width > LOGO_MAX_DIMENSION || dim.height > LOGO_MAX_DIMENSION) {
    return {
      ok: false,
      error: `La imagen es muy grande (${dim.width}×${dim.height}). El máximo es ${LOGO_MAX_DIMENSION}×${LOGO_MAX_DIMENSION} px.`,
    };
  }

  return { ok: true, width: dim.width, height: dim.height };
}

function loadImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image load failed'));
    };
    img.src = url;
  });
}

/**
 * Devuelve la extensión normalizada según el MIME — usada para construir
 * el path en Storage (`{tenantId}/logo.{ext}`).
 */
export function logoExtensionFor(mime: string): 'png' | 'jpg' | 'webp' {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return 'png';
}
