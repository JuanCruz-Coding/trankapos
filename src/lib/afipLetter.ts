// =====================================================================
// Helper: matriz fiscal AFIP — qué letra emitir según emisor + receptor.
// =====================================================================
// Espejo CLIENT-SIDE de la matriz que también se aplica en el backend
// (`afip-emit-voucher`). Sirve para mostrar "Se va a emitir Factura X"
// en el PaymentModal antes de confirmar — le da confianza al cajero.
//
// Validado en plan de A3 con el agent architect. Casos cubiertos:
//   - Monotributista → siempre Factura C.
//   - Responsable Inscripto → A (a RI/Mono) / B (a CF) / A (a Exento, default).
//   - Exento → siempre Factura C.
//   - Consumidor Final como emisor → no puede emitir.
// =====================================================================

import type { CustomerIvaCondition, TaxCondition } from '@/types';

export type CbteLetter = 'A' | 'B' | 'C';

export interface ReceiverInput {
  /** Si null/undefined, se asume consumidor final anónimo. */
  ivaCondition?: CustomerIvaCondition | null;
}

export interface LetterResult {
  /** Letra a emitir. null si el emisor no puede emitir. */
  letter: CbteLetter | null;
  /** Descripción legible para mostrar al cajero. */
  reason: string;
}

/**
 * Devuelve qué letra se va a emitir y por qué.
 *
 * @param emitter Condición IVA del tenant emisor.
 * @param receiver Receptor identificado (o null para anónimo).
 */
export function determineCbteLetter(
  emitter: TaxCondition,
  receiver: ReceiverInput | null,
): LetterResult {
  // 1) Emisor monotributo → siempre C
  if (emitter === 'monotributista') {
    return {
      letter: 'C',
      reason: receiver
        ? 'Factura C — emisor monotributo (identifica al cliente)'
        : 'Factura C — emisor monotributo',
    };
  }

  // 2) Emisor exento → siempre C
  if (emitter === 'exento') {
    return {
      letter: 'C',
      reason: 'Factura C — emisor exento',
    };
  }

  // 3) Emisor consumidor final no puede emitir
  if (emitter === 'consumidor_final') {
    return {
      letter: null,
      reason: 'Un consumidor final no puede emitir facturas.',
    };
  }

  // 4) Emisor responsable inscripto → A o B según receptor
  if (emitter === 'responsable_inscripto') {
    if (!receiver || !receiver.ivaCondition) {
      return {
        letter: 'B',
        reason: 'Factura B — sin identificar receptor (consumidor final anónimo)',
      };
    }
    switch (receiver.ivaCondition) {
      case 'responsable_inscripto':
      case 'monotributista':
      case 'exento':
        return {
          letter: 'A',
          reason: `Factura A — receptor ${labelForCondition(receiver.ivaCondition)}`,
        };
      case 'consumidor_final':
      case 'no_categorizado':
        return {
          letter: 'B',
          reason: `Factura B — receptor ${labelForCondition(receiver.ivaCondition)}`,
        };
    }
  }

  // Fallback (no debería ocurrir)
  return {
    letter: null,
    reason: 'No se puede determinar la letra para esta combinación.',
  };
}

function labelForCondition(c: CustomerIvaCondition): string {
  switch (c) {
    case 'responsable_inscripto': return 'Responsable Inscripto';
    case 'monotributista': return 'Monotributista';
    case 'exento': return 'Exento';
    case 'consumidor_final': return 'Consumidor Final';
    case 'no_categorizado': return 'No Categorizado';
  }
}
