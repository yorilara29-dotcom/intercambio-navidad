import { EVENT_YEAR } from './config.js';
import { isConfigured, supabase, callRpc } from './supabase.js';
import {
  $,
  $$,
  cleanText,
  fullName,
  initials,
  formatDateTime,
  normalizeForSearch,
  debounce,
  readableError,
  setButtonLoading,
  showToast,
  setFormError,
  clearFormErrors,
  copyText,
  downloadCsv,
  icons,
} from './utils.js';

const state = {
  configured: isConfigured,
  session: null,
  dashboard: null,
  search: '',
  loading: false,
  confirmAction: null,
  confirmBusy: false,
};

const shortDateFormatter = new Intl.DateTimeFormat('es', {
  day: '2-digit',
  month: 'short',
});

document.addEventListener('DOMContentLoaded', init);

async function init() {
  setEventYear();
  bindAdminEvents();

  if (!state.configured) {
    showAuthView();
    showSetupState();
    return;
  }

  await restoreSession();
  subscribeToAuthChanges();
}

function setEventYear() {
  const year = Number.isInteger(EVENT_YEAR)
    ? EVENT_YEAR
    : new Date().getFullYear();

  const element = $('#year');
  if (element) element.textContent = String(year);
}

function bindAdminEvents() {
  $('#login-form')?.addEventListener('submit', handleLogin);
  $('#toggle-password')?.addEventListener('click', handleTogglePassword);
  $('#signout-button')?.addEventListener('click', handleSignOut);
  $('#refresh-dashboard')?.addEventListener('click', handleRefresh);
  $('#retry-dashboard')?.addEventListener('click', handleRefresh);
  $('#draw-button')?.addEventListener('click', handleDrawClick);
  $('#redraw-button')?.addEventListener('click', handleRedrawClick);
  $('#registration-toggle')?.addEventListener(
    'change',
    handleRegistrationToggle
  );
  $('#export-csv')?.addEventListener('click', handleExportCsv);
  $('#copy-site-link')?.addEventListener('click', handleCopySiteLink);
  $('#confirm-cancel')?.addEventListener('click', closeConfirmDialog);
  $('#confirm-accept')?.addEventListener('click', handleConfirmAccept);

  $('#participant-search')?.addEventListener(
    'input',
    debounce(() => {
      state.search = $('#participant-search')?.value ?? '';
      renderParticipants();
    }, 140)
  );

  ['#admin-email', '#admin-password'].forEach((selector) => {
    $(selector)?.addEventListener('input', () => {
      const error = $('#login-error');
      if (error) setFormError(error, '');
    });
  });

  const dialog = $('#confirm-dialog');
  dialog?.addEventListener('click', (event) => {
    if (event.target === dialog) closeConfirmDialog();
  });
}

async function restoreSession() {
  try {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error) throw error;

    if (session) {
      state.session = session;
      renderSession();
      await openDashboard();
    } else {
      showAuthView();
    }
  } catch (error) {
    showAuthView({ message: readableError(error) });
  }
}

function subscribeToAuthChanges() {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      state.session = null;
      state.dashboard = null;
      showAuthView();
    } else if (session) {
      state.session = session;
      renderSession();
    }
  });
}

function renderSession() {
  const box = $('#session-box');
  const email = $('#session-email');

  if (!box || !email) return;

  const userEmail = state.session?.user?.email;

  if (userEmail) {
    email.textContent = userEmail;
    email.title = userEmail;
    box.hidden = false;
  } else {
    email.textContent = '';
    box.hidden = true;
  }
}

