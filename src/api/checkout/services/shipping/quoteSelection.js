function isFiniteAmount(option) {
  return Number.isFinite(Number(option?.amount)) && Number(option.amount) > 0;
}

function dedupeById(options = []) {
  const seen = new Set();
  const result = [];

  for (const option of options) {
    const key = String(option?.id || '').trim();
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(option);
  }

  return result;
}

function chooseCheapest(options = []) {
  return [...options].sort((a, b) => Number(a.amount) - Number(b.amount))[0] || null;
}

function chooseFastest(options = []) {
  const candidates = options.filter((option) => Number.isFinite(Number(option.estimatedDays)) && Number(option.estimatedDays) > 0);
  if (!candidates.length) {
    return null;
  }

  return [...candidates].sort((a, b) => {
    const dayDelta = Number(a.estimatedDays) - Number(b.estimatedDays);
    return dayDelta !== 0 ? dayDelta : Number(a.amount) - Number(b.amount);
  })[0];
}

function chooseRecommended(options = [], cheapest, fastest) {
  const candidates = options.filter(isFiniteAmount);
  if (!candidates.length) {
    return null;
  }

  const scored = candidates.map((option) => {
    const amount = Number(option.amount);
    const estimatedDays = Number.isFinite(Number(option.estimatedDays)) ? Number(option.estimatedDays) : 7;
    const priceScore = cheapest ? amount / Math.max(Number(cheapest.amount), 0.01) : 1;
    const speedScore = fastest ? estimatedDays / Math.max(Number(fastest.estimatedDays) || 1, 1) : 1;

    return {
      option,
      score: priceScore * 0.65 + speedScore * 0.35,
    };
  });

  scored.sort((a, b) => a.score - b.score || Number(a.option.amount) - Number(b.option.amount));
  return scored[0]?.option || null;
}

function buildHighlights(options = []) {
  const valid = options.filter(isFiniteAmount);
  const cheapest = chooseCheapest(valid);
  const fastest = chooseFastest(valid) || cheapest;
  const recommended = chooseRecommended(valid, cheapest, fastest) || cheapest || fastest;

  const tagged = dedupeById(
    [cheapest, fastest, recommended]
      .filter(Boolean)
      .map((option) => ({
        ...option,
        tags: [
          cheapest?.id === option.id ? 'cheapest' : null,
          fastest?.id === option.id ? 'fastest' : null,
          recommended?.id === option.id ? 'recommended' : null,
        ].filter(Boolean),
      }))
  );

  return {
    cheapest: tagged.find((option) => option.tags.includes('cheapest')) || null,
    fastest: tagged.find((option) => option.tags.includes('fastest')) || null,
    recommended: tagged.find((option) => option.tags.includes('recommended')) || null,
    options: tagged,
  };
}

module.exports = {
  buildHighlights,
};
