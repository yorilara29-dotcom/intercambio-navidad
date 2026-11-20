import { EVENT_YEAR } from './config.js';
import { isConfigured, callRpc } from './supabase.js';
import {
  $,
  $$,
  cleanText,
  fullName,
  pluralize,
  readableError,
  setButtonLoading,
  showToast,
  setFieldError,
  setFormError,
  clearFormErrors,
  saveLastRegistration,
  getLastRegistration,
  clearLastRegistration,
  copyText,
} from './utils.js';

const state = {
  configured: isConfigured,
  publicState: null,
  lastRegistration: null,
  successParticipant: null,
  successVisible: false,
  registerBusy: false,
  lookupBusy: false,
  assignment: null,
};

document.addEventListener('DOMContentLoaded', init);

function init() {
  setEventYear();
  state.lastRegistration = getLastRegistration();

  bindPublicEvents();

  if (!state.configured) {
    showSetupState();
    return;
  }

  if (state.lastRegistration) {
    prefillLookup(state.lastRegistration);
  }

  refreshPublicState();

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      refreshPublicState({ silent: true });
    }
  });
}

function setEventYear() {
  const year = Number.isInteger(EVENT_YEAR)
    ? EVENT_YEAR
    : new Date().getFullYear();

  const footerYear = $('#year');
  if (footerYear) footerYear.textContent = String(year);

  const eventYear = $('#event-year');
  if (eventYear) eventYear.textContent = String(year);
}

function bindPublicEvents() {
  $('#registration-form')?.addEventListener('submit', handleRegistration);
  $('#lookup-form')?.addEventListener('submit', handleLookup);
  $('#success-lookup')?.addEventListener('click', handleSuccessLookup);
  $('#success-another')?.addEventListener('click', handleAnotherRegistration);
  $('#clear-saved-data')?.addEventListener('click', handleClearSavedData);
  $('#copy-assignment')?.addEventListener('click', handleCopyAssignment);

  bindFieldErrorClearing([
    ['#reg-first-name', '#reg-first-name-error', '#registration-error'],
    ['#reg-last-name', '#reg-last-name-error', '#registration-error'],
    ['#reg-shoe-size', '#reg-shoe-size-error', '#registration-error'],
    ['#look-first-name', '#look-first-name-error', '#lookup-error'],
    ['#look-last-name', '#look-last-name-error', '#lookup-error'],
    ['#look-shoe-size', '#look-shoe-size-error', '#lookup-error'],
  ]);

  $$('#lookup-form input').forEach((input) => {
    input.addEventListener('input', () => {
      const hint = $('#saved-data-hint');
      if (hint) hint.hidden = true;
    });
  });
}

function bindFieldErrorClearing(pairs) {
  for (const [inputSelector, errorSelector, formErrorSelector] of pairs) {
    const input = $(inputSelector);
    if (!input) continue;

    input.addEventListener('input', () => {
      setFieldError(input, $(errorSelector), '');
      setFormError($(formErrorSelector), '');
    });
  }
}

async function refreshPublicState({ silent = false } = {}) {
  try {
    const data = await callRpc('get_public_state');
    state.publicState = data;
    renderPublicState();
  } catch (error) {
    console.error(error);
    if (!silent) {
      renderPublicStateError();
    }
  }
}

function renderPublicState() {
  if (!state.publicState) return;

  const { participant_count: count, draw_done: drawDone } = state.publicState;

  let countText = '';
  if (count === 0) {
    countText = 'Aún no hay participantes. ¡Sé el primero!';
  } else if (count === 1) {
    countText = '1 participante registrado.';
  } else {
    countText = `${count} participantes registrados.`;
  }

  if (drawDone) {
    countText += ' Sorteo realizado.';
  }

  const countElement = $('#participant-count');
  if (countElement) countElement.textContent = countText;

  renderStateBanner();
  applyRegistrationAvailability();
}

