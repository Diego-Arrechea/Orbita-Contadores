/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Website ID de Crisp para el chat de soporte. Se configura en .env.local */
  readonly VITE_CRISP_WEBSITE_ID?: string;
  /**
   * Interruptor para apagar el chat de soporte sin tocar el Website ID. "false" = no se carga
   * el widget ni el SDK (útil para deshabilitarlo en producción desde Vercel). Cualquier otro
   * valor (o ausente) = habilitado. Se configura en .env.local / variables de entorno.
   */
  readonly VITE_CRISP_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
