import { z } from 'zod';

const nonEmpty = (label: string) =>
  z
    .string({ required_error: `${label} requerido` })
    .trim()
    .min(1, `${label} requerido`);

const positiveNumber = (label: string) =>
  z
    .number({ invalid_type_error: `${label} inválido` })
    .nonnegative(`${label} no puede ser negativo`);

export const productSchema = z.object({
  name: nonEmpty('Nombre').max(120, 'Máximo 120 caracteres'),
  barcode: z
    .string()
    .trim()
    .max(50, 'Máximo 50 caracteres')
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null)),
  sku: z
    .string()
    .trim()
    .max(50, 'Máximo 50 caracteres')
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null)),
  price: positiveNumber('Precio'),
  cost: positiveNumber('Costo'),
  taxRate: z
    .number({ invalid_type_error: 'Alícuota inválida' })
    .min(0, 'Alícuota mínima 0')
    .max(100, 'Alícuota máxima 100'),
  categoryId: z.string().nullable(),
  trackStock: z.boolean(),
  allowSaleWhenZero: z.boolean(),
  active: z.boolean(),
});

export const userSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Email inválido'),
  password: z
    .string()
    .min(6, 'Mínimo 6 caracteres')
    .optional()
    .or(z.literal('')),
  name: nonEmpty('Nombre'),
  role: z.enum(['owner', 'manager', 'cashier'], {
    errorMap: () => ({ message: 'Rol inválido' }),
  }),
  branchId: z.string().nullable(),
  active: z.boolean(),
});

export const branchSchema = z.object({
  name: nonEmpty('Nombre de la sucursal'),
  address: z.string().trim().max(200, 'Máximo 200 caracteres'),
  phone: z.string().trim().max(50, 'Máximo 50 caracteres'),
  email: z
    .string()
    .trim()
    .max(120, 'Máximo 120 caracteres')
    .refine((v) => v === '' || /\S+@\S+\.\S+/.test(v), 'Email inválido'),
  active: z.boolean(),
});

export const warehouseSchema = z.object({
  name: nonEmpty('Nombre del depósito'),
  branchId: z.string().nullable(),
  isDefault: z.boolean(),
  participatesInPos: z.boolean(),
  alertLowStock: z.boolean(),
  active: z.boolean(),
});

export const tenantSettingsSchema = z.object({
  legalName: z.string().trim().max(200, 'Máximo 200 caracteres').optional(),
  taxId: z.string().trim().max(20, 'Máximo 20 caracteres').optional(),
  taxCondition: z
    .enum(['responsable_inscripto', 'monotributista', 'exento', 'consumidor_final'])
    .optional(),
  legalAddress: z.string().trim().max(300, 'Máximo 300 caracteres').optional(),
  phone: z.string().trim().max(50, 'Máximo 50 caracteres').optional(),
  email: z
    .string()
    .trim()
    .max(120, 'Máximo 120 caracteres')
    .refine((v) => v === '' || /\S+@\S+\.\S+/.test(v), 'Email inválido')
    .optional(),
  ticketTitle: z.string().trim().max(60, 'Máximo 60 caracteres').optional(),
  ticketFooter: z.string().trim().max(200, 'Máximo 200 caracteres').optional(),
  ticketShowLogo: z.boolean().optional(),
  ticketShowTaxId: z.boolean().optional(),
  ticketWidthMm: z.union([z.literal(58), z.literal(80)]).optional(),
  posAllowNegativeStock: z.boolean().optional(),
  posMaxDiscountPercent: z
    .number({ invalid_type_error: 'Descuento máximo inválido' })
    .min(0, 'Mínimo 0')
    .max(100, 'Máximo 100')
    .optional(),
  posRoundTo: z
    .number({ invalid_type_error: 'Redondeo inválido' })
    .positive('Debe ser mayor a 0')
    .optional(),
  posRequireCustomer: z.boolean().optional(),
  stockAlertsEnabled: z.boolean().optional(),
  skuAutoEnabled: z.boolean().optional(),
  skuPrefix: z
    .string()
    .trim()
    .min(1, 'Prefijo requerido')
    .max(10, 'Máximo 10 caracteres')
    .regex(/^[A-Za-z0-9_-]+$/, 'Solo letras, números, - o _')
    .optional(),
  posPartialReservesStock: z.boolean().optional(),
});

export const transferSchema = z
  .object({
    fromWarehouseId: nonEmpty('Depósito origen'),
    toWarehouseId: nonEmpty('Depósito destino'),
    notes: z.string().max(300, 'Máximo 300 caracteres'),
    items: z
      .array(
        z.object({
          productId: nonEmpty('Producto'),
          qty: z
            .number({ invalid_type_error: 'Cantidad inválida' })
            .int('La cantidad debe ser un número entero')
            .positive('La cantidad debe ser mayor a cero'),
        }),
      )
      .min(1, 'Agregá al menos un item'),
  })
  .refine((d) => d.fromWarehouseId !== d.toWarehouseId, {
    message: 'Origen y destino deben ser distintos',
    path: ['toWarehouseId'],
  });

export type ProductFormValues = z.infer<typeof productSchema>;
export type UserFormValues = z.infer<typeof userSchema>;
export type BranchFormValues = z.infer<typeof branchSchema>;
export type WarehouseFormValues = z.infer<typeof warehouseSchema>;
export type TransferFormValues = z.infer<typeof transferSchema>;
export type TenantSettingsFormValues = z.infer<typeof tenantSettingsSchema>;

/**
 * Helper para usar Zod en formularios sin frameworks: devuelve un objeto
 * { ok, data } o { ok, error } con mensaje listo para toast.
 */
export function safeParse<T>(
  schema: z.ZodType<T>,
  input: unknown,
): { ok: true; data: T } | { ok: false; error: string } {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const first = result.error.errors[0];
  return { ok: false, error: first?.message ?? 'Datos inválidos' };
}