function renderStateBanner() {
  const banner = $('#state-banner');
  if (!banner || !state.publicState) return;

  const { draw_done: drawDone, registration_open: registrationOpen } =
    state.publicState;

  let title = '';
  let text = '';
  let warning = false;

  if (drawDone) {
    title = 'El sorteo ya se realizó';
    text = registrationOpen
      ? 'Si ya estabas registrado, consulta tu asignación con tu nombre y talla. Si te registras ahora, el administrador deberá ejecutar el segundo sorteo para integrarte.'
      : 'El registro está cerrado. Si ya participaste, consulta tu asignación con tu nombre y talla.';
  } else if (!registrationOpen) {
    title = 'El registro está cerrado';
    text = 'El administrador cerró la entrada de participantes. Si ya estás registrado, espera a que se realice el sorteo.';
    warning = true;
  }

  if (!title) {
    banner.hidden = true;
    return;
  }

  banner.hidden = false;
  banner.classList.toggle('is-warning', warning);
  $('#state-banner-title').textContent = title;
  $('#state-banner-text').textContent = text;
}

function applyRegistrationAvailability() {
  if (!state.configured) return;

  const registrationOpen = state.publicState?.registration_open ?? true;
  const drawDone = Boolean(state.publicState?.draw_done);
  const form = $('#registration-form');
  const closedNotice = $('#registration-closed');
  const lateNotice = $('#registration-late-note');
  const successPanel = $('#registration-success');

  if (!form || !closedNotice || !lateNotice || !successPanel) return;

  const showSuccess = state.successVisible;

  form.hidden = !registrationOpen || showSuccess;
  closedNotice.hidden = registrationOpen || showSuccess;
  lateNotice.hidden = !drawDone || !registrationOpen || showSuccess;
  successPanel.hidden = !showSuccess;

  $$('#registration-form input, #registration-form button').forEach(
    (element) => {
      element.disabled = !registrationOpen || state.registerBusy;
    }
  );
}

function showSetupState() {
  const banner = $('#state-banner');
  if (banner) {
    banner.hidden = false;
    banner.classList.add('is-warning');
    $('#state-banner-title').textContent = 'Falta conectar la base de datos';
    $('#state-banner-text').textContent =
      'Completa assets/config.js con la URL y la clave pública de tu proyecto de Supabase. En el README están todos los pasos.';
  }

  const countElement = $('#participant-count');
  if (countElement) countElement.textContent = 'Configuración pendiente';

  $$(
    '#registration-form input, #registration-form button, #lookup-form input, #lookup-form button'
  ).forEach((element) => {
    element.disabled = true;
  });

  const closedNotice = $('#registration-closed');
  if (closedNotice) closedNotice.hidden = true;

  const lateNotice = $('#registration-late-note');
  if (lateNotice) lateNotice.hidden = true;
}

function renderPublicStateError() {
  const banner = $('#state-banner');
  if (banner) {
    banner.hidden = false;
    banner.classList.add('is-warning');
    $('#state-banner-title').textContent = 'No pudimos cargar el estado';
    $('#state-banner-text').textContent =
      'Revisa tu conexión y la configuración de Supabase. Luego recarga la página o vuelve a intentarlo.';
  }

  const countElement = $('#participant-count');
  if (countElement) countElement.textContent = 'Estado no disponible';
}

function validatePersonFields({ first, last, size }) {
  let valid = true;

  const firstName = cleanText(first.input.value);
  const lastName = cleanText(last.input.value);
  const shoeSize = cleanText(size.input.value);

  if (!firstName) {
    setFieldError(first.input, first.error, 'Escribe tu nombre.');
    valid = false;
  } else if (firstName.length > 60) {
    setFieldError(first.input, first.error, 'El nombre es demasiado largo.');
    valid = false;
  }

  if (!lastName) {
    setFieldError(last.input, last.error, 'Escribe tu apellido.');
    valid = false;
  } else if (lastName.length > 60) {
    setFieldError(last.input, last.error, 'El apellido es demasiado largo.');
    valid = false;
  }

  if (!shoeSize) {
    setFieldError(
      size.input,
      size.error,
      'Escribe tu talla de calzado.'
    );
    valid = false;
  } else if (shoeSize.length > 20) {
    setFieldError(
      size.input,
      size.error,
      'La talla es demasiado larga. Usa un formato como 42 o 8.5 US.'
    );
    valid = false;
  }

  if (!valid) return null;

  return {
    first_name: firstName,
    last_name: lastName,
    shoe_size: shoeSize,
  };
}

