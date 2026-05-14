import { useState, type ChangeEvent } from 'react';
import { AlertTriangle, Save } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { getSupabase } from '@/lib/supabase';
import { toast } from '@/stores/toast';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Se llama cuando el comercio confirmó y guardó las credenciales de producción. */
  onConfirmed: () => void;
}

/**
 * Flujo explícito de 2 pasos para pasar de homologación a producción.
 * El certificado de homologación NO sirve en producción: AFIP genera
 * certificados distintos por ambiente. Por eso este flujo obliga a
 * cargar el cert/key productivos y a confirmar explícitamente con un
 * checkbox antes de activar.
 */
export function ProductionToggleModal({ open, onClose, onConfirmed }: Props) {
  const [cuit, setCuit] = useState('');
  const [salesPoint, setSalesPoint] = useState('1');
  const [certPem, setCertPem] = useState('');
  const [keyPem, setKeyPem] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);

  function resetForm() {
    setCuit('');
    setSalesPoint('1');
    setCertPem('');
    setKeyPem('');
    setConfirmed(false);
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  // Misma lógica de lectura de archivos que FacturacionTab.
  async function readFileAsText(file: File): Promise<string> {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  async function handleCertFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const text = await readFileAsText(file);
      if (!text.includes('-----BEGIN CERTIFICATE-----')) {
        toast.error('El archivo no parece un certificado PEM.');
        return;
      }
      setCertPem(text);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleKeyFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const text = await readFileAsText(file);
      if (!text.includes('PRIVATE KEY')) {
        toast.error('El archivo no parece una clave privada PEM.');
        return;
      }
      setKeyPem(text);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleActivate() {
    if (!/^[0-9]{11}$/.test(cuit)) {
      toast.error('CUIT inválido. Deben ser 11 dígitos sin guiones.');
      return;
    }
    const sp = Number(salesPoint);
    if (!Number.isInteger(sp) || sp <= 0) {
      toast.error('Punto de venta inválido.');
      return;
    }
    if (!certPem || !keyPem) {
      toast.error('Subí el certificado y la clave privada de producción.');
      return;
    }
    if (!confirmed) {
      toast.error('Confirmá que cargaste las credenciales de producción.');
      return;
    }

    setSaving(true);
    try {
      const sb = getSupabase();
      const { data: sessionData } = await sb.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('No autenticado');

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/afip-set-credentials`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
        },
        body: JSON.stringify({
          cuit,
          salesPoint: sp,
          environment: 'production',
          certPem,
          keyPem,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `Error HTTP ${res.status}`);
      toast.success('Producción activada. Probá la conexión para verificar.');
      resetForm();
      onConfirmed();
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const canActivate = Boolean(cuit && salesPoint && certPem && keyPem && confirmed);

  return (
    <Modal open={open} onClose={handleClose} title="Pasar a producción" widthClass="max-w-xl">
      <div className="space-y-4">
        {/* Aviso */}
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-900">
            Estás por pasar a <strong>PRODUCCIÓN</strong>. Los comprobantes que emitas van a
            tener validez fiscal real ante AFIP. El certificado de homologación{' '}
            <strong>NO sirve</strong> en producción — necesitás el certificado y la clave de
            producción que generaste en el portal de AFIP.
          </p>
        </div>

        {/* Paso 1 — credenciales de producción */}
        <div className="rounded-lg border border-slate-200 p-4">
          <h4 className="mb-3 font-display text-sm font-bold text-navy">
            Paso 1 — Cargar credenciales de producción
          </h4>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">CUIT</label>
              <Input
                value={cuit}
                onChange={(e) => setCuit(e.target.value.replace(/\D/g, ''))}
                maxLength={11}
              />
              <p className="mt-1 text-xs text-slate-500">11 dígitos sin guiones</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Punto de venta
              </label>
              <Input
                type="number"
                min="1"
                value={salesPoint}
                onChange={(e) => setSalesPoint(e.target.value)}
              />
              <p className="mt-1 text-xs text-slate-500">El que diste de alta en AFIP</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Certificado de producción (.crt / .pem)
              </label>
              <input
                type="file"
                accept=".crt,.pem,.cer,application/x-x509-ca-cert,application/x-pem-file"
                onChange={handleCertFile}
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
              />
              {certPem && (
                <div className="mt-1 text-xs text-emerald-700">
                  ✓ Certificado cargado ({certPem.length} bytes)
                </div>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Clave privada de producción (.key)
              </label>
              <input
                type="file"
                accept=".key,.pem"
                onChange={handleKeyFile}
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
              />
              {keyPem && (
                <div className="mt-1 text-xs text-emerald-700">
                  ✓ Clave cargada ({keyPem.length} bytes)
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Paso 2 — confirmación */}
        <div className="rounded-lg border border-slate-200 p-4">
          <h4 className="mb-3 font-display text-sm font-bold text-navy">Paso 2 — Confirmar</h4>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span className="text-sm text-slate-900">
              Confirmo que cargué el certificado y la clave de <strong>PRODUCCIÓN</strong> (no
              los de homologación).
            </span>
          </label>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={handleClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleActivate} disabled={saving || !canActivate}>
            <Save className="h-4 w-4" />
            {saving ? 'Activando…' : 'Activar producción'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
