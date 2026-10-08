/**
 * Compara el mail del reporte que arma el FRONT (lo que hoy se manda con "Enviar ahora") contra el
 * que arma el backend para los envíos programados (backend/app/services/reporte_auto.py).
 *
 * Entrada: el JSONL de `backend/scripts/comparar_reporte_auto.py` (mismos datos que recibe la
 * pantalla + la salida del backend). Correrlo el MISMO día que el volcado (el front usa la fecha de hoy).
 *   npx tsx --tsconfig tsconfig.app.json scripts/comparar_reporte_front.ts muestra.jsonl
 */
import { readFileSync } from 'node:fs';
import { construirCliente } from '../src/services/clientesService';
import { combinar } from '../src/context/ConfigContext';
import { aplicarMontosOficiales } from '../src/data/categorias';
import { armarDatosReporte, opcionesReporte } from '../src/lib/reporteDatos';
import { armarMailReporte } from '../src/lib/reporteMail';

const archivo = process.argv[2];
const lineas = readFileSync(archivo, 'utf8').split('\n').filter(Boolean);
let iguales = 0;
let distintos = 0;
for (const linea of lineas) {
  const d = JSON.parse(linea);
  if (d.escala?.length) aplicarMontosOficiales(d.escala);
  const config = combinar(d.config);
  const cliente = construirCliente(d.bk, d.comprobantes);
  const rep = opcionesReporte(config.reporte, cliente.reporteConfig);
  const datos = armarDatosReporte(cliente, config, 0.02, d.movimientos, rep);
  const mail = armarMailReporte({ cliente, datos, rep, observaciones: d.observaciones, estudio: d.estudio });
  const campos = (['asunto', 'texto', 'html'] as const).filter(k => mail[k] !== d.py[k]);
  if (campos.length === 0) {
    iguales++;
    continue;
  }
  distintos++;
  console.log(`\n✗ ${d.cuit} (${cliente.nombre}) difiere en: ${campos.join(', ')}`);
  for (const k of campos) {
    const a = mail[k].split('\n');
    const b = String(d.py[k]).split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        console.log(`  [${k} línea ${i + 1}]\n    front:   ${JSON.stringify(a[i])}\n    backend: ${JSON.stringify(b[i])}`);
        break;
      }
    }
  }
}
console.log(`\n${iguales} iguales, ${distintos} distintos (de ${lineas.length}).`);
