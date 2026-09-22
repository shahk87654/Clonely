'use strict';

const planOrder = ['free', 'pro', 'team'];

function planHref(planId) {
  return `/signup?plan=${encodeURIComponent(planId)}`;
}

function renderLandingPlans(plans) {
  const grid = document.getElementById('landing-plans');
  if (!grid || !Array.isArray(plans) || !plans.length) return;

  const orderedPlans = [...plans].sort(
    (left, right) => planOrder.indexOf(left.id) - planOrder.indexOf(right.id),
  );
  grid.replaceChildren();

  orderedPlans.forEach((plan) => {
    const card = document.createElement('article');
    card.className = `price-card ${plan.id === 'pro' ? 'featured' : ''}`;

    const title = document.createElement('h3');
    title.textContent = plan.name;
    const price = document.createElement('p');
    price.className = 'price';
    price.textContent = plan.priceLabel;
    if (plan.interval === 'month') {
      const interval = document.createElement('span');
      interval.textContent = '/mo';
      price.append(interval);
    }

    const list = document.createElement('ul');
    (plan.features || []).forEach((feature) => {
      const item = document.createElement('li');
      item.textContent = feature;
      list.append(item);
    });

    const link = document.createElement('a');
    link.className = plan.id === 'pro' ? 'btn-accent' : 'btn-ghost';
    link.href = planHref(plan.id);
    link.textContent = `Activate ${plan.name}`;
    card.append(title, price, list, link);
    grid.append(card);
  });
}

async function loadLandingPlans() {
  try {
    const response = await fetch('/api/plans', { credentials: 'same-origin' });
    if (!response.ok) return;
    const data = await response.json();
    renderLandingPlans(data.plans);
  } catch {
    // The server-rendered cards remain available when the API is unavailable.
  }
}

loadLandingPlans();