async function handleRegistration(event) {
  event.preventDefault();
  if (state.registerBusy) return;

  const form = event.currentTarget;
  clearFormErrors(form);

  const values = validatePersonFields({
    first: {
      input: $('#reg-first-name'),
      error: $('#reg-first-name-error'),
    },
    last: {
      input: $('#reg-last-name'),
      error: $('#reg-last-name-error'),
    },
    size: {
      input: $('#reg-shoe-size'),
      error: $('#reg-shoe-size-error'),
    },
  });

  if (!values) {
    form.querySelector('.is-invalid')?.focus();
    return;
  }

  const submitButton = $('#registration-submit');
  state.registerBusy = true;
  setButtonLoading(submitButton, true, 'Registrando…');
  applyRegistrationAvailability();

  try {
    const data = await callRpc('register_participant', {
      p_first_name: values.first_name,
      p_last_name: values.last_name,
      p_shoe_size: values.shoe_size,
    });

    if (!data?.ok || !data.participant) {
      throw new Error('El servidor no confirmó el registro. Intenta nuevamente.');
    }

    const participant = data.participant;
    state.lastRegistration = participant;
    state.successParticipant = participant;
    state.successVisible = true;

    saveLastRegistration(participant);
    showRegistrationSuccess(participant, Boolean(data.draw_done));
    prefillLookup(participant);

    await refreshPublicState({ silent: true });
    applyRegistrationAvailability();

    showToast('¡Registro exitoso!', 'success');

    $('#registration-success')?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  } catch (error) {
    const message = readableError(error);
    setFormError($('#registration-error'), message);
    showToast(message, 'error');

    if (/registro está cerrado/i.test(message)) {
      refreshPublicState({ silent: true });
    }
  } finally {
    state.registerBusy = false;
    setButtonLoading(submitButton, false);
    applyRegistrationAvailability();
  }
}

function showRegistrationSuccess(participant, drawDone) {
  const nameElement = $('#success-name');
  const sizeElement = $('#success-size');
  const noteElement = $('#success-draw-note');
  const panel = $('#registration-success');

  if (nameElement) nameElement.textContent = fullName(participant);
  if (sizeElement) sizeElement.textContent = participant.shoe_size;

  if (noteElement) {
    noteElement.textContent = drawDone
      ? 'El sorteo ya se realizó. Tu registro será integrado cuando el administrador ejecute el segundo sorteo; después podrás consultar tu asignación aquí.'
      : 'Guarda estos datos. Cuando el administrador realice el sorteo, podrás consultar abajo a quién te toca regalar.';
  }

  if (panel) panel.hidden = false;
}

function prefillLookup(participant) {
  if (!participant) return;

  const first = $('#look-first-name');
  const last = $('#look-last-name');
  const size = $('#look-shoe-size');

  if (first) first.value = participant.first_name ?? '';
  if (last) last.value = participant.last_name ?? '';
  if (size) size.value = participant.shoe_size ?? '';

  const hint = $('#saved-data-hint');
  if (hint) hint.hidden = false;
}

function handleSuccessLookup() {
  const participant = state.successParticipant || state.lastRegistration;
  if (!participant) return;

  prefillLookup(participant);

  $('#mi-sorteo')?.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  });

  window.setTimeout(() => {
    $('#lookup-form')?.requestSubmit();
  }, 320);
}

function handleAnotherRegistration() {
  state.successVisible = false;
  state.successParticipant = null;

  const form = $('#registration-form');
  if (form) {
    form.reset();
    clearFormErrors(form);
  }

  applyRegistrationAvailability();
  $('#registro')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  window.setTimeout(() => {
    $('#reg-first-name')?.focus({ preventScroll: true });
  }, 300);
}

