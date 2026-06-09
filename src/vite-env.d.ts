/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Website ID de Crisp para el chat de soporte. Se configura en .env.local */
  readonly VITE_CRISP_WEBSITE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
