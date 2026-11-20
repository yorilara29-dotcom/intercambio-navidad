export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizeForSearch(value) {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function fullName(person) {
  return cleanText(`${person?.first_name ?? ''} ${person?.last_name ?? ''}`);
}

export function initials(firstName, lastName) {
  return `${cleanText(firstName).charAt(0)}${cleanText(lastName).charAt(0)}`.toUpperCase();
}

export function pluralize(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function readableError(error) {
  console.error('[Tora No Maki]', error);

  const raw = String(
    error?.message || error?.error_description || error || ''
  ).trim();

  if (/Invalid login credentials|invalid_grant/i.test(raw)) {
    return 'Email o contraseña incorrectos.';
  }
  if (/Email not confirmed/i.test(raw)) {
    return 'La cuenta todavía no está confirmada.';
  }
  if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(raw)) {
    return 'No pudimos conectar. Revisa tu conexión e intenta nuevamente.';
  }
  if (/rate limit|too many requests/i.test(raw)) {
    return 'Demasiados intentos. Espera unos minutos e inténtalo otra vez.';
  }
  if (/JWT expired|refresh token/i.test(raw)) {
    return 'Tu sesión expiró. Vuelve a iniciar sesión.';
  }
  if (
    raw &&
    !/^(PGRST|PostgrestError|AuthApiError|permission denied)/i.test(raw)
  ) {
    return raw;
  }

  return 'No pudimos completar la operación. Intenta nuevamente.';
}

const originalButtonHtml = new WeakMap();
const previousDisabled = new WeakMap();

export function setButtonLoading(button, loading, label = 'Procesando…') {
  if (!button) return;

  if (loading) {
    if (!originalButtonHtml.has(button)) {
      originalButtonHtml.set(button, button.innerHTML);
    }
    previousDisabled.set(button, button.disabled);
    button.disabled = true;
    button.classList.add('is-loading');
    button.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${label}</span>`;
    return;
  }

  button.disabled = previousDisabled.get(button) ?? false;
  button.classList.remove('is-loading');
  const original = originalButtonHtml.get(button);
  if (original != null) {
    button.innerHTML = original;
  }
  originalButtonHtml.delete(button);
}

let toastTimer = null;

export function showToast(message, type = 'success') {
  const toast = $('#toast');
  if (!toast) return;

  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast toast-${type}`;
  toast.hidden = false;

  requestAnimationFrame(() => {
    toast.classList.add('is-visible');
  });

  toastTimer = window.setTimeout(() => {
    toast.classList.remove('is-visible');
    window.setTimeout(() => {
      toast.hidden = true;
    }, 220);
  }, 4500);
}

export function setFieldError(input, errorElement, message) {
  if (input) {
    input.classList.toggle('is-invalid', Boolean(message));
    if (message) {
      input.setAttribute('aria-invalid', 'true');
    } else {
      input.removeAttribute('aria-invalid');
    }
  }

  if (errorElement) {
    errorElement.textContent = message || '';
    errorElement.hidden = !message;
  }
}

export function setFormError(errorElement, message) {
  if (!errorElement) return;
  errorElement.textContent = message || '';
  errorElement.hidden = !message;
}

export function clearFormErrors(form) {
  if (!form) return;

  $$('.is-invalid', form).forEach((element) => {
    element.classList.remove('is-invalid');
    element.removeAttribute('aria-invalid');
  });

  $$('.field-error, .form-error', form).forEach((element) => {
    element.textContent = '';
    element.hidden = true;
  });
}

export async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Se intenta el método antiguo.
    }
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.inset = '0';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}

export function downloadCsv(filename, headers, rows) {
  const escapeCell = (value) => {
    let text = String(value ?? '');

    // Evita que una celda se interprete como fórmula al abrir el CSV en Excel
    // o LibreOffice (inyección de fórmulas).
    if (/^[=+\-@\t\r]/.test(text)) {
      text = `'${text}`;
    }

    return `"${text.replace(/"/g, '""')}"`;
  };

  const content =
    '\uFEFF' +
    [headers, ...rows]
      .map((row) => row.map(escapeCell).join(';'))
      .join('\r\n');

  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const REGISTRATION_STORAGE_KEY = 'tora-exchange-last-registration-v1';

export function saveLastRegistration(data) {
  try {
    window.localStorage.setItem(
      REGISTRATION_STORAGE_KEY,
      JSON.stringify({ ...data, savedAt: new Date().toISOString() })
    );
  } catch {
    // El almacenamiento puede estar deshabilitado; no es crítico.
  }
}

export function getLastRegistration() {
  try {
    const raw = window.localStorage.getItem(REGISTRATION_STORAGE_KEY);
    if (!raw) return null;

    const data = JSON.parse(raw);
    if (!data?.first_name || !data?.last_name || !data?.shoe_size) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

export function clearLastRegistration() {
  try {
    window.localStorage.removeItem(REGISTRATION_STORAGE_KEY);
  } catch {
    // Sin acción.
  }
}

export function debounce(callback, delay = 160) {
  let timer = null;

  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => callback(...args), delay);
  };
}

export const icons = {
  copy: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg>`,
  trash: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v5M14 11v5"></path></svg>`,
  gift: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="8" width="18" height="4" rx="1"></rect><path d="M5 12v9h14v-9"></path><path d="M12 8v13"></path><path d="M12 8H7.5A2.5 2.5 0 1 1 10 5.5L12 8Z"></path><path d="M12 8h4.5A2.5 2.5 0 1 0 14 5.5L12 8Z"></path></svg>`,
  check: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>`,
  refresh: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"></path><path d="M21 3v6h-6"></path></svg>`,
  download: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg>`,
  search: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>`,
  logout: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><path d="m16 17 5-5-5-5"></path><path d="M21 12H9"></path></svg>`,
  alert: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 3.8 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg>`,
  searchEmpty: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>`,
};
