/**
 * Dispatcher de extractos en PDF: extrae el texto una sola vez, detecta de qué banco/billetera es y
 * deriva al parser correspondiente. Para sumar un banco nuevo: crear su `parsearPdf<Banco>.ts` (parser
 * de texto + detector `parece<Banco>`) y agregar una rama acá. El resto de la app (Conciliacion.tsx)
 * consume siempre el tipo común `ExtractoPdf`, sin importar el banco.
 */
import { extraerTextoPdf, type ExtractoPdf } from './parsearPdfComun';
import { parsearTextoMercadoPago, pareceMercadoPago } from './parsearPdfMercadoPago';
import { parsearTextoBancoProvincia, pareceBancoProvincia } from './parsearPdfBancoProvincia';
import { parsearTextoBrubank, pareceBrubank } from './parsearPdfBrubank';

// Re-export de lo común para que los consumidores importen todo desde un solo lugar.
export {
  CATEGORIA_LABEL,
  desglosarPorCategoria,
  aFilasNormalizadas,
  type ExtractoPdf,
  type MovimientoPdf,
  type CategoriaPdf,
  type DesgloseCategoria,
  type BancoPdf,
} from './parsearPdfComun';

/** Parsea un extracto en PDF de cualquier banco soportado. Lanza si el formato no se reconoce. */
export async function parsearPdf(file: File): Promise<ExtractoPdf> {
  const texto = await extraerTextoPdf(file);
  // Bapro primero: es más específico (sus marcadores no aparecen en MP/Brubank).
  if (pareceBancoProvincia(texto)) {
    const ext = parsearTextoBancoProvincia(texto);
    if (ext.movimientos.length === 0) {
      throw new Error('No pudimos leer los movimientos de este resumen de Banco Provincia.');
    }
    return ext;
  }
  // Brubank antes que MP: la palabra "MercadoPago" aparece en las descripciones de Brubank cuando el
  // titular se transfiere a/desde su cuenta de MP; sin este orden, el detector de MP daría falso positivo.
  if (pareceBrubank(texto)) {
    const ext = parsearTextoBrubank(texto);
    if (ext.movimientos.length === 0) {
      throw new Error('No pudimos leer los movimientos de este estado de cuenta de Brubank.');
    }
    return ext;
  }
  if (pareceMercadoPago(texto)) {
    const ext = parsearTextoMercadoPago(texto);
    if (ext.movimientos.length === 0) {
      throw new Error('No pudimos leer los movimientos de este resumen de MercadoPago.');
    }
    return ext;
  }
  throw new Error('No reconocimos el formato de este PDF. Por ahora soportamos MercadoPago, Banco Provincia y Brubank.');
}
