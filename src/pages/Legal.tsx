import { Link } from 'react-router-dom';
import { Orbit, ArrowLeft, AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';

const ACTUALIZADO = 'junio de 2026';

/** Marco común de las páginas legales (público, sin sidebar). */
function MarcoLegal({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="min-h-full bg-gradient-to-br from-background via-accent/30 to-background">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Orbit className="h-5 w-5" />
            </div>
            <span className="font-semibold">Órbita</span>
          </Link>
          <Link
            to="/registro"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Volver al registro
          </Link>
        </div>

        <div className="bg-card border border-border/60 rounded-2xl shadow-sm p-8 sm:p-10">
          <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
          <p className="text-sm text-muted-foreground mt-1">Última actualización: {ACTUALIZADO}</p>

          <div className="mt-5 flex items-start gap-2 rounded-lg bg-warning/15 border border-warning/30 px-3.5 py-2.5 text-sm">
            <AlertTriangle className="h-4 w-4 text-warning-foreground shrink-0 mt-0.5" />
            <span className="text-foreground/80">
              Borrador inicial. Este texto es una base orientativa y debe ser revisado por un asesor
              legal antes de usarse en producción.
            </span>
          </div>

          <div className="mt-7 space-y-6 text-sm leading-relaxed text-foreground/80">{children}</div>
        </div>
      </div>
    </div>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-foreground">{titulo}</h2>
      {children}
    </section>
  );
}

export function Terminos() {
  return (
    <MarcoLegal titulo="Términos y Condiciones">
      <p>
        Estos Términos y Condiciones regulan el uso de Órbita ("el Servicio"), una aplicación web de
        gestión para estudios contables y profesionales que asisten a contribuyentes monotributistas
        y responsables inscriptos en Argentina. Al crear una cuenta o utilizar el Servicio, aceptás
        estos términos en su totalidad.
      </p>

      <Seccion titulo="1. Descripción del servicio">
        <p>
          Órbita centraliza el seguimiento de la situación fiscal de los clientes del contador
          (categoría, topes, vencimientos, comprobantes y conciliaciones), sincronizando información
          desde los servicios de ARCA (ex AFIP). La información que ofrece Órbita es de apoyo a la
          gestión profesional y no reemplaza el criterio del contador ni constituye asesoramiento
          fiscal, contable o legal.
        </p>
      </Seccion>

      <Seccion titulo="2. Cuenta y registro">
        <p>
          Para usar Órbita debés registrarte con datos veraces y mantenerlos actualizados. Sos
          responsable de la confidencialidad de tu contraseña y de toda actividad realizada desde tu
          cuenta. Notificá de inmediato cualquier uso no autorizado.
        </p>
      </Seccion>

      <Seccion titulo="3. Credenciales fiscales y representación">
        <p>
          Si cargás credenciales fiscales (clave fiscal de ARCA u otras) para sincronizar datos de
          tus clientes, declarás contar con la autorización de cada cliente para acceder y procesar
          su información fiscal en su representación. Las credenciales se almacenan cifradas y no se
          muestran en ninguna pantalla del sistema.
        </p>
      </Seccion>

      <Seccion titulo="4. Planes, pagos y cancelación">
        <p>
          El acceso al Servicio puede estar sujeto a un plan pago según la cantidad de clientes. Los
          planes no tienen permanencia: podés cancelar cuando quieras y el acceso continúa hasta el
          fin del período abonado. Los precios pueden actualizarse notificándolo con antelación
          razonable.
        </p>
      </Seccion>

      <Seccion titulo="5. Uso aceptable">
        <p>
          Te comprometés a no usar el Servicio para fines ilícitos, a no intentar vulnerar su
          seguridad, ni a acceder a datos de terceros sin autorización. Podemos suspender cuentas que
          incumplan estos términos.
        </p>
      </Seccion>

      <Seccion titulo="6. Propiedad intelectual">
        <p>
          El software, la marca y los contenidos de Órbita son de su titular. No se transfiere ningún
          derecho de propiedad intelectual por el uso del Servicio. Los datos que cargás siguen siendo
          tuyos y de tus clientes.
        </p>
      </Seccion>

      <Seccion titulo="7. Limitación de responsabilidad">
        <p>
          El Servicio se ofrece "tal cual". Hacemos esfuerzos razonables por la exactitud de los datos
          sincronizados desde ARCA, pero no garantizamos que estén libres de errores ni que ARCA esté
          siempre disponible. La decisión final sobre categorías, recategorizaciones, vencimientos y
          presentaciones es responsabilidad del profesional, que debe verificarla en los canales
          oficiales. En la máxima medida permitida por la ley, no respondemos por daños indirectos o
          lucro cesante derivados del uso del Servicio.
        </p>
      </Seccion>

      <Seccion titulo="8. Protección de datos">
        <p>
          El tratamiento de datos personales se rige por nuestra{' '}
          <Link to="/privacidad" className="text-primary hover:underline">
            Política de Privacidad
          </Link>
          .
        </p>
      </Seccion>

      <Seccion titulo="9. Modificaciones">
        <p>
          Podemos actualizar estos términos. Te avisaremos los cambios relevantes y, al seguir usando
          el Servicio, se considerarán aceptados.
        </p>
      </Seccion>

      <Seccion titulo="10. Ley aplicable y jurisdicción">
        <p>
          Estos términos se rigen por las leyes de la República Argentina. Cualquier controversia se
          someterá a los tribunales ordinarios competentes que correspondan.
        </p>
      </Seccion>

      <Seccion titulo="11. Contacto">
        <p>Por consultas sobre estos términos, escribinos a orbitaglobalclientes@gmail.com.</p>
      </Seccion>
    </MarcoLegal>
  );
}

export function Privacidad() {
  return (
    <MarcoLegal titulo="Política de Privacidad">
      <p>
        Esta Política explica qué datos tratamos en Órbita, con qué fines y cuáles son tus derechos.
        Cumplimos con la Ley N.º 25.326 de Protección de los Datos Personales de Argentina y la
        normativa de la Agencia de Acceso a la Información Pública (AAIP).
      </p>

      <Seccion titulo="1. Datos que recopilamos">
        <p>
          <strong>Del contador (usuario):</strong> nombre y apellido, correo, teléfono, DNI, CUIT,
          nombre del estudio y matrícula. <br />
          <strong>De los clientes del contador:</strong> CUIT, datos de su situación fiscal,
          comprobantes emitidos/recibidos y movimientos que cargues o sincronices para su seguimiento.
        </p>
      </Seccion>

      <Seccion titulo="2. Cómo usamos los datos">
        <p>
          Usamos los datos para prestar el Servicio: autenticarte, sincronizar información desde ARCA,
          calcular categorías y vencimientos, generar reportes y enviarte avisos. No vendemos tus
          datos ni los de tus clientes.
        </p>
      </Seccion>

      <Seccion titulo="3. Credenciales fiscales">
        <p>
          Las claves fiscales y certificados se almacenan cifrados (cifrado simétrico) y se usan
          únicamente para sincronizar los datos de los clientes que el contador administra. Nunca se
          muestran en pantalla.
        </p>
      </Seccion>

      <Seccion titulo="4. Con quién se comparten">
        <p>
          Interactuamos con los servicios de ARCA para obtener la información fiscal. Podemos usar
          proveedores de infraestructura (hosting) y de mensajería para operar el Servicio, sujetos a
          obligaciones de confidencialidad. No compartimos datos con terceros para fines publicitarios.
        </p>
      </Seccion>

      <Seccion titulo="5. Conservación">
        <p>
          Conservamos los datos mientras tu cuenta esté activa y durante los plazos legales aplicables.
          Si cerrás tu cuenta, eliminamos o anonimizamos los datos que no debamos conservar por ley.
        </p>
      </Seccion>

      <Seccion titulo="6. Seguridad">
        <p>
          Aplicamos medidas técnicas y organizativas razonables para proteger la información
          (cifrado de credenciales, control de acceso por cuenta, contraseñas con hash). Ningún
          sistema es 100% infalible, pero trabajamos para minimizar los riesgos.
        </p>
      </Seccion>

      <Seccion titulo="7. Tus derechos">
        <p>
          Como titular de los datos podés ejercer los derechos de acceso, rectificación, actualización
          y supresión. La AAIP, órgano de control de la Ley 25.326, tiene la atribución de atender
          denuncias y reclamos. Para ejercer tus derechos, escribinos al contacto de abajo.
        </p>
      </Seccion>

      <Seccion titulo="8. Cookies">
        <p>
          Usamos almacenamiento local del navegador para mantener tu sesión iniciada. Si integramos
          herramientas de soporte o analítica, lo haremos minimizando los datos recolectados.
        </p>
      </Seccion>

      <Seccion titulo="9. Cambios">
        <p>
          Podemos actualizar esta Política. Publicaremos la versión vigente con su fecha de última
          actualización.
        </p>
      </Seccion>

      <Seccion titulo="10. Contacto">
        <p>
          Por consultas sobre privacidad o para ejercer tus derechos, escribinos a privacidad@orbita
          (completar correo oficial).
        </p>
      </Seccion>
    </MarcoLegal>
  );
}
