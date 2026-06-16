import { useState, useEffect } from 'react';
import {
  Save,
  Calendar,
  Bell,
  Percent,
  Database,
  Info,
  MessageCircle,
  Loader2,
  AlertCircle,
  CheckCircle2,
  KeyRound,
  MailCheck,
  MailWarning,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CATEGORIAS } from '@/data/categorias';
import { useConfig } from '@/context/ConfigContext';
import { CAUSALES_EXCLUSION } from '@/data/causales';
import { formatCurrency } from '@/lib/utils';
import { enviarWhatsappPrueba } from '@/services/notificacionesService';
import {
  cambiarPassword,
  getMe,
  reenviarConfirmacion,
  mensajeDeError,
} from '@/services/authService';
import { actualizarUsuarioGuardado, usuarioActual } from '@/lib/cuenta';

export function Configuracion() {
  const { config, guardarConfig } = useConfig();
  const [conf, setConf] = useState(config);
  // El provider arranca en defaults y refina con lo guardado de la cuenta: cuando llega, refrescamos
  // el formulario (si el usuario ya estaba editando con el backend frío —caso raro—, se le pisa).
  useEffect(() => setConf(config), [config]);
  const [guardado, setGuardado] = useState<'fechas' | 'umbrales' | null>(null);
  const [errorGuardar, setErrorGuardar] = useState('');
  const [numPrueba, setNumPrueba] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; msg: string } | null>(null);

  // Cambio de contraseña (tab Seguridad).
  const [passActual, setPassActual] = useState('');
  const [passNueva, setPassNueva] = useState('');
  const [passRepetir, setPassRepetir] = useState('');
  const [cambiandoPass, setCambiandoPass] = useState(false);
  const [resultadoPass, setResultadoPass] = useState<{ ok: boolean; msg: string } | null>(null);

  // Confirmación de correo (tab Seguridad). Arrancamos con lo que haya en la sesión y refrescamos
  // contra el backend al montar (las sesiones viejas no traen el campo → null = todavía no sabemos).
  const emailCuenta = usuarioActual()?.email ?? '';
  const [emailConfirmado, setEmailConfirmado] = useState<boolean | null>(
    () => usuarioActual()?.email_confirmado ?? null
  );
  const [reenvio, setReenvio] = useState<'idle' | 'enviando' | 'enviado' | 'error'>('idle');

  useEffect(() => {
    getMe()
      .then(u => {
        actualizarUsuarioGuardado(u);
        setEmailConfirmado(u.email_confirmado ?? true);
      })
      .catch(() => {});
  }, []);

  async function reenviarCorreo() {
    setReenvio('enviando');
    try {
      const r = await reenviarConfirmacion();
      // Si el backend avisa que ya estaba confirmado, reflejamos el estado real (sin "te enviamos…").
      if (r.ya_confirmado) {
        setEmailConfirmado(true);
        setReenvio('idle');
      } else {
        setReenvio('enviado');
      }
    } catch {
      setReenvio('error');
    }
  }

  async function guardarPassword() {
    setResultadoPass(null);
    if (passNueva.length < 8) {
      setResultadoPass({ ok: false, msg: 'La nueva contraseña tiene que tener al menos 8 caracteres.' });
      return;
    }
    if (passNueva !== passRepetir) {
      setResultadoPass({ ok: false, msg: 'Las contraseñas nuevas no coinciden.' });
      return;
    }
    setCambiandoPass(true);
    try {
      await cambiarPassword(passActual, passNueva);
      setResultadoPass({ ok: true, msg: 'Contraseña actualizada. Usá la nueva la próxima vez que ingreses.' });
      setPassActual('');
      setPassNueva('');
      setPassRepetir('');
    } catch (e) {
      setResultadoPass({ ok: false, msg: mensajeDeError(e) });
    } finally {
      setCambiandoPass(false);
    }
  }

  // Edita una de las dos ventanas (fecha límite / efecto desde) en el estado local. El cambio recién
  // impacta a los clientes cuando se aprieta "Guardar fechas".
  function setVentana(i: number, campo: 'fechaLimite' | 'efectoDesde', valor: string) {
    setConf(prev => ({
      ...prev,
      ventanas: prev.ventanas.map((v, idx) => (idx === i ? { ...v, [campo]: valor } : v)),
    }));
    setGuardado(null);
  }

  async function guardarFechas() {
    setErrorGuardar('');
    try {
      await guardarConfig({ ventanas: conf.ventanas });
      setGuardado('fechas');
    } catch (e) {
      setGuardado(null);
      setErrorGuardar(mensajeDeError(e));
    }
  }

  async function guardarUmbrales() {
    setErrorGuardar('');
    try {
      await guardarConfig({
        umbralAmarilloPorcentaje: conf.umbralAmarilloPorcentaje,
        umbralRatioGastosAmarillo: conf.umbralRatioGastosAmarillo,
        umbralAmarilloDias: conf.umbralAmarilloDias,
        umbralRojoDias: conf.umbralRojoDias,
        umbralDeudaCuotaUrgente: conf.umbralDeudaCuotaUrgente,
        inflacionMensualProyeccion: conf.inflacionMensualProyeccion,
      });
      setGuardado('umbrales');
    } catch (e) {
      setGuardado(null);
      setErrorGuardar(mensajeDeError(e));
    }
  }

  async function probarWhatsapp() {
    setEnviando(true);
    setResultado(null);
    try {
      const r = await enviarWhatsappPrueba(numPrueba.trim() || undefined);
      setResultado({ ok: true, msg: `Enviado a ${r.destino}. Revisá tu WhatsApp.` });
    } catch (e) {
      setResultado({ ok: false, msg: mensajeDeError(e) });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Configuración</h1>
        <p className="text-base text-muted-foreground mt-2">
          Editá las ventanas de recategorización, los umbrales y los topes vigentes. Los cambios
          aplican a todos los clientes.
        </p>
      </div>

      {errorGuardar && (
        <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
          <AlertCircle className="h-4 w-4 shrink-0" /> No se pudo guardar: {errorGuardar}
        </div>
      )}

      <Tabs defaultValue="ventanas">
        <TabsList className="flex w-full max-w-full justify-start overflow-x-auto scrollbar-thin">
          <TabsTrigger value="ventanas" className="shrink-0"><Calendar className="h-3.5 w-3.5" />Ventanas</TabsTrigger>
          <TabsTrigger value="umbrales" className="shrink-0"><Bell className="h-3.5 w-3.5" />Alertas</TabsTrigger>
          <TabsTrigger value="categorias" className="shrink-0"><Database className="h-3.5 w-3.5" />Categorías</TabsTrigger>
          <TabsTrigger value="causales" className="shrink-0"><Info className="h-3.5 w-3.5" />Causales</TabsTrigger>
          <TabsTrigger value="notificaciones" className="shrink-0"><MessageCircle className="h-3.5 w-3.5" />WhatsApp</TabsTrigger>
          <TabsTrigger value="seguridad" className="shrink-0"><KeyRound className="h-3.5 w-3.5" />Seguridad</TabsTrigger>
        </TabsList>

        <TabsContent value="ventanas">
          <Card className="p-4 sm:p-6">
            <div className="text-base font-semibold mb-1">Ventanas de recategorización</div>
            <p className="text-sm text-muted-foreground mb-5">
              ARCA puede prorrogar estas fechas. Si publican una prórroga, actualizá manualmente
              acá para que las alertas no se calculen sobre fechas vencidas.
            </p>

            <div className="grid gap-4 md:grid-cols-2">
              {conf.ventanas.map((v, i) => (
                <div key={i} className="rounded-xl border border-border bg-muted/20 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Badge variant="muted">{v.semestre}</Badge>
                  </div>
                  <div className="grid gap-3">
                    <div className="space-y-1.5">
                      <Label>Fecha límite recategorización</Label>
                      <Input
                        type="date"
                        value={v.fechaLimite}
                        onChange={e => setVentana(i, 'fechaLimite', e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Efecto desde</Label>
                      <Input
                        type="date"
                        value={v.efectoDesde}
                        onChange={e => setVentana(i, 'efectoDesde', e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end gap-3 mt-5">
              {guardado === 'fechas' && (
                <span className="flex items-center gap-1.5 text-sm text-success">
                  <CheckCircle2 className="h-4 w-4" /> Guardado. Se aplica a todos los clientes.
                </span>
              )}
              <Button onClick={guardarFechas}>
                <Save className="h-4 w-4" /> Guardar fechas
              </Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="umbrales">
          <Card className="p-4 sm:p-6">
            <div className="text-base font-semibold mb-1">Configuración de alertas</div>
            <p className="text-sm text-muted-foreground mb-5">
              Definí cuándo el sistema marca un cliente en amarillo (aviso) o en rojo (urgente). Los
              cambios se aplican al recalcular las próximas alertas de tu cartera.
            </p>

            <div className="grid gap-4 md:grid-cols-2">
              <CampoNumero
                icon={<Percent className="h-4 w-4 text-muted-foreground" />}
                label="% del tope para pasar a amarillo"
                hint="Cuando el cliente consume este porcentaje de su categoría actual."
                value={conf.umbralAmarilloPorcentaje * 100}
                sufijo="%"
                onChange={(v) => setConf({ ...conf, umbralAmarilloPorcentaje: v / 100 })}
              />
              <CampoNumero
                icon={<Percent className="h-4 w-4 text-muted-foreground" />}
                label="% del umbral legal de ratio para amarillo"
                hint="Por encima de este porcentaje del umbral 80%/40% se prende alerta."
                value={conf.umbralRatioGastosAmarillo * 100}
                sufijo="%"
                onChange={(v) => setConf({ ...conf, umbralRatioGastosAmarillo: v / 100 })}
              />
              <CampoNumero
                icon={<Calendar className="h-4 w-4 text-muted-foreground" />}
                label="Días antes de ventana → amarillo"
                value={conf.umbralAmarilloDias}
                sufijo="días"
                onChange={(v) => setConf({ ...conf, umbralAmarilloDias: v })}
              />
              <CampoNumero
                icon={<Calendar className="h-4 w-4 text-muted-foreground" />}
                label="Días antes de ventana → rojo"
                value={conf.umbralRojoDias}
                sufijo="días"
                onChange={(v) => setConf({ ...conf, umbralRojoDias: v })}
              />
              <CampoNumero
                icon={<Percent className="h-4 w-4 text-muted-foreground" />}
                label="% de la cuota para deuda urgente"
                hint="Una deuda de cuota es urgente sólo si supera este % de la cuota del mes. Por debajo, es un aviso (evita marcar urgente un resto chico)."
                value={conf.umbralDeudaCuotaUrgente * 100}
                sufijo="%"
                onChange={(v) => setConf({ ...conf, umbralDeudaCuotaUrgente: v / 100 })}
              />
              <CampoNumero
                icon={<Percent className="h-4 w-4 text-muted-foreground" />}
                label="Inflación mensual estimada"
                hint="Proyecta la facturación a 12 meses (compuesta). 0% = sin inflación."
                value={conf.inflacionMensualProyeccion * 100}
                sufijo="%"
                onChange={(v) => setConf({ ...conf, inflacionMensualProyeccion: v / 100 })}
              />
            </div>
            <div className="flex items-center justify-end gap-3 mt-5">
              {guardado === 'umbrales' && (
                <span className="flex items-center gap-1.5 text-sm text-success">
                  <CheckCircle2 className="h-4 w-4" /> Guardado.
                </span>
              )}
              <Button onClick={guardarUmbrales}>
                <Save className="h-4 w-4" /> Guardar alertas
              </Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="categorias">
          <Card className="overflow-hidden">
            <div className="p-5 border-b border-border/60">
              <div className="text-base font-semibold">Categorías y topes vigentes</div>
              <p className="text-sm text-muted-foreground">
                ARCA actualiza estos valores en enero y julio. Pegá los nuevos cuando se publiquen
                en el Boletín Oficial.
              </p>
            </div>
            {/* Escritorio: tabla. Mobile (< lg): tarjetas apiladas. */}
            <div className="hidden lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cat.</TableHead>
                    <TableHead className="text-right">Tope facturación anual</TableHead>
                    <TableHead className="text-right">Cuota servicios</TableHead>
                    <TableHead className="text-right">Cuota comercio</TableHead>
                    <TableHead className="text-right">Superficie máx.</TableHead>
                    <TableHead className="text-right">Energía máx.</TableHead>
                    <TableHead className="text-right">Tope precio unit.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {CATEGORIAS.map(c => (
                    <TableRow key={c.codigo}>
                      <TableCell>
                        <Badge variant="outline" className="font-semibold">{c.codigo}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(c.topeAnual)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(c.cuotaServicios)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(c.cuotaComercio)}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.superficieMax} m²</TableCell>
                      <TableCell className="text-right tabular-nums">{c.energiaMaxKwh.toLocaleString('es-AR')} kWh</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.topePrecioUnitario ? formatCurrency(c.topePrecioUnitario) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-3 p-4 lg:hidden">
              {CATEGORIAS.map(c => (
                <div key={c.codigo} className="rounded-xl border border-border/60 p-3">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="font-semibold">{c.codigo}</Badge>
                    <span className="text-sm tabular-nums font-medium">{formatCurrency(c.topeAnual)}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Cuota serv.</span>
                      <span className="tabular-nums">{formatCurrency(c.cuotaServicios)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Cuota com.</span>
                      <span className="tabular-nums">{formatCurrency(c.cuotaComercio)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Superficie</span>
                      <span className="tabular-nums">{c.superficieMax} m²</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Energía</span>
                      <span className="tabular-nums">{c.energiaMaxKwh.toLocaleString('es-AR')} kWh</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Precio unit.</span>
                      <span className="tabular-nums">
                        {c.topePrecioUnitario ? formatCurrency(c.topePrecioUnitario) : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <Separator />
            <div className="p-4 flex justify-end gap-2">
              <Button variant="outline">Importar desde Excel</Button>
              <Button>
                <Save className="h-4 w-4" /> Guardar tabla
              </Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="causales">
          <Card className="overflow-hidden">
            <div className="p-5 border-b border-border/60">
              <div className="text-base font-semibold">Causales de exclusión disponibles</div>
              <p className="text-sm text-muted-foreground">
                Listado base que se aplica a cada cliente. La activación final de cada causal se
                hace en el detalle de cada cliente.
              </p>
            </div>
            {(() => {
              const ModoBadge = ({ modo }: { modo: string }) => (
                <Badge
                  variant={modo === 'auto' ? 'success' : modo === 'parcial' ? 'warning' : 'muted'}
                >
                  {modo === 'auto' ? 'Automático' : modo === 'parcial' ? 'Parcial' : 'Manual'}
                </Badge>
              );
              return (
                <>
                  {/* Escritorio: tabla. Mobile (< lg): tarjetas apiladas. */}
                  <div className="hidden lg:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">#</TableHead>
                          <TableHead>Descripción</TableHead>
                          <TableHead>Seguimiento</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {CAUSALES_EXCLUSION.map((c, i) => (
                          <TableRow key={c.codigo}>
                            <TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
                            <TableCell className="text-sm">{c.descripcion}</TableCell>
                            <TableCell>
                              <ModoBadge modo={c.modo} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="space-y-3 p-4 lg:hidden">
                    {CAUSALES_EXCLUSION.map((c, i) => (
                      <div key={c.codigo} className="rounded-xl border border-border/60 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="text-sm">
                            <span className="text-muted-foreground tabular-nums mr-1.5">{i + 1}.</span>
                            {c.descripcion}
                          </div>
                          <ModoBadge modo={c.modo} />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </Card>
        </TabsContent>

        <TabsContent value="notificaciones">
          <Card className="p-4 sm:p-6">
            <div className="text-base font-semibold mb-1">Alertas por WhatsApp</div>
            <p className="text-sm text-muted-foreground mb-5">
              Las alertas urgentes de tu cartera pueden llegarte por WhatsApp. Configurá las
              credenciales de Twilio en <code className="text-foreground">backend/.env</code> y probá
              el envío acá.
            </p>

            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end max-w-xl">
              <div className="space-y-1.5">
                <Label htmlFor="num-prueba">Número de prueba (opcional)</Label>
                <Input
                  id="num-prueba"
                  value={numPrueba}
                  onChange={e => setNumPrueba(e.target.value)}
                  placeholder="Vacío = el teléfono de tu cuenta"
                />
              </div>
              <Button onClick={probarWhatsapp} disabled={enviando}>
                {enviando ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Enviando…
                  </>
                ) : (
                  <>
                    <MessageCircle className="h-4 w-4" /> Enviar prueba
                  </>
                )}
              </Button>
            </div>

            {resultado && (
              <div
                className={`mt-4 flex items-start gap-2 rounded-lg px-3.5 py-2.5 text-sm border ${
                  resultado.ok
                    ? 'bg-success/10 border-success/25'
                    : 'bg-danger/10 border-danger/25'
                }`}
              >
                {resultado.ok ? (
                  <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
                )}
                <span className="text-foreground/80">{resultado.msg}</span>
              </div>
            )}

            <p className="text-xs text-muted-foreground mt-4">
              Para probar sin el trámite de Meta usá el <strong>Sandbox de Twilio</strong>: desde tu
              WhatsApp mandá <code className="text-foreground">join &lt;palabra&gt;</code> al número del
              sandbox y después enviá la prueba. En Argentina, si no te llega, probá el número con el
              9 (ej. +54 9 221…).
            </p>
          </Card>
        </TabsContent>

        <TabsContent value="seguridad" className="space-y-4">
          <Card className="p-4 sm:p-6">
            <div className="text-base font-semibold mb-1">Confirmación de correo</div>
            <p className="text-sm text-muted-foreground mb-5">
              Confirmar tu correo nos permite enviarte avisos y recuperar tu cuenta si olvidás la
              contraseña.
            </p>

            {emailConfirmado === null ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Verificando…
              </div>
            ) : emailConfirmado ? (
              <div className="flex items-start gap-2 rounded-lg border border-success/25 bg-success/10 px-3.5 py-2.5 text-sm max-w-md">
                <MailCheck className="h-4 w-4 text-success shrink-0 mt-0.5" />
                <span className="text-foreground/80">
                  Tu correo{emailCuenta ? <> (<strong>{emailCuenta}</strong>)</> : ''} está
                  confirmado.
                </span>
              </div>
            ) : (
              <div className="max-w-md space-y-4">
                <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-sm">
                  <MailWarning className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                  <span className="text-foreground/80">
                    Todavía no confirmaste tu correo
                    {emailCuenta ? <> (<strong>{emailCuenta}</strong>)</> : ''}. Enviate el enlace de
                    confirmación y seguí los pasos para terminar de activar tu cuenta.
                  </span>
                </div>

                {reenvio === 'enviado' ? (
                  <div className="flex items-start gap-2 rounded-lg border border-success/25 bg-success/10 px-3.5 py-2.5 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
                    <span className="text-foreground/80">
                      Te enviamos el correo de confirmación
                      {emailCuenta ? ` a ${emailCuenta}` : ''}. Revisá tu casilla (y la carpeta de
                      spam).
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <Button onClick={reenviarCorreo} disabled={reenvio === 'enviando'}>
                      {reenvio === 'enviando' ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Enviando…
                        </>
                      ) : (
                        <>
                          <MailCheck className="h-4 w-4" /> Enviar correo de confirmación
                        </>
                      )}
                    </Button>
                    {reenvio === 'error' && (
                      <span className="text-sm text-danger">
                        No se pudo enviar. Probá de nuevo en un momento.
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card className="p-4 sm:p-6">
            <div className="text-base font-semibold mb-1">Cambiar contraseña</div>
            <p className="text-sm text-muted-foreground mb-5">
              Ingresá tu contraseña actual y elegí una nueva (mínimo 8 caracteres). Vas a usar la
              nueva la próxima vez que ingreses.
            </p>

            <div className="grid gap-3 max-w-md">
              <div className="space-y-1.5">
                <Label htmlFor="pass-actual">Contraseña actual</Label>
                <Input
                  id="pass-actual"
                  type="password"
                  autoComplete="current-password"
                  value={passActual}
                  onChange={e => {
                    setPassActual(e.target.value);
                    setResultadoPass(null);
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pass-nueva">Nueva contraseña</Label>
                <Input
                  id="pass-nueva"
                  type="password"
                  autoComplete="new-password"
                  value={passNueva}
                  onChange={e => {
                    setPassNueva(e.target.value);
                    setResultadoPass(null);
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pass-repetir">Repetir nueva contraseña</Label>
                <Input
                  id="pass-repetir"
                  type="password"
                  autoComplete="new-password"
                  value={passRepetir}
                  onChange={e => {
                    setPassRepetir(e.target.value);
                    setResultadoPass(null);
                  }}
                />
              </div>
            </div>

            {resultadoPass && (
              <div
                className={`mt-4 flex items-start gap-2 rounded-lg px-3.5 py-2.5 text-sm border max-w-md ${
                  resultadoPass.ok
                    ? 'bg-success/10 border-success/25'
                    : 'bg-danger/10 border-danger/25'
                }`}
              >
                {resultadoPass.ok ? (
                  <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
                )}
                <span className="text-foreground/80">{resultadoPass.msg}</span>
              </div>
            )}

            <div className="flex justify-end mt-5 max-w-md">
              <Button
                onClick={guardarPassword}
                disabled={cambiandoPass || !passActual || !passNueva || !passRepetir}
              >
                {cambiandoPass ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Guardando…
                  </>
                ) : (
                  <>
                    <KeyRound className="h-4 w-4" /> Cambiar contraseña
                  </>
                )}
              </Button>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface CampoNumeroProps {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  value: number;
  sufijo: string;
  onChange: (v: number) => void;
}

function CampoNumero({ icon, label, hint, value, sufijo, onChange }: CampoNumeroProps) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5">
        {icon}
        {label}
      </Label>
      <div className="relative">
        <Input
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="pr-12"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          {sufijo}
        </span>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