async function handleLogin(event) {
  event.preventDefault();
  if (!state.configured) return;

  const form = event.currentTarget;
  clearFormErrors(form);

  const email = cleanText($('#admin-email')?.value);
  const password = $('#admin-password')?.value ?? '';
  const loginError = $('#login-error');

  if (!email || !email.includes('@')) {
    setFormError(loginError, 'Escribe un email válido.');
    $('#admin-email')?.focus();
    return;
  }

  if (!password) {
    setFormError(loginError, 'Escribe tu contraseña.');
    $('#admin-password')?.focus();
    return;
  }

  const submitButton = $('#login-submit');
  setButtonLoading(submitButton, true, 'Entrando…');

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    state.session = data.session;
    renderSession();
    await openDashboard();
  } catch (error) {
    const message = readableError(error);
    setFormError(loginError, message);
    showToast(message, 'error');
  } finally {
    setButtonLoading(submitButton, false);
  }
}

function handleTogglePassword() {
  const input = $('#admin-password');
  const button = $('#toggle-password');
  if (!input || !button) return;

  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  button.textContent = show ? 'Ocultar' : 'Ver';
  button.setAttribute('aria-pressed', show ? 'true' : 'false');
  button.setAttribute(
    'aria-label',
    show ? 'Ocultar contraseña' : 'Mostrar contraseña'
  );
}

async function handleSignOut() {
  if (state.configured) {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error(error);
    }
  }

  state.session = null;
  state.dashboard = null;
  showAuthView();
  showToast('Sesión cerrada.', 'info');
}

async function openDashboard() {
  renderSession();
  await loadDashboard();
}

async function loadDashboard({ silent = false } = {}) {
  if (!state.configured || state.loading) return;

  state.loading = true;
  showDashboardLoading();

  try {
    const data = await callRpc('admin_get_dashboard');

    if (!data) {
      throw new Error('El panel no devolvió datos.');
    }

    const currentSearch = $('#participant-search')?.value ?? '';
    state.dashboard = data;
    state.search = currentSearch;

    renderDashboard();
    showDashboardContent();
  } catch (error) {
    const message = readableError(error);

    if (isAuthError(error)) {
      try {
        await supabase.auth.signOut();
      } catch (signOutError) {
        console.error(signOutError);
      }

      state.session = null;
      state.dashboard = null;
      showAuthView({ message });
      showToast(message, 'error');
    } else {
      showDashboardError(message);
      if (!silent) showToast(message, 'error');
    }
  } finally {
    state.loading = false;
  }
}

function isAuthError(error) {
  const code = String(error?.code ?? '');
  const message = String(error?.message ?? '');

  return (
    code === '42501' ||
    code === 'PGRST301' ||
    /No autorizado|permisos de administrador|Debes iniciar sesión|JWT expired|refresh token/i.test(
      message
    )
  );
}

function showAuthView({ message = '' } = {}) {
  const boot = $('#boot-loading');
  const auth = $('#auth-view');
  const dashboard = $('#dashboard-view');
  const setup = $('#setup-banner');

  if (boot) boot.hidden = true;
  if (auth) auth.hidden = false;
  if (dashboard) dashboard.hidden = true;
  if (setup) setup.hidden = state.configured;

  const password = $('#admin-password');
  if (password) password.value = '';

  setFormError($('#login-error'), message);
  renderSession();
}

function showSetupState() {
  const setup = $('#setup-banner');
  if (setup) setup.hidden = false;

  $$('#login-form input, #login-form button').forEach((element) => {
    element.disabled = true;
  });
}

function showDashboardLoading() {
  const boot = $('#boot-loading');
  const auth = $('#auth-view');
  const dashboard = $('#dashboard-view');
  const setup = $('#setup-banner');
  const loading = $('#dashboard-loading');
  const error = $('#dashboard-error');
  const content = $('#dashboard-content');

  if (boot) boot.hidden = true;
  if (auth) auth.hidden = true;
  if (setup) setup.hidden = true;
  if (dashboard) dashboard.hidden = false;
  if (loading) loading.hidden = false;
  if (error) error.hidden = true;
  if (content) content.hidden = true;
}

function showDashboardContent() {
  const loading = $('#dashboard-loading');
  const error = $('#dashboard-error');
  const content = $('#dashboard-content');

  if (loading) loading.hidden = true;
  if (error) error.hidden = true;
  if (content) content.hidden = false;
}

