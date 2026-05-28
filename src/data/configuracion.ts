import type { Configuracion } from '@/types';

export const CONFIGURACION_INICIAL: Configuracion = {
  ventanas: [
    { semestre: 'Enero-Junio',     fechaLimite: '2026-08-05', efectoDesde: '2026-08-01' },
    { semestre: 'Julio-Diciembre', fechaLimite: '2027-02-05', efectoDesde: '2027-02-01' },
  ],
  margenInflacionProyeccion: -0.05,
  umbralAmarilloPorcentaje: 0.80,
  umbralAmarilloDias: 45,
  umbralRojoDias: 15,
  umbralRatioGastosAmarillo: 0.70,
};
