import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { Camera, SwitchCamera, X } from 'lucide-react';

interface Props {
  open: boolean;
  onDetected: (code: string) => void;
  onClose: () => void;
}

type Facing = 'environment' | 'user';

export function BarcodeScanner({ open, onDetected, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [facing, setFacing] = useState<Facing>('environment');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setError(null);
      return;
    }

    const reader = new BrowserMultiFormatReader();
    let cancelled = false;
    let controls: IScannerControls | null = null;

    (async () => {
      try {
        if (!videoRef.current || cancelled) return;
        // facingMode: { ideal } pide la trasera (environment) o frontal (user)
        // según corresponda; el browser maneja el deviceId internamente.
        // Esto es más confiable que listVideoInputDevices() en mobile, donde
        // los labels están vacíos hasta que se otorga permiso.
        controls = await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: facing },
            },
            audio: false,
          },
          videoRef.current,
          (result) => {
            if (result && !cancelled) {
              cancelled = true;
              controls?.stop();
              onDetected(result.getText());
            }
          },
        );
      } catch (err) {
        const e = err as Error;
        const msg = e.message ?? '';
        const name = e.name ?? '';
        // Log completo para debug; el toast/UI muestra mensaje amigable.
        console.error('[BarcodeScanner] error:', name, msg, err);
        if (/NotAllowed|Permission|denied/i.test(name + msg)) {
          setError('Permiso de cámara denegado. Habilitalo en la configuración del navegador.');
        } else if (/NotFound|DevicesNotFound/i.test(name + msg)) {
          setError(
            facing === 'environment'
              ? 'No se encontró cámara trasera. Probá con la frontal.'
              : 'No se encontró ninguna cámara en este dispositivo.',
          );
        } else if (/NotReadable|TrackStart/i.test(name + msg)) {
          setError('La cámara está siendo usada por otra app. Cerrala y volvé a intentar.');
        } else if (/secure|HTTPS/i.test(msg)) {
          setError('La cámara solo funciona en HTTPS. Probá desde pos.trankasoft.com.');
        } else {
          setError(`No se pudo iniciar la cámara: ${msg || name || 'error desconocido'}`);
        }
      }
    })();

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [open, facing, onDetected]);

  function switchCamera() {
    setError(null);
    setFacing((f) => (f === 'environment' ? 'user' : 'environment'));
  }

  if (!open) return null;

  const facingLabel = facing === 'environment' ? 'Trasera' : 'Frontal';

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      <div className="flex items-center justify-between border-b border-slate-800 bg-black/80 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <Camera className="h-4 w-4 text-cyan" />
          <span className="font-display text-sm font-bold">Escanear código</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={switchCamera}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-white hover:bg-white/10"
            aria-label="Cambiar cámara"
          >
            <SwitchCamera className="h-4 w-4" />
            <span>{facingLabel}</span>
          </button>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-white hover:bg-white/10"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-white">
            <p className="text-sm text-slate-300">{error}</p>
            <div className="flex gap-2">
              <button
                onClick={switchCamera}
                className="rounded-lg bg-cyan/20 px-4 py-2 text-sm hover:bg-cyan/30"
              >
                Probar otra cámara
              </button>
              <button
                onClick={onClose}
                className="rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
              >
                Volver
              </button>
            </div>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              playsInline
              muted
              autoPlay
            />
            {/* Overlay con marco de targeting */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="relative h-32 w-72 max-w-[80vw] rounded-lg border-2 border-cyan/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
                <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 animate-pulse bg-cyan" />
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
