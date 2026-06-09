/**
 * Identifica AUTOMÁTICAMENTE a qué cliente pertenece un extracto recién cargado, sin pedirle nada al
 * contador. La señal vive en la CABECERA del archivo (las filas que `parsearArchivo` guarda en
 * `metadatos`): casi todos los bancos y billeteras imprimen ahí el titular de la cuenta y su CUIT.
 *
 * Prioridad de las señales (de más a menos confiable):
 *   1. CUIT del titular en la cabecera que coincide EXACTO con un cliente de la cartera.
 *   2. Nombre del titular en la cabecera que coincide (por tokens) con un cliente.
 *   3. Nombre del archivo (p. ej. "Galicia - PEREZ JUAN.xlsx").
 * Si ninguna resuelve un único cliente → null (la página lo manda al repê manual).
 */
import type { Cliente } from '@/types';
import type { ExtractoParseado } from './parsearExtracto';

export type ConfianzaTitular = 'alta' | 'media' | 'baja';

export interface TitularIdentificado {
  clienteCuit: string;
  confianza: ConfianzaTitular;
  /** Texto corto, en términos del contador, de por qué se asignó (se muestra en la UI). */
  motivo: string;
}

const soloDigitos = (s: string) => s.replace(/\D/g, '');

/** Normaliza para comparar nombres: minúsculas, sin tildes, sólo letras/dígitos y espacios. */
function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // saca tildes
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Conectores y formas societarias que no aportan a la identificación.
const STOPWORDS = new Set([
  'del', 'los', 'las', 'sociedad', 'anonima', 'responsabilidad', 'limitada', 'srl', 'sas',
  'sa', 'don', 'dona', 'sr', 'sra', 'cuit', 'cuil', 'titular', 'cuenta', 'extracto', 'resumen',
  'movimientos', 'banco', 'comprobante',
]);

/** Tokens significativos de un texto (palabras de ≥3 letras que no son stopwords). */
export function tokens(s: string): string[] {
  return normalizar(s)
    .split(' ')
    .filter(t => t.length >= 3 && !STOPWORDS.has(t));
}

/** Todos los CUIT (11 dígitos) que aparezcan en un conjunto de celdas, con o sin guiones/puntos. */
function cuitsEn(celdas: string[]): string[] {
  const out: string[] = [];
  for (const celda of celdas) {
    // Corridas de dígitos con separadores internos (.-): atrapa "20-12345678-9" y "20123456789".
    const corridas = celda.match(/\d[\d.-]{8,}\d/g) ?? [];
    for (const corrida of corridas) {
      const d = soloDigitos(corrida);
      if (d.length === 11) out.push(d); // un CBU (22) o nº de cuenta no caen acá
    }
  }
  return out;
}

/**
 * Busca en `texto` el cliente cuyos tokens de nombre coinciden mejor. Exige al menos 2 tokens en
 * común (1 si el nombre del cliente tiene un solo token significativo) para evitar falsos positivos
 * con apellidos comunes. Si dos clientes empatan, es ambiguo → devuelve null.
 */
function clientePorNombre(texto: string, cartera: Cliente[]): Cliente | null {
  const presentes = new Set(tokens(texto));
  if (presentes.size === 0) return null;
  let mejor: { cli: Cliente; hits: number } | null = null;
  let ambiguo = false;
  for (const cli of cartera) {
    const tCli = tokens(cli.nombre);
    if (tCli.length === 0) continue;
    const hits = tCli.filter(t => presentes.has(t)).length;
    const requeridos = tCli.length === 1 ? 1 : 2;
    if (hits < requeridos) continue;
    if (mejor && hits === mejor.hits) ambiguo = true;
    if (!mejor || hits > mejor.hits) {
      mejor = { cli, hits };
      ambiguo = false;
    }
  }
  return mejor && !ambiguo ? mejor.cli : null;
}

export function identificarTitular(
  parseado: ExtractoParseado,
  nombreArchivo: string,
  cartera: Cliente[],
): TitularIdentificado | null {
  if (cartera.length === 0) return null;
  const porCuit = new Map(cartera.map(c => [soloDigitos(c.cuit), c]));
  const celdasCabecera = parseado.metadatos.flat();

  // (1) CUIT del titular en la cabecera: la señal inequívoca.
  for (const cuit of cuitsEn(celdasCabecera)) {
    const cli = porCuit.get(cuit);
    if (cli) return { clienteCuit: cli.cuit, confianza: 'alta', motivo: 'Coincide el CUIT del titular' };
  }

  // (2) Nombre del titular en la cabecera.
  const porNombreCabecera = clientePorNombre(celdasCabecera.join(' '), cartera);
  if (porNombreCabecera) {
    return { clienteCuit: porNombreCabecera.cuit, confianza: 'media', motivo: 'Coincide el nombre del titular' };
  }

  // (3) Nombre del archivo, último recurso.
  const porArchivo = clientePorNombre(nombreArchivo, cartera);
  if (porArchivo) {
    return { clienteCuit: porArchivo.cuit, confianza: 'baja', motivo: 'Coincide con el nombre del archivo' };
  }

  return null;
}
