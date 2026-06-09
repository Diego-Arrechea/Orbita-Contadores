import { useEffect, useState } from 'react';
import { Crisp } from 'crisp-sdk-web';
import { usuarioActual } from '@/lib/cuenta';

/**
 * Widget de soporte (Crisp).
 *
 * El contador escribe desde la burbuja y el mensaje llega al inbox de Crisp (panel web + apps
 * móviles), desde donde el equipo de Órbita responde. No requiere backend: Crisp hostea toda la
 * infraestructura de tiempo real.
 *
 * Identifica al contador LOGUEADO (sesión real, src/lib/cuenta.ts) con sus datos reales, así en el
 * inbox se sabe con qué estudio se habla y coincide con el contacto del CRM que crea el backend al
 * registrarse (ver backend/app/services/crisp.py). El widget vive dentro de AppLayout (detrás de
 * RequireAuth), por lo que cuando se monta SIEMPRE hay un usuario en sesión.
 *
 * Para activarlo, configurá el ID en .env.local:
 *   VITE_CRISP_WEBSITE_ID=tu-website-id
 * (se obtiene en https://app.crisp.chat → Settings → Website Settings → Setup)
 *
 * Sin ese ID el componente no hace nada, así que el prototipo sigue corriendo igual.
 */

const WEBSITE_ID = import.meta.env.VITE_CRISP_WEBSITE_ID;

// Crisp.configure() inicializa el SDK: corre una sola vez por carga de página (también evita el
// doble montaje de React.StrictMode en dev). La identidad sí se re-aplica si cambia el usuario.
let configurado = false;

export function SoporteChat() {
  const usuario = usuarioActual();
  const email = usuario?.email ?? '';
  const nombre = usuario ? `${usuario.nombre} ${usuario.apellido}`.trim() : '';
  const estudio = usuario?.estudio ?? '';
  const cuit = usuario?.cuit ?? '';
  const telefono = usuario?.telefono ?? '';

  useEffect(() => {
    if (!WEBSITE_ID || !email) return;

    if (!configurado) {
      Crisp.configure(WEBSITE_ID);
      configurado = true;
    }

    // Identidad real del contador: el inbox sabe quién escribe y matchea el contacto del CRM.
    Crisp.user.setNickname(nombre);
    Crisp.user.setEmail(email);
    if (telefono) Crisp.user.setPhone(telefono);

    // Clasifica la conversación (separar soporte de mejoras) y adjunta datos del estudio.
    Crisp.session.setSegments(['contador', 'orbita-app'], false);
    Crisp.session.setData({ estudio, cuit, origen: 'app-orbita' });

    // Saludo proactivo (una vez por sesión): aparece como burbuja al lado del ícono aunque el chat
    // esté cerrado, para que se entienda que es un canal directo con el equipo (consultas/errores),
    // no un bot. showText() lo muestra local —como si lo escribiera un operador— sin crear convo.
    if (!sessionStorage.getItem('orbita_saludo_chat')) {
      Crisp.message.showText(
        '¡Hola! 👋 Este chat es para escribirle al equipo de Órbita. Si tenés una duda o encontrás un error, contanos por acá.',
      );
      sessionStorage.setItem('orbita_saludo_chat', '1');
    }
  }, [email, nombre, estudio, cuit, telefono]);

  return <TooltipSoporte />;
}

/**
 * Mini-tooltip que aparece al pasar el cursor sobre la burbuja de Crisp, para que se entienda de un
 * vistazo para qué es (consultas / reportar un error). Crisp inyecta su launcher en `#crisp-chatbox`;
 * escuchamos el hover de ese contenedor y mostramos nuestro propio cartelito (no tocamos su markup).
 * Se oculta cuando el chat está abierto.
 */
function TooltipSoporte() {
  const [hover, setHover] = useState(false);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    if (!WEBSITE_ID) return;
    let cont: HTMLElement | null = null;
    const onEnter = () => setHover(true);
    const onLeave = () => setHover(false);

    const enlazar = (): boolean => {
      cont = document.getElementById('crisp-chatbox');
      if (!cont) return false;
      cont.addEventListener('mouseenter', onEnter);
      cont.addEventListener('mouseleave', onLeave);
      return true;
    };

    // El launcher de Crisp tarda un toque en aparecer: reintentamos hasta engancharlo (máx ~15 s).
    let intervalo: number | undefined;
    if (!enlazar()) {
      intervalo = window.setInterval(() => {
        if (enlazar()) window.clearInterval(intervalo);
      }, 500);
      window.setTimeout(() => intervalo && window.clearInterval(intervalo), 15000);
    }

    // Estado abierto/cerrado para no mostrar el tooltip con el panel del chat ya abierto.
    try {
      Crisp.chat.onChatOpened(() => {
        setAbierto(true);
        setHover(false);
      });
      Crisp.chat.onChatClosed(() => setAbierto(false));
    } catch {
      /* Crisp todavía no configurado (sin sesión / sin WEBSITE_ID): no hay nada que escuchar. */
    }

    return () => {
      if (intervalo) window.clearInterval(intervalo);
      if (cont) {
        cont.removeEventListener('mouseenter', onEnter);
        cont.removeEventListener('mouseleave', onLeave);
      }
    };
  }, []);

  if (!WEBSITE_ID || !hover || abierto) return null;

  return (
    <div className="fixed bottom-[88px] right-6 z-[999999] pointer-events-none animate-in fade-in-0 slide-in-from-bottom-1 duration-150">
      <div className="rounded-xl bg-foreground px-3.5 py-2 text-sm font-medium text-background shadow-lg max-w-[220px]">
        ¿Dudas o encontraste un error? Escribinos 👋
      </div>
    </div>
  );
}

/**
 * Limpia la sesión del visitante de Crisp. Se llama en el logout para que, si otro contador entra
 * desde el mismo navegador, no herede el chat ni la identidad del anterior.
 */
export function resetChatSoporte(): void {
  if (!WEBSITE_ID) return;
  try {
    Crisp.session.reset();
  } catch {
    /* Crisp todavía no estaba configurado: no hay nada que resetear. */
  }
}