function showDashboardError(message) {
  const loading = $('#dashboard-loading');
  const error = $('#dashboard-error');
  const content = $('#dashboard-content');
  const text = $('#dashboard-error-text');

  if (loading) loading.hidden = true;
  if (content) content.hidden = true;
  if (error) error.hidden = false;
  if (text) text.textContent = message;
}

async function handleRefresh() {
  const button = $('#refresh-dashboard');
  setButtonLoading(button, true, 'Actualizando…');

  try {
    await loadDashboard({ silent: true });
  } finally {
    setButtonLoading(button, false);
  }
}

function renderDashboard() {
  if (!state.dashboard) return;

  const { state: drawState, stats, participants } = state.dashboard;
  const list = Array.isArray(participants) ? participants : [];
  const total = Number(stats?.total ?? list.length);
  const assigned = Number(stats?.assigned ?? 0);
  const pending = Number(stats?.pending ?? 0);
  const drawDone = Boolean(drawState?.draw_done);

  setText('#stat-total', total);
  setText('#stat-assigned', assigned);
  setText('#stat-pending', pending);

  const pendingCard = $('#stat-pending-card');
  pendingCard?.classList.toggle('has-pending', pending > 0);

  setText(
    '#stat-pending-note',
    pending > 0 ? 'sin asignación' : 'todo asignado'
  );

  const summary = $('#participants-summary');
  if (summary) {
    summary.textContent =
      total === 0
        ? 'Todavía no hay participantes registrados.'
        : `${total} ${
            total === 1 ? 'participante registrado' : 'participantes registrados'
          } · ${assigned} con asignación.`;
  }

  renderDrawControls({ drawState, stats, total, assigned, pending, drawDone });
  renderRegistrationControls(drawState);

  const advancedZone = $('#advanced-zone');
  if (advancedZone) {
    advancedZone.hidden = !drawDone || total < 2;
  }

  const exportButton = $('#export-csv');
  if (exportButton) exportButton.disabled = total === 0;

  renderParticipants();
}

