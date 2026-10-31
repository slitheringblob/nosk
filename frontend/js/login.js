import { api, ApiError, NetworkError } from './api-client.js';
import { auth } from './auth.js';

const $ = (selector) => document.querySelector(selector);
const params = new URLSearchParams(window.location.search);
let mode = 'login';

function message(error) {
    if (error instanceof NetworkError) return 'Cannot reach the nosk server. Is the backend running?';
    if (error instanceof ApiError) return error.details?.[0]?.message || error.message;
    return 'Something went wrong';
}

function notice(text, type = 'info') {
    const box = $('#auth-notice');
    box.textContent = text;
    box.dataset.type = type;
    box.hidden = !text;
}

function showForm(id) {
    ['#auth-form', '#forgot-form', '#reset-form'].forEach((selector) => {
        $(selector).hidden = selector !== id;
    });
    document.querySelector('.tabs').hidden = id !== '#auth-form';
}

function setMode(next) {
    mode = next;
    document
        .querySelectorAll('[data-mode]')
        .forEach((tab) => tab.classList.toggle('is-active', tab.dataset.mode === next));
    $('#auth-submit').textContent = next === 'login' ? '$ sign in' : '$ create account';
    $('#password').autocomplete = next === 'login' ? 'current-password' : 'new-password';
    $('#forgot').hidden = next !== 'login';
    $('#auth-error').textContent = '';
}

document
    .querySelectorAll('[data-mode]')
    .forEach((tab) => tab.addEventListener('click', () => setMode(tab.dataset.mode)));

$('#auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = $('#email').value.trim();
    const password = $('#password').value;
    const error = $('#auth-error');
    error.textContent = '';
    if (!email || !$('#email').checkValidity()) {
        error.textContent = 'Enter a valid email address.';
        return;
    }
    if (mode === 'register' && password.length < 8) {
        error.textContent = 'Passwords need at least 8 characters.';
        return;
    }
    const button = $('#auth-submit');
    button.disabled = true;
    try {
        if (mode === 'login') await api.login(email, password);
        else await api.register(email, password);
        window.location.replace('index.html');
    } catch (err) {
        error.textContent = message(err);
    } finally {
        button.disabled = false;
    }
});

$('#forgot').addEventListener('click', () => {
    $('#forgot-email').value = $('#email').value;
    showForm('#forgot-form');
});
document.querySelector('[data-back]').addEventListener('click', () => showForm('#auth-form'));

$('#forgot-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
        await api.requestPasswordReset($('#forgot-email').value.trim());
        notice('If that account exists, a reset link is on its way.');
        showForm('#auth-form');
    } catch (err) {
        notice(message(err), 'error');
    }
});

$('#reset-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
        await api.resetPassword(params.get('reset'), $('#new-password').value);
        history.replaceState(null, '', 'login.html');
        notice('Password updated. Sign in with your new password.', 'success');
        showForm('#auth-form');
    } catch (err) {
        $('#reset-error').textContent = message(err);
    }
});

async function init() {
    if (params.get('verify')) {
        try {
            await api.verifyEmail(params.get('verify'));
            const user = auth.user;
            if (user) auth.updateUser({ ...user, is_verified: true });
            notice('Email verified. Thanks!', 'success');
        } catch (err) {
            notice(message(err), 'error');
        }
        history.replaceState(null, '', 'login.html');
        if (auth.isLoggedIn()) setTimeout(() => window.location.replace('index.html'), 1200);
        return;
    }
    if (params.get('reset')) {
        showForm('#reset-form');
        return;
    }
    if (auth.isLoggedIn()) window.location.replace('index.html');
}

init();
