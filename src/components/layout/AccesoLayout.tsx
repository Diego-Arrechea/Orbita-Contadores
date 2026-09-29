import type { ReactNode } from 'react';
import { SelectorTema } from '@/components/shared/SelectorTema';

/**
 * Pantallas de acceso (login, registro, recuperar clave, confirmar mail): panel de marca a la
 * izquierda —el fondo espacial con los anillos de hiorbita.com, igual que Órbita Chat— y el
 * formulario sobre blanco a la derecha. En celular el panel queda arriba y el formulario sube como
 * una hoja. Los estilos viven en `index.css` (.acceso-*).
 */
export function AccesoLayout({ children }: { children: ReactNode }) {
  return (
    <main className="acceso">
      <aside className="acceso-marca" aria-hidden="true">
        <svg className="acceso-anillos" viewBox="0 0 600 900" preserveAspectRatio="xMaxYMax slice">
          <circle cx="520" cy="760" r="220" />
          <circle cx="520" cy="760" r="330" />
          <circle cx="520" cy="760" r="450" />
          <circle className="acceso-anillos-punto" cx="313" cy="685" r="5" />
        </svg>
        <div className="acceso-wordmark">
          órbita<span>.</span>
        </div>
        <div className="acceso-marca-txt">
          <div className="acceso-eyebrow">PARA ESTUDIOS CONTABLES</div>
          <div className="acceso-lema">Tu cartera de monotributistas, siempre al día.</div>
          <div className="acceso-bajada">
            Alertas, vencimientos, facturación y conciliación de todos tus clientes en un solo panel.
          </div>
        </div>
        <div className="acceso-web">hiorbita.com</div>
      </aside>
      <div className="acceso-lado">
        <SelectorTema className="absolute right-4 top-4" />
        <div className="acceso-form">{children}</div>
      </div>
    </main>
  );
}
