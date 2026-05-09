import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { Camera, SwitchCamera, X } from 'lucide-react';

interface Props {
  open: boolean;
  onDetected: (code: string) => void;
  onClose: () => void;
}

function isBackCamera(label: string) {
  return /back|rear|environment|trasera/i.test(label);
}

export function BarcodeScanner({ open, onDetected, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Effect 1: al abrir, listar dispositivos y elegir el default (trasera).
  useEffect(() => {
    if (!open) {
      setDevices([]);
      setCurrentDeviceId(null);
      setError(null);
      return;
    }
    (async () => {
      try {
        const list = await BrowserMultiFormatReader.listVideoInputDevices();
        setDevices(list);
        const back = list.find((d) => isBackCamera(d.label));
        const initial = back?.deviceId ?? list[0]?.deviceId ?? null;
        setCurrentDeviceId(initial);
        if (!initial) {
          setError('No se encontró ninguna cámara en este dispositivo.');
        }
      } catch (err) {
        const msg = (err as Error).message ?? '';
        if (/permission|denied|NotAllowed/i.test(msg)) {
          setError('Permiso de cámara denegado. Habilitalo en la configuración del navegador.');
        } else {
          setError(`No se pudo acceder a las cámaras: ${msg}`);
        }
      }
    })();
  }, [open]);

  // Effect 2: arrancar/reiniciar el stream cuando cambia el device seleccionado.
  useEffect(() => {
    if (!open || !currentDeviceId) return;

    const reader = new BrowserMultiFormatReader();
    let cancelled = false;
    let controls: IScannerControls | null = null;

    (async () => {
      try {
        if (!videoRef.current || cancelled) return;
        controls = await reader.decodeFromVideoDevice(
          currentDeviceId,
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
        const msg = (err as Error).message ?? '';
        if (/permission|denied|NotAllowed/i.test(msg)) {
          setError('Permiso de cámara denegado. Habilitalo en la configuración del navegador.');
        } else if (/NotFound/i.test(msg)) {
          setError('No se encontró ninguna cámara en este dispositivo.');
        } else {
          setError(`No se pudo iniciar la cámara: ${msg}`);
        }
      }
    })();

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [open, currentDeviceId, onDetected]);

  function switchCamera() {
    if (devices.length < 2) return;
    const idx = devices.findIndex((d) => d.deviceId === currentDeviceId);
    const next = devices[(idx + 1) % devices.length];
    setCurrentDeviceId(next.deviceId);
  }

  if (!open) return null;

  const currentDevice = devices.find((d) => d.deviceId === currentDeviceId);
  const facing = currentDevice && isBackCamera(currentDevice.label) ? 'Trasera' : 'Frontal';

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      <div className="flex items-center justify-between border-b border-slate-800 bg-black/80 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <Camera className="h-4 w-4 text-cyan" />
          <span className="font-display text-sm font-bold">Escanear código</span>
        </div>
        <div className="flex items-center gap-1">
          {devices.length > 1 && !error && (
            <button
              onClick={switchCamera}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-white hover:bg-white/10"
              aria-label="Cambiar cámara"
            >
              <SwitchCamera className="h-4 w-4" />
              <span>{facing}</span>
            </button>
          )}
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
