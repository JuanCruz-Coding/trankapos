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
  price: positiveNumber('Precio'),
  cost: positiveNumber('Costo'),
  taxRate: z
    .number({ invalid_type_error: 'Alícuota inválida' })
    .min(0, 'Alícuota mínima 0')
    .max(100, 'Alícuota máxima 100'),
  categoryId: z.string().nullable(),
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
  depotId: z.string().nullable(),
  active: z.boolean(),
});

export const depotSchema = z.object({
  name: nonEmpty('Nombre del depósito'),
  address: z.string().trim().max(200, 'Máximo 200 caracteres'),
  active: z.boolean(),
});

export const transferSchema = z
  .object({
    fromDepotId: nonEmpty('Depósito origen'),
    toDepotId: nonEmpty('Depósito destino'),
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
  .refine((d) => d.fromDepotId !== d.toDepotId, {
    message: 'Origen y destino deben ser distintos',
    path: ['toDepotId'],
  });

export type ProductFormValues = z.infer<typeof productSchema>;
export type UserFormValues = z.infer<typeof userSchema>;
export type DepotFormValues = z.infer<typeof depotSchema>;
export type TransferFormValues = z.infer<typeof transferSchema>;

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
