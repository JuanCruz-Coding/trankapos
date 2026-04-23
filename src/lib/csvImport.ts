export interface ParsedRow {
  line: number;
  name: string;
  barcode: string | null;
  price: number;
  cost: number;
  category: string | null;
  taxRate: number;
  stock: number;
}

export interface ParseError {
  line: number;
  message: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  errors: ParseError[];
}

const HEADER_ALIASES: Record<string, keyof ParsedRow> = {
  nombre: 'name',
  name: 'name',
  producto: 'name',
  descripcion: 'name',
  codigo: 'barcode',
  codigo_barras: 'barcode',
  'codigo de barras': 'barcode',
  barcode: 'barcode',
  ean: 'barcode',
  precio: 'price',
  'precio venta': 'price',
  'precio_venta': 'price',
  price: 'price',
  costo: 'cost',
  cost: 'cost',
  categoria: 'category',
  category: 'category',
  rubro: 'category',
  iva: 'taxRate',
  'iva %': 'taxRate',
  tax: 'taxRate',
  stock: 'stock',
  cantidad: 'stock',
};

function detectSeparator(headerLine: string): ',' | ';' | '\t' {
  const tab = (headerLine.match(/\t/g) ?? []).length;
  const semi = (headerLine.match(/;/g) ?? []).length;
  const comma = (headerLine.match(/,/g) ?? []).length;
  if (tab >= semi && tab >= comma && tab > 0) return '\t';
  if (semi >= comma) return ';';
  return ',';
}

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseNumber(raw: string): number | null {
  if (!raw) return null;
  const s = raw.replace(/\s/g, '').replace(/[^\d,.\-]/g, '');
  if (!s || s === '-' || s === '.' || s === ',') return null;
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  let normalized = s;
  if (hasDot && hasComma) {
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastComma > lastDot) {
      normalized = s.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    normalized = s.replace(',', '.');
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function parseCsv(text: string): ParseResult {
  const clean = text.replace(/^﻿/, '');
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const result: ParseResult = { rows: [], errors: [] };
  if (lines.length === 0) {
    result.errors.push({ line: 0, message: 'Archivo vacío' });
    return result;
  }

  const sep = detectSeparator(lines[0]);
  const rawHeaders = splitCsvLine(lines[0], sep).map((h) => h.toLowerCase().trim());
  const headerMap: (keyof ParsedRow | null)[] = rawHeaders.map(
    (h) => HEADER_ALIASES[h] ?? null,
  );

  if (!headerMap.includes('name')) {
    result.errors.push({ line: 1, message: 'Falta la columna "nombre"' });
    return result;
  }
  if (!headerMap.includes('price')) {
    result.errors.push({ line: 1, message: 'Falta la columna "precio"' });
    return result;
  }

  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1;
    const fields = splitCsvLine(lines[i], sep);
    const record: Record<string, string> = {};
    headerMap.forEach((key, idx) => {
      if (key) record[key] = (fields[idx] ?? '').trim();
    });

    const name = record.name ?? '';
    if (!name) {
      result.errors.push({ line: lineNo, message: 'Nombre vacío' });
      continue;
    }

    const price = parseNumber(record.price ?? '');
    if (price === null) {
      result.errors.push({ line: lineNo, message: 'Precio inválido o faltante' });
      continue;
    }
    if (price < 0) {
      result.errors.push({ line: lineNo, message: 'Precio negativo' });
      continue;
    }

    const cost = parseNumber(record.cost ?? '') ?? 0;
    const taxRate = parseNumber(record.taxRate ?? '') ?? 21;
    const stock = parseNumber(record.stock ?? '') ?? 0;

    if (cost < 0 || taxRate < 0 || stock < 0) {
      result.errors.push({ line: lineNo, message: 'Valores negativos no permitidos' });
      continue;
    }

    result.rows.push({
      line: lineNo,
      name,
      barcode: record.barcode ? record.barcode : null,
      price,
      cost,
      category: record.category ? record.category : null,
      taxRate,
      stock,
    });
  }

  return result;
}

export const CSV_TEMPLATE =
  'nombre;codigo_barras;precio;costo;categoria;iva;stock\n' +
  'Coca Cola 500ml;7790895000014;1200;900;Bebidas;21;10\n' +
  'Agua Mineral 500ml;7790895000021;900;600;Bebidas;21;8\n' +
  'Producto sin código;;500;300;;21;0\n';