async function handleLookup(event) {
  event.preventDefault();
  if (state.lookupBusy) return;

  const form = event.currentTarget;
  clearFormErrors(form);

  const values = validatePersonFields({
    first: {
      input: $('#look-first-name'),
      error: $('#look-first-name-error'),
    },
    last: {
      input: $('#look-last-name'),
      error: $('#look-last-name-error'),
    },
    size: {
      input: $('#look-shoe-size'),
      error: $('#look-shoe-size-error'),
    },
  });

  if (!values) {
    form.querySelector('.is-invalid')?.focus();
    return;
  }

  const submitButton = $('#lookup-submit');
  state.lookupBusy = true;
  setButtonLoading(submitButton, true, 'Consultando…');

  const result = $('#lookup-result');
  if (result) result.hidden = true;

  try {
    const data = await callRpc('get_my_assignment', {
      p_first_name: values.first_name,
      p_last_name: values.last_name,
      p_shoe_size: values.shoe_size,
    });

    renderLookupResult(data);
  } catch (error) {
    const message = readableError(error);
    setFormError($('#lookup-error'), message);
    showToast(message, 'error');
  } finally {
    state.lookupBusy = false;
    setButtonLoading(submitButton, false);
  }
}

function renderLookupResult(data) {
  const container = $('#lookup-result');
  const notFound = $('#lookup-not-found');
  const pending = $('#lookup-pending');
  const assignment = $('#lookup-assignment');
  const owner = $('#lookup-owner');

  if (!container || !notFound || !pending || !assignment || !owner) return;

  container.hidden = false;
  notFound.hidden = true;
  pending.hidden = true;
  assignment.hidden = true;
  owner.hidden = true;
  state.assignment = null;

  if (!data?.found) {
    notFound.hidden = false;
  } else {
    owner.textContent = `Consulta para ${fullName(
      data.participant
    )} · Talla ${data.participant.shoe_size}`;
    owner.hidden = false;

    if (data.has_assignment && data.receiver) {
      const receiverName = $('#receiver-name');
      const receiverSize = $('#receiver-size');

      if (receiverName) receiverName.textContent = fullName(data.receiver);
      if (receiverSize) receiverSize.textContent = data.receiver.shoe_size;

      assignment.hidden = false;
      state.assignment = data;
    } else {
      const kicker = $('#lookup-pending-kicker');
      const title = $('#lookup-pending-title');
      const text = $('#lookup-pending-text');

      if (data.draw_done) {
        if (kicker) kicker.textContent = 'Falta integrarte';
        if (title) title.textContent = 'Tu registro está listo';
        if (text) {
          text.textContent =
            'El sorteo ya se realizó, pero tu registro todavía no tiene asignación. El administrador debe ejecutar el segundo sorteo para incluirte. Vuelve a consultar después de que lo haga.';
        }
      } else {
        if (kicker) kicker.textContent = 'Aún falta el sorteo';
        if (title) title.textContent = 'Tu registro está listo';
        if (text) {
          text.textContent =
            'El administrador todavía no ha realizado el sorteo. Cuando lo haga, vuelve a consultar con tu nombre y talla para descubrir a quién te toca regalar.';
        }
      }

      pending.hidden = false;
    }
  }

  requestAnimationFrame(() => {
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

function handleClearSavedData() {
  clearLastRegistration();
  state.lastRegistration = null;

  const form = $('#lookup-form');
  if (form) {
    form.reset();
    clearFormErrors(form);
  }

  const hint = $('#saved-data-hint');
  if (hint) hint.hidden = true;

  const result = $('#lookup-result');
  if (result) result.hidden = true;

  state.assignment = null;

  showToast('Datos guardados borrados de este dispositivo.', 'info');
}

async function handleCopyAssignment() {
  if (!state.assignment?.receiver) return;

  const receiver = state.assignment.receiver;
  const message = `Te toca regalarle a: ${fullName(receiver)}. Talla de calzado: ${receiver.shoe_size}. 🎁`;

  const copied = await copyText(message);
  showToast(
    copied
      ? 'Mensaje copiado. Guárdalo en un lugar privado.'
      : 'No pudimos copiar el mensaje. Intenta seleccionarlo manualmente.',
    copied ? 'success' : 'error'
  );
}