function renderDrawControls({
  drawState,
  total,
  pending,
  drawDone,
}) {
  const statusPill = $('#draw-status-pill');
  const title = $('#draw-card-title');
  const text = $('#draw-card-text');
  const roundValue = $('#draw-round-value');
  const dateValue = $('#draw-date-value');
  const pendingNote = $('#draw-pending-note');
  const pendingTitle = $('#draw-pending-title');
  const pendingText = $('#draw-pending-text');
  const button = $('#draw-button');
  const buttonLabel = $('#draw-button-label');
  const hint = $('#draw-hint');

  if (statusPill) {
    statusPill.textContent = drawDone ? 'Realizado' : 'Pendiente';
    statusPill.className = `status-pill ${
      drawDone ? 'is-done' : 'is-pending'
    }`;
  }

  if (roundValue) {
    roundValue.textContent = String(drawState?.draw_round ?? 0);
  }

  if (dateValue) {
    dateValue.textContent = formatDateTime(drawState?.drawn_at);
  }

  if (!drawDone) {
    if (total < 2) {
      setText('#draw-card-title', 'Faltan participantes');
      setText(
        '#draw-card-text',
        'Se necesitan al menos 2 personas registradas para poder realizar el sorteo.'
      );
      if (button) button.disabled = true;
      if (buttonLabel) buttonLabel.textContent = 'Faltan participantes';
      setText(
        '#draw-hint',
        'Comparte el enlace del sitio para recibir más registros.'
      );
    } else {
      setText('#draw-card-title', 'Todo listo para el sorteo');
      setText(
        '#draw-card-text',
        'Cuando la lista esté completa, inicia el sorteo. Cada participante recibirá exactamente una persona a quien regalar, sin auto-regalos ni destinatarios repetidos.'
      );
      if (button) button.disabled = false;
      if (buttonLabel) buttonLabel.textContent = 'Iniciar sorteo';
      setText(
        '#draw-hint',
        `Se asignará una persona a cada uno de los ${total} participantes.`
      );
    }

    if (pendingNote) pendingNote.hidden = true;
    return;
  }

  if (pending > 0) {
    setText('#draw-card-title', 'Hay participantes nuevos');
    setText(
      '#draw-card-text',
      `Hay ${pending} ${
        pending === 1 ? 'registro nuevo' : 'registros nuevos'
      } después del sorteo. El segundo sorteo los integrará conservando las asignaciones actuales y ajustando solo lo necesario.`
    );
    if (button) button.disabled = false;
    if (buttonLabel) {
      buttonLabel.textContent =
        pending === 1
          ? 'Segundo sorteo (1 pendiente)'
          : `Segundo sorteo (${pending} pendientes)`;
    }
    setText(
      '#draw-hint',
      'Las demás asignaciones no se modificarán, salvo el ajuste mínimo para conectar a los nuevos.'
    );

    if (pendingNote) {
      pendingNote.hidden = false;
      if (pendingTitle) {
        pendingTitle.textContent =
          pending === 1
            ? '1 participante pendiente'
            : `${pending} participantes pendientes`;
      }
      if (pendingText) {
        pendingText.textContent =
          'Debes ejecutar el segundo sorteo para que también tengan a quién regalar.';
      }
    }
  } else {
    setText('#draw-card-title', 'Sorteo al día');
    setText(
      '#draw-card-text',
      'Todos los participantes registrados tienen una asignación. Si alguien se registra más adelante, aparecerá aquí el segundo sorteo.'
    );
    if (button) button.disabled = true;
    if (buttonLabel) buttonLabel.textContent = 'Todos tienen asignación';
    setText(
      '#draw-hint',
      'No hay participantes pendientes en este momento.'
    );
    if (pendingNote) pendingNote.hidden = true;
  }
}

function renderRegistrationControls(drawState) {
  const registrationOpen = Boolean(drawState?.registration_open);
  const toggle = $('#registration-toggle');
  const pill = $('#registration-status-pill');

  if (toggle) toggle.checked = registrationOpen;

  if (pill) {
    pill.textContent = registrationOpen ? 'Abierto' : 'Cerrado';
    pill.className = `status-pill ${
      registrationOpen ? 'is-open' : 'is-closed'
    }`;
  }
}

function renderParticipants() {
  const participants = Array.isArray(state.dashboard?.participants)
    ? state.dashboard.participants
    : [];

  const tbody = $('#participants-body');
  const tableWrap = $('.table-wrap');
  const emptyState = $('#participants-empty');
  const noResults = $('#participants-no-results');
  const tableFooter = $('.table-footer');
  const pendingNote = $('#table-pending-note');

  const query = normalizeForSearch(state.search);

  const filtered = participants.filter((participant) => {
    if (!query) return true;

    const receiver = participant.receiver;
    const searchable = [
      fullName(participant),
      participant.shoe_size,
      receiver ? fullName(receiver) : '',
      receiver?.shoe_size ?? '',
      receiver ? 'asignado' : 'pendiente',
    ]
      .map(normalizeForSearch)
      .join(' ');

    return searchable.includes(query);
  });

  if (tbody) {
    const fragment = document.createDocumentFragment();

    for (const participant of filtered) {
      fragment.appendChild(createParticipantRow(participant));
    }

    tbody.replaceChildren(fragment);
  }

  const total = participants.length;
  const filteredCount = filtered.length;

  if (filteredCount === 0 && total === 0) {
    if (tableWrap) tableWrap.hidden = true;
    if (emptyState) emptyState.hidden = false;
    if (noResults) noResults.hidden = true;
    if (tableFooter) tableFooter.hidden = true;
  } else if (filteredCount === 0) {
    if (tableWrap) tableWrap.hidden = true;
    if (emptyState) emptyState.hidden = true;
    if (noResults) noResults.hidden = false;
    if (tableFooter) tableFooter.hidden = false;
  } else {
    if (tableWrap) tableWrap.hidden = false;
    if (emptyState) emptyState.hidden = true;
    if (noResults) noResults.hidden = true;
    if (tableFooter) tableFooter.hidden = false;
  }

  setText('#filter-count', `Mostrando ${filteredCount} de ${total}`);

  const pending = Number(state.dashboard?.stats?.pending ?? 0);
  const drawDone = Boolean(state.dashboard?.state?.draw_done);

  if (pendingNote) {
    if (pending > 0 && drawDone) {
      pendingNote.hidden = false;
      pendingNote.textContent = `Hay ${pending} ${
        pending === 1 ? 'participante sin asignación' : 'participantes sin asignación'
      }. Ejecuta el segundo sorteo para integrarlos.`;
    } else {
      pendingNote.hidden = true;
    }
  }
}

