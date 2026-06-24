/**
 * Novedades del producto ("Qué hay de nuevo"), visibles para todos los contadores en /novedades y
 * en el indicador del header. Es una bitácora curada en lenguaje de usuario.
 *
 * ► CÓMO AGREGAR UNA NOVEDAD EN CADA DEPLOY
 *   Sumá un objeto AL PRINCIPIO del array `NOVEDADES` (el más reciente va primero). Reglas:
 *   - `id` único y estable (no lo cambies después: define qué cuenta como "ya visto").
 *   - `fecha` en ISO 'YYYY-MM-DD' (la del deploy).
 *   - Redactá en términos del contador. REGLA DE PRODUCTO: nunca menciones el mecanismo de
 *     obtención de datos (nada de "scraping", "ARCA", "navegador", "login", "tarda X", etc.).
 *   - Cada item es 'nuevo' (función nueva), 'mejora' (algo que ya estaba, ahora mejor) o
 *     'arreglo' (corrección).
 */

export type TipoNovedad = 'nuevo' | 'mejora' | 'arreglo';

export interface ItemNovedad {
  tipo: TipoNovedad;
  texto: string;
}

export interface Novedad {
  /** Identificador estable y único. Define qué se considera "ya visto"; no cambiarlo. */
  id: string;
  /** Fecha del deploy, ISO 'YYYY-MM-DD'. */
  fecha: string;
  titulo: string;
  /** Bajada opcional de una línea. */
  resumen?: string;
  items: ItemNovedad[];
}

export const TIPO_NOVEDAD_META: Record<
  TipoNovedad,
  { label: string; tono: 'success' | 'default' | 'warning' }
> = {
  nuevo: { label: 'Nuevo', tono: 'success' },
  mejora: { label: 'Mejora', tono: 'default' },
  arreglo: { label: 'Arreglo', tono: 'warning' },
};

/** Más reciente primero. Al hacer un deploy, agregá la nueva entrada acá arriba. */
export const NOVEDADES: Novedad[] = [
  {
    id: '2026-06-24-cancelar-alta',
    fecha: '2026-06-24',
    titulo: 'Cancelá un alta si te equivocaste',
    resumen: 'Si cargaste un cliente por error, ahora podés frenar el alta y se deshace sola.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'Mientras un cliente se está dando de alta, podés cancelarlo desde el indicador de cargas (arriba, al lado de las notificaciones) o desde la misma pantalla de alta.',
      },
      {
        tipo: 'nuevo',
        texto: 'Al cancelar, el cliente cargado por error se quita y no queda en tu cartera.',
      },
    ],
  },
  {
    id: '2026-06-24-alta-cliente-directa',
    fecha: '2026-06-24',
    titulo: 'Alta de clientes más rápida',
    resumen: 'Sumar un cliente ahora es directo: cargás sus datos y empieza a seguirse, sin pasos de más.',
    items: [
      {
        tipo: 'mejora',
        texto:
          'Cargás el CUIT y la clave fiscal de tu cliente y queda en seguimiento al instante, sin una pantalla intermedia.',
      },
      {
        tipo: 'mejora',
        texto:
          'Si el cliente representa a otro CUIT (una sociedad, un familiar, etc.), marcás esa opción y elegís a cuáles seguir.',
      },
    ],
  },
  {
    id: '2026-06-23-conciliacion-cierre',
    fecha: '2026-06-23',
    titulo: 'Conciliación bancaria más clara',
    resumen: 'El conciliador ahora cierra con un reporte que no deja dudas de en qué quedó cada cobro.',
    items: [
      {
        tipo: 'mejora',
        texto:
          'Resumen por estado al terminar: conciliados, a confirmar, por facturar, pendientes y descartados, con cantidad e importe de cada uno.',
      },
      {
        tipo: 'mejora',
        texto: 'Filtrá los movimientos por estado con un clic y confirmá de una los cruces sugeridos.',
      },
      {
        tipo: 'mejora',
        texto: 'En cada movimiento ves con qué factura se cruzó y por qué quedó pendiente o descartado.',
      },
    ],
  },
  {
    id: '2026-06-19-avisos-whatsapp',
    fecha: '2026-06-19',
    titulo: 'Avisos por WhatsApp',
    items: [
      {
        tipo: 'nuevo',
        texto: 'Órbita avisa por WhatsApp cuando un cliente se acerca al tope o necesita atención.',
      },
    ],
  },
  {
    id: '2026-06-16-cuenta',
    fecha: '2026-06-16',
    titulo: 'Tu cuenta, más segura',
    items: [
      { tipo: 'mejora', texto: 'Recuperación de contraseña por email.' },
      { tipo: 'mejora', texto: 'Confirmación de la cuenta al registrarte.' },
    ],
  },
  {
    id: '2026-06-12-cartera-estado-cuenta',
    fecha: '2026-06-12',
    titulo: 'Estado de cuenta y mejoras en la cartera',
    items: [
      {
        tipo: 'nuevo',
        texto: 'Estado de cuenta por cliente: deuda, capital, intereses, saldo a favor y movimientos.',
      },
      { tipo: 'mejora', texto: 'Buscá clientes por nombre en la cartera.' },
    ],
  },
  {
    id: '2026-06-01-base',
    fecha: '2026-06-01',
    titulo: 'Lo esencial de Órbita',
    resumen: 'El núcleo del sistema para monitorear tu cartera de monotributistas.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'Panel de cartera con categoría, consumo del tope, próxima recategorización y semáforo de riesgo.',
      },
      { tipo: 'nuevo', texto: 'Conciliación bancaria: cruzá tus extractos con la facturación.' },
      { tipo: 'nuevo', texto: 'Comprobantes emitidos y recibidos, y notas internas por cliente.' },
      { tipo: 'nuevo', texto: 'Papel de trabajo del cliente, exportable a PDF y Excel.' },
    ],
  },
];
