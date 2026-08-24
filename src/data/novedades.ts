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
    id: '2026-08-24-iva-contabilidad-suscripcion',
    fecha: '2026-08-24',
    titulo: 'IVA y Contabilidad, para todos',
    resumen: 'Se habilitan los apartados de IVA y de Contabilidad en todas las cuentas.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'IVA: en el menú vas a encontrar el apartado de IVA, con el libro de compras y ventas de cada cliente armado a partir de sus comprobantes, la posición del período y la exportación para presentar. Antes lo estaban probando algunos estudios; ahora está en todas las cuentas.',
      },
      {
        tipo: 'nuevo',
        texto:
          'Contabilidad: el libro diario se arma solo con los comprobantes y los movimientos del extracto, y podés imputar cada uno a la cuenta que quieras, cargar asientos a mano, ver el mayor, las sumas y saldos, y cerrar el período para obtener los estados contables. Cada número te muestra de dónde sale y quién decidió que fuera así.',
      },
    ],
  },
  {
    id: '2026-08-24-puntos-de-venta-con-nombre',
    fecha: '2026-08-24',
    titulo: 'Los puntos de venta, con nombre',
    resumen: 'Cada punto de venta se muestra con su nombre además del número, y podés cambiárselo.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'Donde antes veías "00002" ahora ves también el nombre del punto de venta, el que el cliente tiene registrado. Aparece en la solapa Facturación 12m y en el Histórico mensual, incluida la referencia del gráfico, así reconocés de un vistazo qué local o actividad facturó cada peso.',
      },
      {
        tipo: 'nuevo',
        texto:
          'Podés ponerle a cada punto de venta el nombre que te sirva a vos: en Facturación 12m, tocá el lápiz al lado del nombre y escribí, por ejemplo, "Local Centro" o "Sucursal Norte". Ese nombre queda guardado en tu cuenta y se usa en todas las vistas del cliente. Si lo borrás, vuelve el nombre registrado.',
      },
      {
        tipo: 'mejora',
        texto:
          'Junto a cada punto de venta también te mostramos con qué sistema emite y de qué régimen es (Factura en Línea · Monotributo, Imprenta · RI, Web Services, contingencia…). Es lo que te permite distinguir dos puntos que se llaman igual, y aparece tanto en las tablas como en la referencia y el detalle del gráfico del Histórico mensual.',
      },
      {
        tipo: 'mejora',
        texto:
          'En el gráfico del Histórico, al pasar por encima de un mes ahora ves sólo los puntos de venta que facturaron —con su total—, en vez de la lista completa con ceros.',
      },
    ],
  },
  {
    id: '2026-08-20-puntos-de-venta-mes-a-mes',
    fecha: '2026-08-20',
    titulo: 'Puntos de venta, período a período',
    resumen:
      'Además del total, ahora ves cuánto facturó cada punto de venta en cada mes (y en cada año).',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'En la solapa Facturación 12m, el bloque de puntos de venta suma la vista "Mes a mes": una grilla con los últimos 12 meses y el facturado neto de cada punto de venta en cada uno, con el total de cada mes y el de cada punto. Sirve para ver de dónde viene la facturación y detectar un local o sucursal que arrancó o dejó de facturar.',
      },
      {
        tipo: 'nuevo',
        texto:
          'En la solapa Histórico mensual, cuando el cliente factura desde más de un punto de venta aparece la vista "Puntos de venta": el gráfico muestra cada período dividido por punto —con su color—, y la tabla de abajo trae una columna por punto más el total. Funciona con todos los rangos, así que podés seguir la evolución de cada punto a 12 o 24 meses, a 5 años o desde el principio, y también en pesos de hoy.',
      },
      {
        tipo: 'mejora',
        texto:
          'Las vistas de siempre no cambian: pasás de una a otra con un clic. Como siempre, las notas de crédito restan.',
      },
    ],
  },
  {
    id: '2026-08-17-contacto-de-clientes-automatico',
    fecha: '2026-08-17',
    titulo: 'El mail de contacto de tus clientes ya viene cargado',
    resumen:
      'Para mandarles el recordatorio de vencimiento ya no hace falta que cargues los contactos a mano.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'El mail de contacto de tus clientes aparece completo en la ficha, sin que tengas que cargarlo. Es el que cada cliente tiene registrado como contacto, y es el que usamos para el recordatorio mensual de vencimiento.',
      },
      {
        tipo: 'nuevo',
        texto:
          'Cuando el mail registrado es el del estudio y no el del cliente —pasa seguido, porque los trámites los hacés vos—, lo dejamos vacío en vez de completarlo mal: así el recordatorio del vencimiento nunca termina en tu propia casilla. Esos clientes los podés completar a mano en la ficha o con el import por Excel, como hasta ahora.',
      },
      {
        tipo: 'mejora',
        texto:
          'Si vos cargás o corregís el mail de un cliente, ese dato queda tuyo: no lo pisamos ni lo volvemos a cambiar.',
      },
    ],
  },
  {
    id: '2026-08-10-aviso-domicilio-fiscal-electronico',
    fecha: '2026-08-12',
    titulo: 'Te avisamos cuando le entra una comunicación al Domicilio Fiscal Electrónico',
    resumen:
      'Ya no hace falta entrar a mirar cliente por cliente: la comunicación nueva te busca a vos.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'Cuando a un cliente le entra una comunicación nueva en su Domicilio Fiscal Electrónico, aparece como alerta en el centro de alertas y en la campanita del header, y el cliente queda marcado en el semáforo. La alerta te lleva directo a la solapa donde leerla, y se resuelve sola apenas la abrís.',
      },
      {
        tipo: 'nuevo',
        texto:
          'Si tenés activado el aviso por WhatsApp, también te llega por ahí (una sola vez por comunicación, y de nuevo si entran más). Podés prenderlo o apagarlo desde Configuración → Alertas, junto al resto de los avisos.',
      },
    ],
  },
  {
    id: '2026-08-04-importes-con-centavos',
    fecha: '2026-08-12',
    titulo: 'Importes con centavos en la facturación',
    resumen:
      'Para que el facturado del período cierre exacto a la hora de recategorizar.',
    items: [
      {
        tipo: 'arreglo',
        texto:
          'Los importes de facturación se mostraban redondeados al peso, y al sumar comprobante por comprobante aparecían pequeñas diferencias al cotejar el total. Ahora se muestran con centavos: el facturado de los últimos 12 meses, el de cada semestre de la recategorización, el histórico mensual y el detalle de comprobantes.',
      },
    ],
  },
  {
    id: '2026-08-04-liquidaciones-agro-actualizacion',
    fecha: '2026-08-04',
    titulo: 'Liquidaciones del agro más al día',
    resumen:
      'Mejoramos la actualización de las liquidaciones del sector pecuario de tus clientes productores.',
    items: [
      {
        tipo: 'arreglo',
        texto:
          'Las liquidaciones nuevas de tus clientes agropecuarios se incorporan de forma más pareja: antes podían demorar varios días en aparecer y sumarse a la facturación.',
      },
      {
        tipo: 'mejora',
        texto:
          'Las liquidaciones que habían quedado cargadas sin su importe se completan solas, así el facturado del cliente deja de quedar por debajo del real.',
      },
    ],
  },
  {
    id: '2026-08-04-facturacion-historica',
    fecha: '2026-08-04',
    titulo: 'Facturación histórica por año, ajustada por inflación',
    resumen:
      'En la ficha del cliente ya podés ver la facturación de varios años, no sólo los últimos 12 meses.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'El histórico del cliente ahora tiene un selector de rango (12 meses, 24 meses, 5 años o todo el período): elegís cuánto hacia atrás querés ver.',
      },
      {
        tipo: 'nuevo',
        texto:
          'Podés expresar los importes en "pesos de hoy" (ajustados por inflación) para comparar años entre sí con sentido; en rangos largos el histórico se muestra por año.',
      },
    ],
  },
  {
    id: '2026-07-27-aviso-verificacion-dos-pasos',
    fecha: '2026-07-27',
    titulo: 'Avisamos cuando un cliente tiene la verificación en dos pasos activada',
    resumen: 'Si no podemos actualizar sus datos por eso, ahora lo ves claro en la lista.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'Cuando un cliente activa la verificación en dos pasos (token de seguridad) en su Clave Fiscal, su información no se puede actualizar hasta que la desactive. Ahora aparece un aviso "Verificación en dos pasos" en su fila para que sepas por qué y le avises. Antes ese caso figuraba, por error, como un problema de clave.',
      },
    ],
  },
  {
    id: '2026-07-23-recat-dos-semestres',
    fecha: '2026-07-23',
    titulo: 'Recategorización: los dos semestres y el total anual',
    resumen: 'El cuadro de recategorización ahora abre el año en sus dos semestres para controlar mejor.',
    items: [
      {
        tipo: 'mejora',
        texto:
          'En la Situación actual del cliente, el cuadro de recategorización muestra el facturado de cada semestre por separado y el total anual, con la categoría que le corresponde. Así podés controlar cada mitad del año de un vistazo antes de mirar comprobante por comprobante.',
      },
    ],
  },
  {
    id: '2026-07-22-recordatorios-vencimiento',
    fecha: '2026-07-22',
    titulo: 'Recordatorios de vencimiento automáticos para tus clientes',
    resumen:
      'Órbita puede avisarle por mail a cada cliente cuándo vence su cuota, a principio de cada mes. Vos lo activás una vez.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'A principio de cada mes le enviamos por mail a cada cliente el recordatorio de su próximo ' +
          'vencimiento de monotributo, con la fecha y —si lo tenemos al día— el importe a pagar. Te ' +
          'ahorra el recordatorio manual uno por uno, y el mail sale a nombre de tu estudio.',
      },
      {
        tipo: 'nuevo',
        texto:
          'Cómo activarlo, en 3 pasos: (1) Cargá el email de tus clientes: en "Mi cartera" te aparece ' +
          'un aviso para descargar una planilla con tu cartera, completar los mails y volver a subirla ' +
          '—también podés cargarlo en la ficha de cada cliente. (2) Entrá a Configuración → ' +
          'Vencimientos y activá "Enviar recordatorios automáticamente". (3) ¡Listo! En esa misma ' +
          'pantalla ves a quién le llega este mes y podés apagar el aviso de cualquier cliente con su ' +
          'interruptor.',
      },
    ],
  },
  {
    id: '2026-07-22-planes-de-facilidades',
    fecha: '2026-07-22',
    titulo: 'Planes de facilidades de pago del cliente',
    resumen: 'Mirá los planes de facilidades de cada cliente y si alguno caducó, desde su ficha.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'Si un cliente tiene planes de facilidades de pago, ahora aparece la solapa "Planes de ' +
          'facilidades" en su ficha, con cada plan y su situación (vigente, caduco o cancelado).',
      },
      {
        tipo: 'nuevo',
        texto:
          'En Situación actual te avisamos cuando un cliente tiene planes caducos, para que sepas que ' +
          'la deuda financiada volvió a estar activa.',
      },
    ],
  },
  {
    id: '2026-07-21-regimen-controlador-fiscal',
    fecha: '2026-07-21',
    titulo: 'Régimen más preciso para quien emite con controlador fiscal',
    resumen:
      'Algunos monotributistas que facturan con controlador fiscal podían figurar como Responsables Inscriptos. Ya se muestran bien.',
    items: [
      {
        tipo: 'arreglo',
        texto:
          'Afinamos la detección del régimen: un monotributista que emite tiques con controlador ' +
          'fiscal ya no aparece como Responsable Inscripto. Vuelven a mostrarse su categoría, el ' +
          'facturómetro y las alertas de monotributo para esos clientes.',
      },
    ],
  },
  {
    id: '2026-07-21-facturar-por-items',
    fecha: '2026-07-21',
    titulo: 'Facturá con el detalle de ítems',
    resumen: 'Al emitir un comprobante ahora podés desglosar productos y servicios renglón por renglón.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'En la pantalla de emisión, tocá "Detallar por ítem" para cargar varios renglones con ' +
          'descripción, cantidad y precio unitario. El importe total se calcula solo y cada ítem ' +
          'aparece en el comprobante impreso.',
      },
      {
        tipo: 'mejora',
        texto:
          'Si preferís lo de siempre, seguís cargando un único importe total con un clic: el detalle es opcional.',
      },
    ],
  },
  {
    id: '2026-07-17-ver-clave-guardada',
    fecha: '2026-07-17',
    titulo: 'Recuperá la clave fiscal que tenías cargada',
    resumen: 'Cuando la clave de un cliente deja de funcionar, mostramos la que tenías guardada.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'Si la clave fiscal de un cliente deja de funcionar (o le pidieron cambiarla), al abrir ' +
          '"Actualizar clave fiscal" ahora ves la que tenías guardada, para usarla de referencia al ' +
          'cargar la nueva.',
      },
    ],
  },
  {
    id: '2026-07-17-ventana-recategorizacion',
    fecha: '2026-07-17',
    titulo: 'Evaluá la recategorización por semestre',
    resumen: 'Elegí el semestre a evaluar para la recategorización, no sólo los últimos 12 meses.',
    items: [
      {
        tipo: 'nuevo',
        texto:
          'En Configuración → Ventanas elegís el semestre de recategorización a evaluar (por ejemplo ' +
          'Enero–Junio 2026, que mira julio 2025 a junio 2026). En la ficha de cada cliente, el bloque ' +
          'de recategorización muestra el facturado de ese período y la categoría que corresponde.',
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
