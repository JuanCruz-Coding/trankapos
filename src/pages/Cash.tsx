import { useMemo, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Wallet, ArrowDownCircle, ArrowUpCircle, Lock, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Empty } from '@/components/ui/Empty';
import { data } from '@/data';
import { useAuth } from '@/stores/auth';
import { formatARS } from '@/lib/currency';
import { formatDateTime } from '@/lib/dates';
import { toast } from '@/stores/toast';
import { usePermission } from '@/lib/permissions';

export default function Cash() {
  const { activeBranchId, session } = useAuth();
  const canOpenClose = usePermission('cash_register_open_close');
  const [openModal, setOpenModal] = useState(false);
  const [closeModal, setCloseModal] = useState(false);
  const [mvModal, setMvModal] = useState<false | 'in' | 'out'>(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const bumpRefresh = () => setRefreshKey((k) => k + 1);

  const openReg = useLiveQuery(async () => {
    if (!activeBranchId) return null;
    return data.currentOpenRegister(activeBranchId);
  }, [activeBranchId, refreshKey]);

  const regs = useLiveQuery(async () => {
    if (!activeBranchId) return [];
    return data.listRegisters(activeBranchId);
  }, [activeBranchId, refreshKey]);

  const sales = useLiveQuery(async () => {
    if (!openReg) return [];
    return data.listSales({ registerId: openReg.id });
  }, [openReg?.id, refreshKey]);

  const movements = useLiveQuery(async () => {
    if (!openReg) return [];
    return data.listCashMovements(openReg.id);
  }, [openReg?.id, refreshKey]);

  const regSales = useMemo(
    () => (sales ?? []).filter((s) => !s.voided),
    [sales],
  );

  const cashIn = useMemo(
    () =>
      regSales.reduce(
        (acc, s) =>
          acc + s.payments.filter((p) => p.method === 'cash').reduce((a, p) => a + p.amount, 0),
        0,
      ),
    [regSales],
  );

  const mvNet = useMemo(
    () => (movements ?? []).reduce((acc, m) => acc + (m.kind === 'in' ? m.amount : -m.amount), 0),
    [movements],
  );

  const expectedCash = (openReg?.openingAmount ?? 0) + cashIn + mvNet;

  if (!activeBranchId) {
    return <div className="p-6 text-slate-500">Seleccioná una sucursal</div>;
  }

  return (
    <div>
      <PageHeader
        title="Caja"
        subtitle={openReg ? 'Caja abierta' : 'Caja cerrada — abrila para empezar a vender'}
        actions={
          openReg ? (
            <>
              <Button variant="outline" onClick={() => setMvModal('in')}>
                <ArrowDownCircle className="h-4 w-4" /> Ingreso
              </Button>
              <Button variant="outline" onClick={() => setMvModal('out')}>
                <ArrowUpCircle className="h-4 w-4" /> Egreso
              </Button>
              {canOpenClose && (
                <Button variant="danger" onClick={() => setCloseModal(true)}>
                  <Lock className="h-4 w-4" /> Cerrar caja
                </Button>
              )}
            </>
          ) : canOpenClose ? (
            <Button onClick={() => setOpenModal(true)}>
              <Unlock className="h-4 w-4" /> Abrir caja
            </Button>
          ) : (
            <span className="text-xs text-slate-500">
              Sin permiso para abrir caja
            </span>
          )
        }
      />

      {openReg ? (
        <div className="mb-6 grid gap-3 md:grid-cols-4">
          <Stat label="Monto inicial" value={formatARS(openReg.openingAmount)} />
          <Stat label="Ventas efectivo" value={formatARS(cashIn)} />
          <Stat label="Mov. netos" value={formatARS(mvNet)} />
          <Stat label="Esperado en caja" value={formatARS(expectedCash)} highlight />
        </div>
      ) : null}

      {openReg && (
        <div className="mb-6 grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Ventas de la caja ({regSales.length})</CardTitle>
            </CardHeader>
            <CardBody>
              {regSales.length === 0 ? (
                <p className="text-sm text-slate-400">Sin ventas aún</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {regSales.slice(0, 10).map((s) => (
                    <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                      <span className="text-slate-500">{formatDateTime(s.createdAt)}</span>
                      <span className="font-semibold">{formatARS(s.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Movimientos ({movements?.length ?? 0})</CardTitle>
            </CardHeader>
            <CardBody>
              {(movements ?? []).length === 0 ? (
                <p className="text-sm text-slate-400">Sin movimientos</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {movements!.map((m) => (
                    <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                      <div>
                        <div className="font-medium">{m.reason || '(sin detalle)'}</div>
                        <div className="text-xs text-slate-500">{formatDateTime(m.createdAt)}</div>
                      </div>
                      <span
                        className={
                          'font-semibold ' + (m.kind === 'in' ? 'text-emerald-600' : 'text-red-600')
                        }
                      >
                        {m.kind === 'in' ? '+' : '-'}
                        {formatARS(m.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Historial de cajas</CardTitle>
        </CardHeader>
        <CardBody>
          {(regs ?? []).length === 0 ? (
            <Empty title="Sin cajas previas" />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-2 py-2">Apertura</th>
                    <th className="px-2 py-2">Cierre</th>
                    <th className="px-2 py-2 text-right">Monto inicial</th>
                    <th className="px-2 py-2 text-right">Esperado</th>
                    <th className="px-2 py-2 text-right">Cerrado con</th>
                    <th className="px-2 py-2 text-right">Diferencia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {regs!.map((r) => (
                    <tr key={r.id}>
                      <td className="px-2 py-2">{formatDateTime(r.openedAt)}</td>
                      <td className="px-2 py-2">
                        {r.closedAt ? (
                          formatDateTime(r.closedAt)
                        ) : (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                            Abierta
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatARS(r.openingAmount)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {r.expectedCash !== null ? formatARS(r.expectedCash) : '—'}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {r.closingAmount !== null ? formatARS(r.closingAmount) : '—'}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {r.difference !== null ? (
                          <span
                            className={
                              r.difference === 0
                                ? 'text-slate-500'
                                : r.difference > 0
                                  ? 'text-emerald-600'
                                  : 'text-red-600'
                            }
                          >
                            {r.difference > 0 ? '+' : ''}
                            {formatARS(r.difference)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <OpenModal
        open={openModal}
        onClose={() => setOpenModal(false)}
        branchId={activeBranchId}
        onSuccess={bumpRefresh}
      />
      <CloseModal
        open={closeModal}
        onClose={() => setCloseModal(false)}
        registerId={openReg?.id}
        expected={expectedCash}
        onSuccess={bumpRefresh}
      />
      <MovementModal
        kind={mvModal === false ? 'in' : mvModal}
        open={!!mvModal}
        onClose={() => setMvModal(false)}
        registerId={openReg?.id}
        onSuccess={bumpRefresh}
      />
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className={
        'rounded-xl border p-4 shadow-sm ' +
        (highlight
          ? 'border-brand-200 bg-brand-50 text-brand-900'
          : 'border-slate-200 bg-white')
      }
    >
      <div className="flex items-center gap-2 text-xs uppercase text-slate-500">
        <Wallet className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 font-display text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function OpenModal({
  open,
  onClose,
  branchId,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  branchId: string;
  onSuccess: () => void;
}) {
  const [amount, setAmount] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await data.openRegister({ branchId, openingAmount: Number(amount) || 0 });
      toast.success('Caja abierta');
      onSuccess();
      onClose();
      setAmount('');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Abrir caja" widthClass="max-w-sm">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">
            Monto inicial en caja
          </label>
          <Input
            type="number"
            min="0"
            step="0.01"
            required
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <Button className="w-full" type="submit">
          Abrir caja
        </Button>
      </form>
    </Modal>
  );
}

function CloseModal({
  open,
  onClose,
  registerId,
  expected,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  registerId?: string;
  expected: number;
  onSuccess: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!registerId) return;
    try {
      await data.closeRegister({
        registerId,
        closingAmount: Number(amount) || 0,
        notes,
      });
      toast.success('Caja cerrada');
      onSuccess();
      onClose();
      setAmount('');
      setNotes('');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Cerrar caja" widthClass="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <div className="flex justify-between">
            <span>Esperado en efectivo</span>
            <span className="font-semibold">{formatARS(expected)}</span>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">
            Contado real (arqueo)
          </label>
          <Input
            type="number"
            min="0"
            step="0.01"
            required
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Notas</label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <Button className="w-full" variant="danger" type="submit">
          Cerrar caja
        </Button>
      </form>
    </Modal>
  );
}

function MovementModal({
  open,
  onClose,
  kind,
  registerId,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  kind: 'in' | 'out';
  registerId?: string;
  onSuccess: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!registerId) return;
    try {
      await data.addCashMovement({
        registerId,
        kind,
        amount: Number(amount) || 0,
        reason,
      });
      toast.success(kind === 'in' ? 'Ingreso registrado' : 'Egreso registrado');
      onSuccess();
      setAmount('');
      setReason('');
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={kind === 'in' ? 'Ingreso de caja' : 'Egreso de caja'}
      widthClass="max-w-sm"
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Monto</label>
          <Input
            type="number"
            min="0"
            step="0.01"
            required
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Motivo</label>
          <Input
            required
            placeholder={kind === 'in' ? 'Ej: cambio recibido' : 'Ej: pago proveedor'}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <Button className="w-full" type="submit">
          Registrar
        </Button>
      </form>
    </Modal>
  );
}
