import { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';

/**
 * Wrapper sobre jsbarcode que renderiza un código de barras como SVG.
 *
 * Si `format='auto'` detecta el formato según el contenido:
 *   - 13 dígitos numéricos → EAN13
 *   - 8 dígitos numéricos  → EAN8
 *   - cualquier otra cosa  → CODE128
 *
 * Maneja value vacío o inválido renderizando un placeholder "Sin código".
 */

export type BarcodeFormat = 'CODE128' | 'EAN13' | 'EAN8' | 'auto';

interface Props {
  value: string;
  format?: BarcodeFormat;
  /** Ancho en px de cada barra. default 1.5 */
  width?: number;
  /** Alto en px del barcode. default 40 */
  height?: number;
  /** Si muestra el código de texto debajo. default true */
  displayValue?: boolean;
  /** Tamaño de la fuente del texto debajo del barcode. default 12 */
  fontSize?: number;
  className?: string;
}

function detectFormat(value: string): 'CODE128' | 'EAN13' | 'EAN8' {
  if (/^\d{13}$/.test(value)) return 'EAN13';
  if (/^\d{8}$/.test(value)) return 'EAN8';
  return 'CODE128';
}

export function BarcodeSvg({
  value,
  format = 'auto',
  width = 1.5,
  height = 40,
  displayValue = true,
  fontSize = 12,
  className,
}: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const trimmed = (value ?? '').trim();
    if (!trimmed) {
      setFailed(true);
      return;
    }

    // En modo 'auto', si el detect inicial (EAN13/EAN8) falla por checksum
    // inválido, hacemos fallback a CODE128 que acepta cualquier alfanumérico.
    // Mucho comercio tiene códigos de 13 dígitos que NO son EAN reales (ej.
    // generados a mano o importados de Excel). Sin el fallback dicen "Sin
    // código" injustamente. CODE128 los renderiza igual.
    const formats: ('CODE128' | 'EAN13' | 'EAN8')[] =
      format === 'auto'
        ? [detectFormat(trimmed), 'CODE128']
        : [format];

    let rendered = false;
    for (const f of formats) {
      try {
        while (ref.current.firstChild) ref.current.removeChild(ref.current.firstChild);
        JsBarcode(ref.current, trimmed, {
          format: f,
          width,
          height,
          displayValue,
          fontSize,
          margin: 0,
          background: '#ffffff',
          lineColor: '#000000',
        });
        rendered = true;
        break;
      } catch {
        // Probar siguiente formato del fallback chain.
      }
    }
    setFailed(!rendered);
  }, [value, format, width, height, displayValue, fontSize]);

  if (failed || !value?.trim()) {
    return (
      <div
        className={
          'flex items-center justify-center bg-slate-100 text-[8pt] text-slate-400 ' +
          (className ?? '')
        }
        style={{ height: height + (displayValue ? fontSize + 4 : 0) }}
      >
        Sin código
      </div>
    );
  }

  return <svg ref={ref} className={className} />;
}
