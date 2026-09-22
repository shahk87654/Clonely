const PROVIDERS = {
  openai: { label: "OpenAI", enabled: false },
  claude: { label: "Claude", enabled: false },
  gemini: { label: "Gemini", enabled: false },
  ollama: { label: "Ollama", enabled: false },
  openrouter: { label: "OpenRouter", enabled: false },
};

function listProviders() {
  return Object.entries(PROVIDERS).map(([id, provider]) => ({ id, ...provider }));
}

// Future integration point:
// Each provider can be adapted to a real transport layer without changing the
// rest of the engine. The current build uses deterministic rule-based behavior.
function getProvider(id = "openai") {
  return PROVIDERS[String(id).toLowerCase()] || PROVIDERS.openai;
}

module.exports = { PROVIDERS, listProviders, getProvider };
