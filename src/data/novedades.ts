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
    id: '2026-07-17-ventana-recategorizacion',
    fecha: '2026-07-17',
    titulo: 'Evaluá la recategorización por período',
    resumen: 'Elegí el período de 12 meses para evaluar la recategorización, no sólo los últimos 12.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'En Situación actual, el bloque de recategorización ahora te deja elegir el período: el ' +
          'semestre de recategorización (por ejemplo julio 2025 a junio 2026), los últimos 12 meses, ' +
          'o cualquier mes de cierre. Te muestra el facturado de ese período y la categoría que ' +
          'corresponde.',
      },
    ],
  },
  {
    id: '2026-07-17-constancia-inscripcion',
    fecha: '2026-07-17',
    titulo: 'Constancia de inscripción al instante',
    resumen: 'Abrí la constancia de inscripción de cualquier cliente desde su ficha, lista para imprimir.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'En la ficha del cliente, en el menú de acciones (⋮), sumamos "Constancia de inscripción": ' +
          'te abre la constancia oficial vigente del cliente, lista para imprimir o guardar en PDF, ' +
          'sin tener que salir de Órbita.',
      },
    ],
  },
  {
    id: '2026-07-17-totales-por-punto-de-venta',
    fecha: '2026-07-17',
    titulo: 'Totales por punto de venta',
    resumen: 'Cuánto facturó cada punto de venta en los últimos 12 meses, de un vistazo.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'En la solapa Facturación 12m, cuando el cliente factura desde más de un punto de venta, ' +
          'ahora ves el facturado neto discriminado por cada punto de venta.',
      },
    ],
  },
  {
    id: '2026-07-17-actividades-declaradas',
    fecha: '2026-07-17',
    titulo: 'Actividades declaradas del cliente',
    resumen: 'Mirá de un vistazo las actividades económicas de cada cliente en su ficha.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'En la ficha del cliente, dentro de Situación actual, ahora ves las actividades económicas ' +
          'declaradas (código y descripción), con la actividad principal destacada.',
      },
    ],
  },
  {
    id: '2026-07-17-comprobantes-a-mano',
    fecha: '2026-07-17',
    titulo: 'Cargá comprobantes a mano',
    resumen:
      'Sumá las ventas de talonario y los gastos que no figuran entre los comprobantes del cliente.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'En la solapa Comprobantes de cada cliente podés agregar a mano una venta (por ejemplo una ' +
          'factura de talonario en papel) o una compra/gasto (como un ticket) que no aparece entre sus ' +
          'comprobantes.',
      },
      {
        tipo: 'nuevo',
        texto:
          'Las ventas que cargás a mano suman al facturado de los últimos 12 meses y se tienen en cuenta ' +
          'para la categoría y la recategorización.',
      },
      {
        tipo: 'mejora',
        texto:
          'Los comprobantes cargados a mano quedan identificados con una etiqueta y los podés borrar ' +
          'cuando quieras.',
      },
    ],
  },
  {
    id: '2026-07-13-carga-mas-rapida',
    fecha: '2026-07-13',
    titulo: 'La app carga mucho más rápido',
    resumen: 'Optimizamos cómo se arma tu cartera: la lista de clientes y la ficha abren al toque.',
    items: [
      {
        tipo: 'mejora',
        texto:
          'La lista de clientes (Dashboard, Alertas, Conciliación) carga mucho más rápido, ' +
          'incluso con carteras grandes.',
      },
      {
        tipo: 'mejora',
        texto:
          'La ficha del cliente abre al instante con los datos de la lista y completa el ' +
          'detalle de comprobantes enseguida.',
      },
    ],
  },
  {
    id: '2026-07-13-gestion-de-usuarios',
    fecha: '2026-07-13',
    titulo: 'Gestión de usuarios: sumá a tu equipo y repartí la cartera',
    resumen:
      'Creá cuentas para las personas de tu estudio, asignales clientes y decidí qué puede ' +
      'hacer cada una.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'Nueva sección "Gestión de usuarios": cada persona de tu equipo entra con su propia ' +
          'cuenta y ve únicamente los clientes que le asignes.',
      },
      {
        tipo: 'nuevo',
        texto:
          'Permisos por usuario: habilitá o bloqueá dar de alta clientes, editarlos, eliminarlos, ' +
          'actualizar claves fiscales, emitir comprobantes, conciliar extractos y abrir ' +
          'comunicaciones fiscales.',
      },
      {
        tipo: 'nuevo',
        texto:
          'Elegí el responsable de cada monotributista y vélo en tu cartera ("A cargo de"); vos ' +
          'seguís viendo los clientes de todo el estudio.',
      },
    ],
  },
  {
    id: '2026-07-13-relacion-dependencia-remuneracion',
    fecha: '2026-07-13',
    titulo: 'Clientes en relación de dependencia: ahora traemos su remuneración',
    resumen:
      'Para los clientes que además trabajan en relación de dependencia, mostramos el sueldo ' +
      'informado y cuánto de sus compras queda respaldado.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'Detectamos solos qué clientes tienen relación de dependencia, sin que tengas que marcarlo ' +
          'cliente por cliente.',
      },
      {
        tipo: 'nuevo',
        texto:
          'En la ficha del cliente ves el empleador y la remuneración de los últimos 12 meses, y te ' +
          'calculamos qué parte de las compras a consumidor final queda justificada por el haber ' +
          'percibido y qué parte todavía no.',
      },
    ],
  },
  {
    id: '2026-07-13-regimen-y-recategorizacion',
    fecha: '2026-07-13',
    titulo: 'Régimen de cada cliente más preciso y ventana de recategorización siempre al día',
    items: [
      {
        tipo: 'mejora',
        texto:
          'Identificamos con más precisión el régimen de cada cliente —Monotributo o Responsable ' +
          'Inscripto—, incluso antes de tener todo su historial. Menos clientes quedan como "sin ' +
          'determinar" o mal clasificados.',
      },
      {
        tipo: 'mejora',
        texto:
          'Las fechas de la ventana de recategorización toman el calendario oficial vigente de cada ' +
          'cliente, así el aviso de "se viene la recategorización" queda siempre con la fecha correcta, ' +
          'aunque se prorrogue.',
      },
    ],
  },
  {
    id: '2026-07-13-monotributistas-nuevo-registro',
    fecha: '2026-07-13',
    titulo: 'Monotributistas que antes figuraban fuera del régimen ahora se reconocen bien',
    items: [
      {
        tipo: 'arreglo',
        texto:
          'Algunos monotributistas aparecían por error como "no monotributista" y, con eso, no se ' +
          'mostraba su estado de cuenta. Ahora se los identifica correctamente y se trae su deuda de ' +
          'cuota, incluso los meses adeudados.',
      },
      {
        tipo: 'arreglo',
        texto:
          'Cuando la información de un cliente recién agregado todavía no está disponible, su ficha ya ' +
          'no dice "no monotributista": muestra "Datos en proceso" y, si hace falta corregir la clave ' +
          'fiscal, te lo indica.',
      },
    ],
  },
  {
    id: '2026-07-08-clave-fiscal-reintento-instantaneo',
    fecha: '2026-07-08',
    titulo: 'Al actualizar la clave fiscal, la información se vuelve a traer al instante',
    items: [
      {
        tipo: 'mejora',
        texto:
          'Cuando corregís la clave fiscal de un cliente, volvemos a traer su información en el acto para confirmar que quedó al día, sin tener que esperar a la próxima actualización.',
      },
    ],
  },
  {
    id: '2026-07-07-facturacion-agropecuaria-editar',
    fecha: '2026-07-07',
    titulo: 'Marcá la facturación agropecuaria desde la ficha del cliente',
    resumen: 'Ahora podés activarla en un cliente ya cargado, sin tener que darlo de alta de nuevo.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'En "Editar cliente" sumamos la opción de facturación agropecuaria: activala en los clientes del sector (hacienda, campo, etc.) y su facturación del sector se suma a la del cliente.',
      },
      {
        tipo: 'mejora',
        texto:
          'En la lista de clientes ahora aparece un ícono junto al nombre de los que son del sector agropecuario, para identificarlos de un vistazo.',
      },
    ],
  },
  {
    id: '2026-07-06-aviso-claves-a-actualizar',
    fecha: '2026-07-06',
    titulo: 'Aviso al entrar: clientes con la Clave Fiscal a actualizar',
    resumen:
      'Ni bien abrís tu cartera ves, en un aviso destacado, cuántos clientes necesitan que actualices su Clave Fiscal.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'Arriba de tu cartera aparece un aviso con la cantidad de clientes cuya Clave Fiscal hay que actualizar. Tocándolo, la lista se filtra para mostrarte sólo esos clientes; volvés a tocarlo para ver todos otra vez.',
      },
      {
        tipo: 'mejora',
        texto:
          'Mientras un cliente tenga la Clave Fiscal pendiente de actualizar, su información deja de intentar ponerse al día hasta que cargues la clave correcta desde su ficha. Así el aviso siempre refleja lo que hay que resolver.',
      },
    ],
  },
  {
    id: '2026-07-04-activar-desactivar-cliente',
    fecha: '2026-07-04',
    titulo: 'Activá o desactivá el monitoreo de un cliente',
    resumen:
      'Podés pausar el seguimiento de un cliente cuando no lo necesites y volver a activarlo cuando quieras, sin perder sus datos.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'Desde la ficha del cliente, en la ruedita de opciones, ahora podés desactivarlo: deja de actualizarse su información y en tu cartera aparece atenuado con la etiqueta "Desactivado". Cuando quieras, lo volvés a activar desde el mismo lugar.',
      },
      {
        tipo: 'nuevo',
        texto:
          'En la lista de clientes sumamos un filtro para ver todos, sólo los activos o sólo los desactivados.',
      },
    ],
  },
  {
    id: '2026-07-04-facturacion-agropecuaria',
    fecha: '2026-07-04',
    titulo: 'Facturación agropecuaria de tus clientes',
    resumen:
      'Si un cliente factura por el sector agropecuario, ahora sumamos sus liquidaciones (hacienda, etc.) a su facturación, junto al resto de sus comprobantes.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'Para los clientes del sector agropecuario traemos sus liquidaciones (venta de hacienda, etc.): las ves en su propio apartado "Facturación agropecuaria" dentro de la ficha, y se suman a su facturación de los últimos 12 meses.',
      },
      {
        tipo: 'nuevo',
        texto:
          'Al dar de alta un cliente sumamos una ruedita de opciones (arriba a la derecha del recuadro): desde ahí indicás que el cliente es agropecuario, o que representa a otro CUIT. Si no lo marcás, igual lo detectamos solos con el tiempo.',
      },
    ],
  },
  {
    id: '2026-07-04-reporte-personalizable',
    fecha: '2026-07-04',
    titulo: 'Armá el reporte del cliente a tu manera',
    resumen:
      'Ahora elegís qué secciones incluir, cuánto historial mostrar y podés sumar tus propias observaciones antes de imprimir o guardar el PDF.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'En el reporte del cliente sumamos un panel para personalizarlo: elegís qué secciones mostrar (situación, historial, alertas, movimientos pendientes, acciones sugeridas) y cuántos meses de historial incluir. Esa preferencia queda guardada para tus próximos reportes.',
      },
      {
        tipo: 'nuevo',
        texto:
          'Podés escribir observaciones propias que aparecen destacadas al principio del reporte. Son de ese reporte puntual, ideales para dejar una nota o comentario para el cliente antes de imprimirlo o guardarlo como PDF.',
      },
    ],
  },
  {
    id: '2026-07-04-deudores-cronicos-panel',
    fecha: '2026-07-04',
    titulo: 'Encontrá a los deudores crónicos de un vistazo',
    resumen:
      'El panel ahora te muestra cuántos clientes arrastran deuda de varios meses, y podés filtrar y ordenar la cartera por eso.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'En el panel sumamos una tarjeta "Deuda +N meses" con la cantidad de clientes que vienen adeudando la cuota desde hace varios meses seguidos (el límite es el mismo que configurás en tus alertas). Tocala para ver sólo esos clientes.',
      },
      {
        tipo: 'nuevo',
        texto:
          'La lista de clientes tiene una columna nueva, "Meses adeud.", que podés ordenar para que los que más deben queden arriba. Los que superan tu límite se resaltan.',
      },
      {
        tipo: 'mejora',
        texto:
          'El reporte imprimible del cliente ahora incluye de cuántos meses seguidos es la deuda, y la acción sugerida lo aclara cuando el atraso viene de arrastre.',
      },
    ],
  },
  {
    id: '2026-07-04-montos-categorias-al-dia',
    fecha: '2026-07-04',
    titulo: 'Los montos de las categorías se mantienen al día solos',
    resumen:
      'Las cuotas y los topes de cada categoría del monotributo se actualizan automáticamente con la escala oficial vigente.',
    items: [
      {
        tipo: 'mejora',
        texto:
          'Cada vez que se actualiza la escala oficial del monotributo (cuotas, topes de facturación, alquileres y precio unitario por categoría), Órbita toma los valores nuevos automáticamente. Así los montos que ves en las fichas, el panel y los reportes quedan siempre alineados con lo vigente, sin que haya que cargarlos a mano.',
      },
    ],
  },
  {
    id: '2026-07-04-meses-adeudados',
    fecha: '2026-07-04',
    titulo: 'Cuántos meses seguidos adeuda cada cliente',
    resumen:
      'En la ficha del cliente, junto a la cuota del mes, ahora ves cuántos meses seguidos acumula de deuda, y podés recibir una alerta cuando pasa cierto límite.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'Si un cliente tiene la cuota con deuda, al lado te mostramos de cuántos meses seguidos es esa deuda. Así distinguís de un vistazo al que se atrasó un mes del que viene arrastrando la cuota desde hace tiempo.',
      },
      {
        tipo: 'nuevo',
        texto:
          'Es también un nuevo tipo de alerta: te avisamos cuando un cliente supera cierta cantidad de meses seguidos adeudando. Viene configurada en 8 meses por defecto, pero podés cambiar ese número (y cada cuántos meses más querés que te recordemos) desde Configuración › Alertas.',
      },
    ],
  },
  {
    id: '2026-07-03-aviso-clave-fiscal-a-revisar',
    fecha: '2026-07-03',
    titulo: 'Te avisamos cuando la clave fiscal de un cliente hay que revisarla',
    resumen:
      'Si no podemos acceder a la información de un cliente porque su clave fiscal no es válida, ahora lo ves marcado en la lista.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'Cuando la clave fiscal guardada de un cliente deja de servir (porque el cliente la cambió o quedó mal cargada), su información no se puede mantener actualizada. Ahora lo marcamos con un aviso en la lista de clientes ("Revisá su Clave Fiscal") para que la corrijas. Actualizás la clave desde la ficha del cliente y, en cuanto vuelve a funcionar, el aviso desaparece solo.',
      },
    ],
  },
  {
    id: '2026-07-02-actualizar-clave-fiscal',
    fecha: '2026-07-02',
    titulo: 'Actualizá la clave fiscal de un cliente desde su ficha',
    resumen:
      'Si un cliente cambia su clave fiscal, ahora la actualizás vos mismo y su información vuelve a mantenerse al día.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'Cuando un cliente cambia su clave fiscal, entrá a su ficha, abrí el menú (los tres puntos, arriba a la derecha) y elegí "Actualizar clave fiscal". Cargás la nueva clave y listo: su información vuelve a mantenerse al día, sin tener que darlo de alta otra vez.',
      },
    ],
  },
  {
    id: '2026-07-01-domicilio-fiscal-electronico',
    fecha: '2026-07-01',
    titulo: 'Domicilio Fiscal Electrónico: las comunicaciones de cada cliente, adentro de Órbita',
    resumen:
      'Mirá las comunicaciones oficiales de tus clientes sin salir de la ficha, con un aviso cuando hay alguna sin leer.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'Cada cliente tiene ahora una solapa "Domicilio Fiscal Electrónico" donde ves las comunicaciones oficiales que recibe. Un punto rojo te marca cuáles todavía no abriste, así no se te pasa ninguna. Al abrir una, se muestra el mensaje completo y queda marcada como leída. Funciona tanto para el titular como para los clientes que representa.',
      },
    ],
  },
  {
    id: '2026-07-01-aviso-cambio-clave-fiscal',
    fecha: '2026-07-01',
    titulo: 'Te avisamos cuando un cliente tiene que cambiar su Clave Fiscal',
    resumen:
      'Si a un cliente le piden cambiar su Clave Fiscal, ahora lo ves marcado en la lista de clientes.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'Cada tanto, AFIP obliga a renovar la Clave Fiscal por seguridad. Mientras eso no se hace, la información de ese cliente no se puede mantener actualizada. Ahora, cuando pasa, lo marcamos con un aviso en la lista de clientes ("Debe cambiar su Clave Fiscal") para que le avises al cliente. En cuanto la renueva, el aviso desaparece solo y la información vuelve a actualizarse.',
      },
    ],
  },
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