function createParticipantRow(participant) {
  const row = document.createElement('tr');
  const receiver = participant.receiver;

  const nameCell = document.createElement('td');
  nameCell.dataset.label = 'Participante';

  const participantCell = document.createElement('div');
  participantCell.className = 'participant-cell';

  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = initials(
    participant.first_name,
    participant.last_name
  );

  const nameBox = document.createElement('div');
  nameBox.className = 'participant-name';

  const nameStrong = document.createElement('strong');
  nameStrong.textContent = fullName(participant);

  const nameSmall = document.createElement('small');
  nameSmall.textContent = `Registrado ${formatShortDate(participant.created_at)}`;

  nameBox.append(nameStrong, nameSmall);
  participantCell.append(avatar, nameBox);
  nameCell.appendChild(participantCell);

  const sizeCell = document.createElement('td');
  sizeCell.dataset.label = 'Talla';
  const sizeBadge = document.createElement('span');
  sizeBadge.className = 'size-badge';
  sizeBadge.textContent = participant.shoe_size;
  sizeCell.appendChild(sizeBadge);

  const receiverCell = document.createElement('td');
  receiverCell.dataset.label = 'Le regala a';

  if (receiver) {
    const receiverBox = document.createElement('div');
    receiverBox.className = 'receiver-cell';

    const receiverName = document.createElement('strong');
    receiverName.textContent = fullName(receiver);

    const receiverSize = document.createElement('span');
    receiverSize.textContent = `Talla ${receiver.shoe_size}`;

    receiverBox.append(receiverName, receiverSize);
    receiverCell.appendChild(receiverBox);
  } else {
    const dash = document.createElement('span');
    dash.className = 'muted-dash';
    dash.textContent = '—';
    receiverCell.appendChild(dash);
  }

  const statusCell = document.createElement('td');
  statusCell.dataset.label = 'Estado';

  const badge = document.createElement('span');
  badge.className = `badge ${receiver ? 'badge-assigned' : 'badge-pending'}`;
  badge.textContent = receiver ? 'Asignado' : 'Pendiente';
  statusCell.appendChild(badge);

  const actionsCell = document.createElement('td');
  actionsCell.className = 'actions-cell';
  actionsCell.dataset.label = 'Acciones';

  const actions = document.createElement('div');
  actions.className = 'row-actions';

  if (receiver) {
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'row-action';
    copyButton.title = `Copiar mensaje para ${fullName(participant)}`;
    copyButton.setAttribute(
      'aria-label',
      `Copiar mensaje de regalo para ${fullName(participant)}`
    );
    copyButton.innerHTML = icons.copy;
    copyButton.addEventListener('click', () =>
      copyAssignmentFor(participant)
    );
    actions.appendChild(copyButton);
  } else {
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'row-action row-action-danger';
    deleteButton.title = `Eliminar a ${fullName(participant)}`;
    deleteButton.setAttribute(
      'aria-label',
      `Eliminar a ${fullName(participant)}`
    );
    deleteButton.innerHTML = icons.trash;
    deleteButton.addEventListener('click', () =>
      askDeleteParticipant(participant)
    );
    actions.appendChild(deleteButton);
  }

  actionsCell.appendChild(actions);

  row.append(nameCell, sizeCell, receiverCell, statusCell, actionsCell);
  return row;
}

function formatShortDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return shortDateFormatter.format(date);
}

async function copyAssignmentFor(participant) {
  if (!participant?.receiver) return;

  const message = `Hola ${
    participant.first_name
  }, te toca regalarle a: ${fullName(participant.receiver)}. Talla de calzado: ${
    participant.receiver.shoe_size
  }. 🎁`;

  const copied = await copyText(message);
  showToast(
    copied
      ? 'Mensaje copiado para enviar por WhatsApp o mensaje privado.'
      : 'No pudimos copiar el mensaje.',
    copied ? 'success' : 'error'
  );
}

function askDeleteParticipant(participant) {
  openConfirm({
    title: 'Eliminar participante',
    message: `Se eliminará a ${fullName(
      participant
    )}. Esta acción no se puede deshacer.`,
    acceptLabel: 'Eliminar',
    destructive: true,
    onAccept: async () => {
      await callRpc('admin_delete_pending_participant', {
        p_participant_id: participant.id,
      });
      showToast(`${fullName(participant)} fue eliminado.`, 'info');
      await loadDashboard({ silent: true });
    },
  });
}

function handleDrawClick() {
  if (!state.dashboard) return;

  const { total, pending } = getCounts();
  const drawDone = Boolean(state.dashboard.state?.draw_done);

  if (total < 2) {
    showToast('Se necesitan al menos 2 participantes para sortear.', 'error');
    return;
  }

  if (!drawDone) {
    openConfirm({
      title: 'Iniciar el sorteo',
      message: `Se asignará una persona a cada uno de los ${total} participantes. Nadie se regalará a sí mismo y nadie recibirá más de un regalo.`,
      acceptLabel: 'Iniciar sorteo',
      destructive: false,
      onAccept: runFullDraw,
    });
    return;
  }

  if (pending > 0) {
    openConfirm({
      title: 'Segundo sorteo',
      message: `Se integrarán ${pending} ${
        pending === 1 ? 'participante nuevo' : 'participantes nuevos'
      }. Las asignaciones actuales se conservarán, con el ajuste mínimo necesario para que todos queden incluidos.`,
      acceptLabel: 'Integrar participantes',
      destructive: false,
      onAccept: runIntegrationDraw,
    });
    return;
  }

  showToast('Todos los participantes ya tienen una asignación.', 'info');
}

function handleRedrawClick() {
  const { total } = getCounts();

  if (total < 2) {
    showToast('Se necesitan al menos 2 participantes para sortear.', 'error');
    return;
  }

  openConfirm({
    title: 'Re-sortear a todos',
    message:
      'Esto reemplazará todas las asignaciones actuales por un sorteo completamente nuevo. Cada participante verá otra persona a quien regalar. Esta acción no se puede deshacer.',
    acceptLabel: 'Sí, re-sortear',
    destructive: true,
    onAccept: runFullDraw,
  });
}

async function runFullDraw() {
  const result = await callRpc('admin_start_full_draw');
  showToast(
    `Sorteo realizado con ${result?.total ?? 0} participantes.`,
    'success'
  );
  await loadDashboard({ silent: true });
}

async function runIntegrationDraw() {
  const result = await callRpc('admin_integrate_new_participants');

  if (result?.mode === 'none') {
    showToast(result.message || 'No hay participantes pendientes.', 'info');
  } else if (result?.mode === 'full') {
    showToast(
      `Sorteo realizado con ${result.total ?? 0} participantes.`,
      'success'
    );
  } else {
    showToast(
      `Se integraron ${result?.integrated ?? 0} ${
        result?.integrated === 1 ? 'participante' : 'participantes'
      } al sorteo.`,
      'success'
    );
  }

  await loadDashboard({ silent: true });
}

