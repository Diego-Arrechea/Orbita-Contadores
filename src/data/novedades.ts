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
    id: '2026-06-29-inflacion-solo-tope',
    fecha: '2026-06-29',
    titulo: 'Ajustado por inflación: ahora cambia solo el tope',
    resumen:
      'En el visor del tope, el modo "Ajustado por inflación" mantiene tu facturación y solo actualiza el tope por inflación.',
    items: [
      {
        tipo: 'mejora',
        texto:
          'Antes, al pasar a "Ajustado por inflación", también cambiaba el monto facturado y se prestaba a confusión. Ahora el facturado queda igual al de los últimos 12 meses y solo se actualiza el tope por la inflación del semestre, así ves de forma directa si te mantenés en tu categoría o la inflación te evita subir.',
      },
    ],
  },
  {
    id: '2026-06-26-aviso-precio-unitario',
    fecha: '2026-06-26',
    titulo: 'Aviso al superar el precio unitario máximo',
    resumen:
      'Al emitir una factura de productos, te avisamos si el importe supera el precio unitario máximo permitido en el monotributo.',
    items: [
      {
        tipo: 'mejora',
        texto:
          'Cuando emitís una factura por venta de productos y el importe supera el precio unitario máximo de venta del monotributo ($613.492), el sistema te lo avisa antes de confirmar. Si es por un solo producto conviene revisarlo; si son varias unidades, podés continuar.',
      },
    ],
  },
  {
    id: '2026-06-26-tope-ajustado-inflacion',
    fecha: '2026-06-26',
    titulo: 'Mirá tu tope ajustado por inflación',
    resumen:
      'En la situación del cliente sumamos un botón para ver cómo quedaría su categoría si los topes se actualizan por inflación.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'En el visor del tope ahora podés cambiar entre "Hoy" y "Ajustado por inflación". En el segundo modo ves la facturación proyectada a 12 meses contra los topes ya actualizados, así sabés si con el ritmo actual te mantenés en tu categoría o conviene anticiparte.',
      },
      {
        tipo: 'mejora',
        texto:
          'La proyección ahora usa por defecto la inflación esperada por el mercado, que se actualiza sola. Igual podés fijar tu propio valor desde Configuración → Alertas si preferís otro escenario.',
      },
    ],
  },
  {
    id: '2026-06-26-relacion-dependencia',
    fecha: '2026-06-26',
    titulo: 'Marcá si tu cliente tiene relación de dependencia',
    resumen:
      'Dejá registrado cuándo un cliente además trabaja en relación de dependencia, para tenerlo en cuenta al revisar sus gastos.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'En Editar cliente ahora podés indicar si el cliente tiene relación de dependencia. Cuando lo marcás, en la situación del cliente aparece un recordatorio de que parte de sus compras pueden quedar justificadas por el haber percibido, aunque figuren a consumidor final.',
      },
    ],
  },
  {
    id: '2026-06-26-facturacion-electronica',
    fecha: '2026-06-26',
    titulo: 'Emití comprobantes de tus clientes desde Órbita',
    resumen:
      'Ya podés emitir Facturas C y Notas de Crédito C de tus clientes monotributistas y descargar el comprobante en PDF.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'Desde la ficha del cliente podés emitir una Factura C o una Nota de Crédito C a su nombre. El comprobante queda autorizado con su CAE y se suma automáticamente al resto de sus comprobantes.',
      },
      {
        tipo: 'nuevo',
        texto:
          'Cada comprobante emitido se descarga en PDF —con el CAE, su vencimiento y el código QR—, listo para entregarle al cliente. Lo bajás al emitirlo o cuando quieras desde la pestaña Comprobantes.',
      },
    ],
  },
  {
    id: '2026-06-26-proyeccion-topes-actualizados',
    fecha: '2026-06-26',
    titulo: 'La proyección de categoría tiene en cuenta la actualización de los topes',
    resumen:
      'La tarjeta "Proyección con inflación" ya no avisa un cambio de categoría que la suba de topes por inflación termina evitando.',
    items: [
      {
        tipo: 'mejora',
        texto:
          'Los topes del monotributo se actualizan por inflación cada semestre. La proyección ahora compara tu facturación proyectada contra los topes YA actualizados (por la inflación acumulada de los últimos 6 meses): si tu ritmo se mantiene, te muestra que te quedás en tu categoría en vez de un "cambio probable" que no iba a pasar.',
      },
    ],
  },
  {
    id: '2026-06-24-avance-alta-en-cartera',
    fecha: '2026-06-24',
    titulo: 'Seguí el avance del alta desde tu cartera',
    resumen: 'Cuando sumás un cliente, lo ves en la lista con su avance y aparece completo apenas está listo.',
    items: [
      {
        tipo: 'mejora',
        texto:
          'El cliente que estás dando de alta se muestra en tu cartera con un recuadro resaltado y una barra que va marcando el avance, así sabés en qué etapa va.',
      },
      {
        tipo: 'mejora',
        texto: 'Apenas termina de prepararse, el cliente queda en la lista con todos sus datos, sin que tengas que refrescar.',
      },
      {
        tipo: 'mejora',
        texto: 'Mientras un alta sigue en curso, podés arrancar la carga del próximo cliente desde la misma pantalla, sin esperar a que termine.',
      },
    ],
  },
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
