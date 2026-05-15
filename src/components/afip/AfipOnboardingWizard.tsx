import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  ExternalLink,
  Info,
  Loader2,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { data } from '@/data';
import { toast } from '@/stores/toast';
import { confirmDialog } from '@/lib/dialog';
import { cn } from '@/lib/utils';

type Environment = 'homologation' | 'production';
type Step = 1 | 2 | 3 | 4;

interface ExistingCsr {
  csrPem: string;
  alias: string;
  environment: Environment;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Estado inicial — si el tenant ya pasó el paso 2, arrancá en 3. */
  initialStep?: Step;
  /** Si ya hay un CSR generado, se pasa por acá para mostrarlo en step 3. */
  existingCsr?: ExistingCsr;
  /** Cuando el onboarding termina OK (cert subido). */
  onCompleted: () => void;
  /** Forzá un environment específico (ej. cuando se pasa a prod desde el toggle). */
  forceEnvironment?: Environment;
}

const WSASS_URLS: Record<Environment, string> = {
  homologation: 'https://wsass-homo.afip.gob.ar/wsass/portal/main.aspx',
  production: 'https://wsass.afip.gob.ar/wsass/portal/main.aspx',
};

const ENV_LABEL: Record<Environment, string> = {
  homologation: 'HOMOLOGACIÓN',
  production: 'PRODUCCIÓN',
};

const ALIAS_REGEX = /^[a-zA-Z0-9_-]+$/;

