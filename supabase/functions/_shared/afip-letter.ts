// =====================================================================
// Shared: matriz fiscal AFIP (espejo backend del frontend afipLetter.ts)
// =====================================================================
// Determina QUÉ tipo de comprobante + qué docTipo/CondIVAReceptor
// corresponde según condición IVA del emisor y datos del receptor.
//
// Importante mantener sincronizado con src/lib/afipLetter.ts del frontend
// (ese muestra la preview al cajero). Si cambian las reglas, cambiar los dos.
// =====================================================================

import {
  CBTE_TIPO,
  COND_IVA_RECEPTOR,
  DOC_TIPO,
} from './afip-wsfev1.ts';

export type EmitterTaxCondition =
  | 'responsable_inscripto'
  | 'monotributista'
  | 'exento'
  | 'consumidor_final';

export type ReceiverIvaCondition =
  | EmitterTaxCondition
  | 'no_categorizado';

export type ReceiverDocType = 80 | 86 | 96; // CUIT | CUIL | DNI

export interface ReceiverInfo {
  /** null/undefined → anónimo (consumidor final, DocTipo=99, DocNro=0). */
  docType?: ReceiverDocType | null;
  docNumber?: string | null;
  legalName?: string | null;
  ivaCondition?: ReceiverIvaCondition | null;
}

export interface VoucherClassification {
  /** Letra del comprobante. */
  letter: 'A' | 'B' | 'C';
  /** CBTE_TIPO de AFIP para Factura (NC/ND se computan aparte). */
  cbteTipo: number;
  /** DOC_TIPO de AFIP para el receptor (99 si anónimo). */
  docTipo: number;
  /** Documento del receptor ('0' si anónimo). */
  docNro: string;
  /** CondicionIVAReceptorId AFIP (RG 5616/2024). */
  condicionIVAReceptorId: number;
}

export interface ClassificationError {
  code:
    | 'CANNOT_EMIT'
    | 'A_REQUIRES_CUIT'
    | 'A_REQUIRES_LEGAL_NAME';
  message: string;
}

/**
 * Devuelve la clasificación correcta del voucher, o un error explicativo.
 *
 * Casos:
 *  - emisor=consumidor_final → CANNOT_EMIT.
 *  - emisor=monotributo o exento → Factura C, receptor opcional.
 *  - emisor=RI sin receptor → Factura B anónima.
 *  - emisor=RI con receptor:
 *      receptor RI/Mono/Exento → Factura A (requiere CUIT + razón social).
 *      receptor CF/NoCat → Factura B (DNI/CUIT opcional, anónimo permitido).
 */
