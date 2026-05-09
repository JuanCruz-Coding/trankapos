import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { Camera, X } from 'lucide-react';

interface Props {
  open: boolean;
  onDetected: (code: string) => void;
  onClose: () => void;
}

export function BarcodeScanner({ open, onDetected, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    const reader = new BrowserMultiFormatReader();
    let cancelled = false;

    (async () => {
      try {
        // Buscar cámara trasera (entorno) si está disponible. En mobile suele
        // ser la trasera; en laptop usa la única que haya.
        const devices = await BrowserMultiFormatReader.listVideoInputDevices();
        const back = devices.find((d) => /back|rear|environment/i.test(d.label));
        const deviceId = back?.deviceId ?? devices[0]?.deviceId;

        if (!videoRef.current || cancelled) return;

        const controls = await reader.decodeFromVideoDevice(
          deviceId,
          videoRef.current,
          (result) => {
            if (result && !cancelled) {
              cancelled = true;
              controls.stop();
              onDetected(result.getText());
            }
          },
        );
        controlsRef.current = controls;
      } catch (err) {
        const msg = (err as Error).message ?? '';
        if (/permission/i.test(msg) || /denied/i.test(msg) || /NotAllowed/.test(msg)) {
          setError('Permiso de cámara denegado. Habilitalo en la configuración del navegador.');
        } else if (/NotFound/.test(msg)) {
          setError('No se encontró ninguna cámara en este dispositivo.');
        } else {
          setError(`No se pudo iniciar la cámara: ${msg}`);
        }
      }
    })();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [open, onDetected]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      <div className="flex items-center justify-between border-b border-slate-800 bg-black/80 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <Camera className="h-4 w-4 text-cyan" />
          <span className="font-display text-sm font-bold">Escanear código</span>
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-white hover:bg-white/10"
          aria-label="Cerrar"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center p-6 text-center text-white">
            <p className="mb-4 text-sm text-slate-300">{error}</p>
            <button
              onClick={onClose}
              className="rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
            >
              Volver
            </button>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              playsInline
              muted
            />
            {/* Overlay con marco de targeting */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="relative h-32 w-72 max-w-[80vw] rounded-lg border-2 border-cyan/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
                <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-cyan animate-pulse" />
              </div>
            </div>
            <div className="absolute inset-x-0 bottom-6 text-center text-xs text-white/80">
              Apuntá la cámara al código de barras del producto
            </div>
          </>
        )}
      </div>
    </div>
  );
}