export function AfipOnboardingWizard({
  open,
  onClose,
  initialStep = 1,
  existingCsr,
  onCompleted,
  forceEnvironment,
}: Props) {
  const [step, setStep] = useState<Step>(initialStep);

  // Paso 1 — datos del comercio
  const [cuit, setCuit] = useState('');
  const [legalName, setLegalName] = useState('');
  const [alias, setAlias] = useState('');
  const [salesPoint, setSalesPoint] = useState('1');
  const [environment, setEnvironment] = useState<Environment>(
    forceEnvironment ?? existingCsr?.environment ?? 'homologation',
  );
  const [generating, setGenerating] = useState(false);

  // Resultado del paso 1 (lo que se muestra en 2 y 3)
  const [csrResult, setCsrResult] = useState<ExistingCsr | null>(existingCsr ?? null);

  // Paso 4 — subir certificado
  const [certPem, setCertPem] = useState('');
  const [uploading, setUploading] = useState(false);

  // Reset al abrir
  useEffect(() => {
    if (!open) return;
    setStep(initialStep);
    if (existingCsr) {
      setCsrResult(existingCsr);
      setAlias(existingCsr.alias);
      setEnvironment(existingCsr.environment);
    } else {
      setCsrResult(null);
    }
    if (forceEnvironment) setEnvironment(forceEnvironment);
    setCertPem('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const aliasPlaceholder = useMemo(
    () => (environment === 'production' ? 'trankapos-prod' : 'trankapos-homo'),
    [environment],
  );

  function validateStep1(): string | null {
    if (!/^[0-9]{11}$/.test(cuit)) return 'CUIT inválido. Deben ser 11 dígitos sin guiones.';
    if (!legalName.trim()) return 'Ingresá la razón social.';
    if (alias.length < 3 || alias.length > 50) return 'El alias debe tener entre 3 y 50 caracteres.';
    if (!ALIAS_REGEX.test(alias)) return 'El alias solo puede tener letras, números, guion (-) y guion bajo (_).';
    const sp = Number(salesPoint);
    if (!Number.isInteger(sp) || sp <= 0) return 'Punto de venta inválido.';
    return null;
  }

  async function handleGenerate() {
    const err = validateStep1();
    if (err) {
      toast.error(err);
      return;
    }
    setGenerating(true);
    try {
      const result = await data.generateAfipCsr({
        cuit,
        legalName: legalName.trim(),
        alias: alias.trim(),
        salesPoint: Number(salesPoint),
        environment,
      });
      setCsrResult(result);
      setStep(2);
      toast.success('Certificado generado. Copialo y pegalo en AFIP.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopyCsr() {
    if (!csrResult) return;
    try {
      await navigator.clipboard.writeText(csrResult.csrPem);
      toast.success('CSR copiado al portapapeles.');
    } catch {
      toast.error('No se pudo copiar. Seleccioná el texto a mano.');
    }
  }

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
      if (!text.includes('-----BEGIN CERTIFICATE-----') || !text.includes('-----END CERTIFICATE-----')) {
        toast.error('El archivo no parece un certificado PEM válido.');
        return;
      }
      setCertPem(text);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleUpload() {
    const trimmed = certPem.trim();
    if (!trimmed.includes('-----BEGIN CERTIFICATE-----') || !trimmed.includes('-----END CERTIFICATE-----')) {
      toast.error('El contenido no parece un certificado PEM. Debe incluir BEGIN/END CERTIFICATE.');
      return;
    }
    const envToUse = csrResult?.environment ?? environment;
    setUploading(true);
    try {
      const result = await data.uploadAfipCertificate({
        environment: envToUse,
        certPem: trimmed,
      });
      if (result.ok) {
        toast.success('AFIP activado. Probá la conexión para verificar.');
        onCompleted();
        onClose();
      } else {
        toast.error(result.error ?? 'No se pudo activar AFIP.');
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleRequestClose() {
    // Si está en paso 2 o 3, la key ya está en el server: avisamos que puede retomar.
    if (step === 2 || step === 3) {
      const ok = await confirmDialog('¿Cerrar el asistente?', {
        text: 'Tu certificado ya quedó guardado en el servidor. Podés retomar el onboarding desde Settings → Facturación cuando bajes el .crt de AFIP.',
        icon: 'question',
        confirmText: 'Cerrar',
        cancelText: 'Seguir',
      });
      if (!ok) return;
    }
    onClose();
  }

  async function handleBackToStep1() {
    // Volver al paso 1 desde el 2 implicaría re-generar (otra key). Confirmamos.
    const ok = await confirmDialog('¿Volver y regenerar?', {
      text: 'Si volvés al paso 1 y generás de nuevo, se reemplaza el CSR actual y vas a tener que volver a pasar por AFIP.',
      icon: 'warning',
      confirmText: 'Sí, regenerar',
      cancelText: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    setCsrResult(null);
    setStep(1);
  }

  // ---------- Render ----------

  return (
    <Modal open={open} onClose={handleRequestClose} title="Asistente de configuración AFIP" widthClass="max-w-2xl">
      <div className="space-y-5">
        <ProgressBar current={step} />

        {step === 1 && (
          <Step1Form
            cuit={cuit}
            setCuit={setCuit}
            legalName={legalName}
            setLegalName={setLegalName}
            alias={alias}
            setAlias={setAlias}
            aliasPlaceholder={aliasPlaceholder}
            salesPoint={salesPoint}
            setSalesPoint={setSalesPoint}
            environment={environment}
            setEnvironment={setEnvironment}
            forceEnvironment={forceEnvironment}
            generating={generating}
            onGenerate={handleGenerate}
            onCancel={handleRequestClose}
          />
        )}

        {step === 2 && csrResult && (
          <Step2Csr
            csr={csrResult}
            onCopy={handleCopyCsr}
            onBack={handleBackToStep1}
            onNext={() => setStep(3)}
          />
        )}

        {step === 3 && csrResult && (
          <Step3Afip
            csr={csrResult}
            onCopy={handleCopyCsr}
            onBack={() => setStep(2)}
            onNext={() => setStep(4)}
          />
        )}

        {step === 4 && (
          <Step4Upload
            certPem={certPem}
            setCertPem={setCertPem}
            onCertFile={handleCertFile}
            uploading={uploading}
            onUpload={handleUpload}
            onBack={() => setStep(3)}
          />
        )}
      </div>
    </Modal>
  );
}

// =====================================================================
// Progress bar
// =====================================================================
function ProgressBar({ current }: { current: Step }) {
  const labels: Record<Step, string> = {
    1: 'Datos',
    2: 'CSR',
    3: 'AFIP',
    4: 'Activar',
  };
  return (
    <div className="flex items-center gap-2">
      {([1, 2, 3, 4] as Step[]).map((n, idx) => {
        const active = n === current;
        const done = n < current;
        return (
          <div key={n} className="flex flex-1 items-center gap-2">
            <div
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                done && 'bg-emerald-500 text-white',
                active && 'bg-brand-600 text-white ring-4 ring-brand-100',
                !done && !active && 'bg-slate-200 text-slate-600',
              )}
            >
              {done ? <CheckCircle2 className="h-4 w-4" /> : n}
            </div>
            <span
              className={cn(
                'text-xs font-medium',
                active ? 'text-brand-700' : done ? 'text-emerald-700' : 'text-slate-500',
              )}
            >
              {labels[n]}
            </span>
            {idx < 3 && (
              <div className={cn('h-px flex-1', n < current ? 'bg-emerald-300' : 'bg-slate-200')} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// =====================================================================
// Paso 1 — Datos del comercio
// =====================================================================
function Step1Form({
  cuit,
  setCuit,
  legalName,
  setLegalName,
  alias,
  setAlias,
  aliasPlaceholder,
  salesPoint,
  setSalesPoint,
  environment,
  setEnvironment,
  forceEnvironment,
  generating,
  onGenerate,
  onCancel,
}: {
  cuit: string;
  setCuit: (v: string) => void;
  legalName: string;
  setLegalName: (v: string) => void;
  alias: string;
  setAlias: (v: string) => void;
  aliasPlaceholder: string;
  salesPoint: string;
  setSalesPoint: (v: string) => void;
  environment: Environment;
  setEnvironment: (v: Environment) => void;
  forceEnvironment?: Environment;
  generating: boolean;
  onGenerate: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 p-4">
        <h4 className="mb-1 font-display text-sm font-bold text-navy">Paso 1 — Datos del comercio</h4>
        <p className="mb-4 text-xs text-slate-600">
          Vamos a generar tu certificado en nuestros servidores.{' '}
          <strong>Tu clave privada nunca sale de TrankaPos.</strong>
        </p>

        {forceEnvironment ? (
          <div
            className={cn(
              'mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold',
              forceEnvironment === 'production'
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-amber-100 text-amber-800',
            )}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Generando para {ENV_LABEL[forceEnvironment]}
          </div>
        ) : (
          <div className="mb-4">
            <label className="mb-2 block text-xs font-medium text-slate-700">Ambiente</label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-lg border p-3',
                  environment === 'homologation'
                    ? 'border-amber-400 bg-amber-50'
                    : 'border-slate-200 hover:bg-slate-50',
                )}
              >
                <input
                  type="radio"
                  name="environment"
                  value="homologation"
                  checked={environment === 'homologation'}
                  onChange={() => setEnvironment('homologation')}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-sm font-semibold text-slate-900">Homologación</div>
                  <div className="text-xs text-slate-600">Pruebas. Sin validez fiscal.</div>
                </div>
              </label>
              <label
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-lg border p-3',
                  environment === 'production'
                    ? 'border-emerald-400 bg-emerald-50'
                    : 'border-slate-200 hover:bg-slate-50',
                )}
              >
                <input
                  type="radio"
                  name="environment"
                  value="production"
                  checked={environment === 'production'}
                  onChange={() => setEnvironment('production')}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-sm font-semibold text-slate-900">Producción</div>
                  <div className="text-xs text-slate-600">Comprobantes reales ante AFIP.</div>
                </div>
              </label>
            </div>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">CUIT</label>
            <Input
              value={cuit}
              onChange={(e) => setCuit(e.target.value.replace(/\D/g, ''))}
              maxLength={11}
              placeholder="20123456789"
            />
            <p className="mt-1 text-xs text-slate-500">11 dígitos sin guiones</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Punto de venta</label>
            <Input
              type="number"
              min="1"
              value={salesPoint}
              onChange={(e) => setSalesPoint(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-500">El que diste de alta en AFIP</p>
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-700">Razón social</label>
            <Input
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder="Mi Comercio S.A."
            />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-700">Alias del certificado</label>
            <Input
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder={aliasPlaceholder}
              maxLength={50}
            />
            <p className="mt-1 text-xs text-slate-500">
              3 a 50 caracteres. Letras, números, guion (-) y guion bajo (_). Lo vas a usar como nombre del alias en AFIP.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-sky-200 bg-sky-50 p-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" />
        <p className="text-xs text-sky-900">
          Vamos a generar el par RSA y el CSR en nuestros servidores. La clave privada queda
          guardada <strong>encriptada</strong> en nuestra base — nunca se descarga ni se muestra.
          El CSR (texto público) lo vas a copiar al portal de AFIP en el próximo paso.
        </p>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={generating}>
          Cancelar
        </Button>
        <Button onClick={onGenerate} disabled={generating}>
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {generating ? 'Generando…' : 'Generar certificado'}
        </Button>
      </div>
    </div>
  );
}

// =====================================================================
// Paso 2 — Tu CSR está listo
// =====================================================================
function Step2Csr({
  csr,
  onCopy,
  onBack,
  onNext,
}: {
  csr: ExistingCsr;
  onCopy: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 p-4">
        <h4 className="mb-1 font-display text-sm font-bold text-navy">Paso 2 — Tu CSR está listo</h4>
        <p className="mb-3 text-xs text-slate-600">
          Generamos tu solicitud de certificado (CSR). Copialo y pegalo en WSASS de AFIP.
        </p>

        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
            Alias: <strong>{csr.alias}</strong>
          </span>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 font-medium',
              csr.environment === 'production'
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-amber-100 text-amber-800',
            )}
          >
            {ENV_LABEL[csr.environment]}
          </span>
        </div>

        <textarea
          readOnly
          value={csr.csrPem}
          className="h-48 w-full resize-none rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-xs text-slate-800"
        />

        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={onCopy}>
            <Copy className="h-4 w-4" />
            Copiar al portapapeles
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <p className="text-xs text-amber-900">
          Guardalo en un lugar seguro. Si cerrás esta ventana, podés volver a verlo desde{' '}
          <strong>Settings → Facturación</strong>.
        </p>
      </div>

      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Atrás (regenerar)
        </Button>
        <Button onClick={onNext}>Siguiente: pegarlo en AFIP</Button>
      </div>
    </div>
  );
}

// =====================================================================
// Paso 3 — Pegar en WSASS
// =====================================================================
function Step3Afip({
  csr,
  onCopy,
  onBack,
  onNext,
}: {
  csr: ExistingCsr;
  onCopy: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const wsassUrl = WSASS_URLS[csr.environment];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 p-4">
        <h4 className="mb-1 font-display text-sm font-bold text-navy">Paso 3 — Pegarlo en AFIP</h4>
        <p className="mb-3 text-xs text-slate-600">Seguí estos pasos en el portal de AFIP:</p>

        <ol className="space-y-3 text-sm text-slate-800">
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
              1
            </span>
            <div>
              Entrá a <strong>WSASS</strong> con tu Clave Fiscal:
              <a
                href={wsassUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-1 inline-flex items-center gap-1 text-brand-600 hover:underline"
              >
                Abrir WSASS ({ENV_LABEL[csr.environment]})
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
              2
            </span>
            <div>
              Andá a <strong>"Administración de Certificados Digitales"</strong> →{' '}
              <strong>"Agregar alias"</strong> y pegá el CSR. Usá este alias:{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold">{csr.alias}</code>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
              3
            </span>
            <div>
              Una vez creado, andá a <strong>"Crear autorización a servicio"</strong>, seleccioná tu alias
              y autorizá el servicio{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold">wsfe</code>{' '}
              (Factura Electrónica).
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
              4
            </span>
            <div>
              Volvé a <strong>"Administración de Certificados Digitales"</strong> y descargá el{' '}
              <strong>.crt</strong> de tu alias. Después volvé acá para subirlo.
            </div>
          </li>
        </ol>
      </div>

      {/* Preview del CSR para re-copiar si se perdió */}
      <details className="rounded-lg border border-slate-200 p-3">
        <summary className="cursor-pointer text-xs font-medium text-slate-700">
          ¿Perdiste el CSR? Volvé a copiarlo
        </summary>
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
              Alias: <strong>{csr.alias}</strong>
            </span>
          </div>
          <textarea
            readOnly
            value={csr.csrPem}
            className="h-32 w-full resize-none rounded-lg border border-slate-300 bg-slate-50 p-2 font-mono text-xs text-slate-800"
          />
          <Button size="sm" onClick={onCopy}>
            <Copy className="h-4 w-4" />
            Copiar otra vez
          </Button>
        </div>
      </details>

      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Atrás
        </Button>
        <Button onClick={onNext}>Ya hice los pasos, subir certificado</Button>
      </div>
    </div>
  );
}

// =====================================================================
// Paso 4 — Subir el .crt
// =====================================================================
function Step4Upload({
  certPem,
  setCertPem,
  onCertFile,
  uploading,
  onUpload,
  onBack,
}: {
  certPem: string;
  setCertPem: (v: string) => void;
  onCertFile: (e: ChangeEvent<HTMLInputElement>) => void;
  uploading: boolean;
  onUpload: () => void;
  onBack: () => void;
}) {
  const hasBegin = certPem.includes('-----BEGIN CERTIFICATE-----');
  const hasEnd = certPem.includes('-----END CERTIFICATE-----');
  const valid = hasBegin && hasEnd;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 p-4">
        <h4 className="mb-1 font-display text-sm font-bold text-navy">Paso 4 — Subir el certificado</h4>
        <p className="mb-3 text-xs text-slate-600">
          Subí el archivo <strong>.crt</strong> que descargaste de AFIP, o pegá su contenido directo.
        </p>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Archivo .crt</label>
            <input
              type="file"
              accept=".crt,.pem,application/x-pem-file,text/plain"
              onChange={onCertFile}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              O pegá el contenido del certificado
            </label>
            <textarea
              value={certPem}
              onChange={(e) => setCertPem(e.target.value)}
              placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
              className="h-40 w-full resize-none rounded-lg border border-slate-300 bg-white p-3 font-mono text-xs text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
            />
            {certPem && (
              <div className={cn('mt-1 text-xs', valid ? 'text-emerald-700' : 'text-amber-700')}>
                {valid
                  ? `✓ Formato OK (${certPem.length} caracteres)`
                  : 'El contenido debe incluir las líneas BEGIN y END CERTIFICATE.'}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-sky-200 bg-sky-50 p-3">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" />
        <p className="text-xs text-sky-900">
          Vamos a verificar que el certificado corresponda a la clave privada que generamos. Si no
          coincide (porque pegaste un certificado de otro alias), te lo avisamos.
        </p>
      </div>

      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="outline" onClick={onBack} disabled={uploading}>
          <ArrowLeft className="h-4 w-4" />
          Atrás
        </Button>
        <Button onClick={onUpload} disabled={uploading || !valid}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {uploading ? 'Activando…' : 'Activar AFIP'}
        </Button>
      </div>
    </div>
  );
}

