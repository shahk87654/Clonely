'use strict';

function nextPath() {
  const params = new URLSearchParams(window.location.search);
  const next = params.get('next') || '/app';
  return next.startsWith('/') ? next : '/app';
}

function showError(message) {
  const el = document.getElementById('auth-error');
  if (!el) return;
  el.hidden = !message;
  el.textContent = message || '';
}

async function submitAuth(path, payload) {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  if (data.token) localStorage.setItem('clonely_token', data.token);
  window.location.href = nextPath();
}

function requestedPlan() {
  const plan = new URLSearchParams(window.location.search).get('plan');
  return ['free', 'pro', 'team'].includes(plan) ? plan : 'free';
}

const signupPlanCopy = document.getElementById('signup-plan-copy');
const selectedPlan = requestedPlan();
if (signupPlanCopy && selectedPlan !== 'free') {
  signupPlanCopy.textContent = `${selectedPlan === 'pro' ? 'Pro' : 'Team'} starts immediately in demo billing. No card is required.`;
}

const loginForm = document.getElementById('login-form');
loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  const button = document.getElementById('auth-submit');
  if (button) button.disabled = true;
  try {
    await submitAuth('/api/auth/login', {
      email: loginForm.email.value.trim(),
      password: loginForm.password.value,
    });
  } catch (error) {
    showError(error.message);
    if (button) button.disabled = false;
  }
});

const signupForm = document.getElementById('signup-form');
signupForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  const button = document.getElementById('auth-submit');
  if (button) button.disabled = true;
  try {
    await submitAuth('/api/auth/signup', {
      name: signupForm.name.value.trim(),
      email: signupForm.email.value.trim(),
      company: signupForm.company.value.trim(),
      password: signupForm.password.value,
      plan: requestedPlan(),
    });
  } catch (error) {
    showError(error.message);
    if (button) button.disabled = false;
  }
});