function getCounts() {
  return {
    total: Number(state.dashboard?.stats?.total ?? 0),
    assigned: Number(state.dashboard?.stats?.assigned ?? 0),
    pending: Number(state.dashboard?.stats?.pending ?? 0),
  };
}

async function handleRegistrationToggle(event) {
  const input = event.currentTarget;
  const desired = input.checked;
  input.disabled = true;

  try {
    await callRpc('admin_set_registration_open', { p_open: desired });
    showToast(
      desired ? 'Registro abierto.' : 'Registro cerrado.',
      'info'
    );
    await loadDashboard({ silent: true });
  } catch (error) {
    input.checked = !desired;
    showToast(readableError(error), 'error');
  } finally {
    input.disabled = false;
  }
}

function handleExportCsv() {
  const participants = state.dashboard?.participants;

  if (!Array.isArray(participants) || participants.length === 0) {
    showToast('No hay participantes para exportar.', 'info');
    return;
  }

  const rows = participants.map((participant) => [
    participant.first_name,
    participant.last_name,
    participant.shoe_size,
    participant.receiver?.first_name ?? '',
    participant.receiver?.last_name ?? '',
    participant.receiver?.shoe_size ?? '',
    participant.receiver ? 'Asignado' : 'Pendiente',
  ]);

  const date = new Date().toISOString().slice(0, 10);
  downloadCsv(
    `intercambio-tora-no-maki-${date}.csv`,
    [
      'Nombre',
      'Apellido',
      'Talla',
      'Le regala a (nombre)',
      'Le regala a (apellido)',
      'Talla destinatario',
      'Estado',
    ],
    rows
  );

  showToast('Archivo CSV exportado.', 'success');
}

async function handleCopySiteLink() {
  const siteUrl = new URL('./', window.location.href).href;
  const copied = await copyText(siteUrl);

  showToast(
    copied
      ? 'Enlace del sitio copiado. Compártelo con el equipo.'
      : 'No pudimos copiar el enlace.',
    copied ? 'success' : 'error'
  );
}

function openConfirm({
  title,
  message,
  acceptLabel,
  destructive = false,
  onAccept,
}) {
  const dialog = $('#confirm-dialog');
  if (!dialog) return;

  setText('#confirm-title', title);
  setText('#confirm-message', message);

  const accept = $('#confirm-accept');
  if (accept) {
    accept.textContent = acceptLabel;
    accept.className = `btn ${destructive ? 'btn-danger' : 'btn-primary'}`;
  }

  state.confirmAction = onAccept;
  state.confirmBusy = false;

  if (dialog.open) dialog.close();
  dialog.showModal();
}

function closeConfirmDialog() {
  const dialog = $('#confirm-dialog');
  if (dialog?.open) dialog.close();
  state.confirmAction = null;
}

async function handleConfirmAccept() {
  const dialog = $('#confirm-dialog');
  const action = state.confirmAction;

  if (!action || state.confirmBusy) {
    closeConfirmDialog();
    return;
  }

  state.confirmAction = null;
  state.confirmBusy = true;

  const acceptButton = $('#confirm-accept');
  const cancelButton = $('#confirm-cancel');

  setButtonLoading(acceptButton, true, 'Procesando…');
  if (cancelButton) cancelButton.disabled = true;

  try {
    await action();
  } catch (error) {
    const message = readableError(error);

    if (isAuthError(error)) {
      try {
        await supabase.auth.signOut();
      } catch (signOutError) {
        console.error(signOutError);
      }

      state.session = null;
      state.dashboard = null;
      showAuthView({ message });
    }

    showToast(message, 'error');
  } finally {
    state.confirmBusy = false;
    setButtonLoading(acceptButton, false);
    if (cancelButton) cancelButton.disabled = false;
    if (dialog?.open) dialog.close();
  }
}

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = String(value ?? '');
}