export function classifyVoucher(
  emitter: EmitterTaxCondition,
  receiver: ReceiverInfo | null,
): VoucherClassification | ClassificationError {
  // 1) Consumidor final no puede emitir
  if (emitter === 'consumidor_final') {
    return {
      code: 'CANNOT_EMIT',
      message:
        'El emisor está configurado como Consumidor Final. Cambiá la condición IVA del comercio en Configuración → Empresa para poder emitir facturas.',
    };
  }

  // 2) Monotributo y Exento → siempre Factura C
  if (emitter === 'monotributista' || emitter === 'exento') {
    if (!receiver?.ivaCondition || !receiver?.docNumber) {
      // C anónimo
      return {
        letter: 'C',
        cbteTipo: CBTE_TIPO.FACTURA_C,
        docTipo: DOC_TIPO.CONSUMIDOR_FINAL_ANONIMO,
        docNro: '0',
        condicionIVAReceptorId: COND_IVA_RECEPTOR.CONSUMIDOR_FINAL,
      };
    }
    return {
      letter: 'C',
      cbteTipo: CBTE_TIPO.FACTURA_C,
      docTipo: (receiver.docType ?? DOC_TIPO.CONSUMIDOR_FINAL_ANONIMO) as number,
      docNro: receiver.docNumber,
      condicionIVAReceptorId: ivaCondToAfipId(receiver.ivaCondition),
    };
  }

  // 3) Responsable Inscripto
  if (emitter === 'responsable_inscripto') {
    // 3a) Sin receptor → Factura B anónima
    if (!receiver?.ivaCondition) {
      return {
        letter: 'B',
        cbteTipo: CBTE_TIPO.FACTURA_B,
        docTipo: DOC_TIPO.CONSUMIDOR_FINAL_ANONIMO,
        docNro: '0',
        condicionIVAReceptorId: COND_IVA_RECEPTOR.CONSUMIDOR_FINAL,
      };
    }

    const cond = receiver.ivaCondition;
    const isAType =
      cond === 'responsable_inscripto' ||
      cond === 'monotributista' ||
      cond === 'exento';

    if (isAType) {
      // Factura A — requisitos AFIP: CUIT obligatorio + razón social.
      if (!receiver.docNumber || receiver.docType !== 80) {
        return {
          code: 'A_REQUIRES_CUIT',
          message:
            'Factura A requiere CUIT del receptor (no DNI ni CUIL). Editá el receptor y cargá su CUIT.',
        };
      }
      if (!receiver.legalName || !receiver.legalName.trim()) {
        return {
          code: 'A_REQUIRES_LEGAL_NAME',
          message: 'Factura A requiere razón social del receptor.',
        };
      }
      return {
        letter: 'A',
        cbteTipo: CBTE_TIPO.FACTURA_A,
        docTipo: 80,
        docNro: receiver.docNumber,
        condicionIVAReceptorId: ivaCondToAfipId(cond),
      };
    }

    // Factura B con receptor identificado (CF o No Cat)
    if (!receiver.docNumber) {
      // Receptor cargado pero sin doc → tratamos como anónimo igual
      return {
        letter: 'B',
        cbteTipo: CBTE_TIPO.FACTURA_B,
        docTipo: DOC_TIPO.CONSUMIDOR_FINAL_ANONIMO,
        docNro: '0',
        condicionIVAReceptorId: ivaCondToAfipId(cond),
      };
    }
    return {
      letter: 'B',
      cbteTipo: CBTE_TIPO.FACTURA_B,
      docTipo: (receiver.docType ?? DOC_TIPO.DNI) as number,
      docNro: receiver.docNumber,
      condicionIVAReceptorId: ivaCondToAfipId(cond),
    };
  }

  // Fallback: tipo de emisor no soportado
  return {
    code: 'CANNOT_EMIT',
    message: `Condición IVA del emisor no soportada: ${emitter}`,
  };
}

function ivaCondToAfipId(c: ReceiverIvaCondition): number {
  switch (c) {
    case 'responsable_inscripto': return COND_IVA_RECEPTOR.RESPONSABLE_INSCRIPTO;
    case 'monotributista':         return COND_IVA_RECEPTOR.MONOTRIBUTISTA;
    case 'exento':                 return COND_IVA_RECEPTOR.EXENTO;
    case 'consumidor_final':       return COND_IVA_RECEPTOR.CONSUMIDOR_FINAL;
    case 'no_categorizado':        return COND_IVA_RECEPTOR.NO_CATEGORIZADO;
  }
}

/** Type guard. */
export function isClassificationError(
  v: VoucherClassification | ClassificationError,
): v is ClassificationError {
  return 'code' in v;
}

/**
 * Dado la letra de una factura, devuelve el CBTE_TIPO de la Nota de Crédito
 * correspondiente. La numeración de NC es independiente de la de facturas.
 *   A → 3 (NC A) · B → 8 (NC B) · C → 13 (NC C)
 */
export function creditNoteCbteTipo(letter: 'A' | 'B' | 'C'): number {
  switch (letter) {
    case 'A': return CBTE_TIPO.NOTA_CREDITO_A;
    case 'B': return CBTE_TIPO.NOTA_CREDITO_B;
    case 'C': return CBTE_TIPO.NOTA_CREDITO_C;
  }
}
