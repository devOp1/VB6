export const STORAGE_KEY_CLAUDE_KEY = 'vb6-studio-web.claude-api-key.v1';
export const CLAUDE_DEFAULT_MODEL = '';
export const CLAUDE_MODELS = Object.freeze([]);

let inMemoryApiKey = '';

export function getStoredApiKey() {
  if (inMemoryApiKey) return inMemoryApiKey;
  try {
    const key = localStorage.getItem(STORAGE_KEY_CLAUDE_KEY);
    if (key && typeof key === 'string') return key.trim();
  } catch {}
  return '';
}

export function setStoredApiKey(key, persist = true) {
  const trimmed = typeof key === 'string' ? key.trim() : '';
  inMemoryApiKey = trimmed;
  if (persist) {
    try {
      if (trimmed) localStorage.setItem(STORAGE_KEY_CLAUDE_KEY, trimmed);
      else localStorage.removeItem(STORAGE_KEY_CLAUDE_KEY);
    } catch {}
  }
  return trimmed;
}

export function clearStoredApiKey() {
  inMemoryApiKey = '';
  try {
    localStorage.removeItem(STORAGE_KEY_CLAUDE_KEY);
  } catch {}
}

export class ClaudeApiClient {
  constructor({ apiKey = '', baseUrl = 'https://api.anthropic.com/v1/messages', model = CLAUDE_DEFAULT_MODEL, fetchFn = globalThis.fetch?.bind(globalThis) } = {}) {
    this.apiKey = apiKey || getStoredApiKey();
    this.baseUrl = baseUrl;
    this.model = model;
    this.fetchFn = typeof fetchFn === 'function' ? fetchFn : globalThis.fetch?.bind(globalThis);
  }

  setApiKey(key) {
    this.apiKey = typeof key === 'string' ? key.trim() : '';
  }

  getModelsUrl() {
    if (this.baseUrl.includes('/v1/messages')) {
      return this.baseUrl.replace('/v1/messages', '/v1/models');
    }
    if (this.baseUrl.endsWith('/messages')) {
      return this.baseUrl.replace(/\/messages\/?$/, '/models');
    }
    return 'https://api.anthropic.com/v1/models';
  }

  async fetchModels({ signal } = {}) {
    const key = this.apiKey || getStoredApiKey();
    if (!key) {
      throw new Error('Claude API key is not configured.');
    }

    const modelsUrl = this.getModelsUrl();
    let response;
    try {
      response = await this.fetchFn(modelsUrl, {
        method: 'GET',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        signal
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new Error('Failed to fetch models from Claude API: ' + (error?.message || String(error)));
    }

    if (!response.ok) {
      let errorDetails = '';
      try {
        const errorJson = await response.json();
        errorDetails = errorJson?.error?.message || JSON.stringify(errorJson);
      } catch {
        try {
          errorDetails = await response.text();
        } catch {}
      }
      throw new Error(`Claude API error (${response.status}): ${errorDetails || response.statusText}`);
    }

    const json = await response.json();
    const rawList = Array.isArray(json?.data) ? json.data : (Array.isArray(json) ? json : []);

    const models = rawList
      .filter(item => item && (item.id || item.name))
      .map(item => {
        const id = item.id || item.name;
        const displayName = item.display_name || item.name || id;
        return {
          id,
          name: displayName !== id ? `${displayName} (${id})` : displayName,
          displayName,
          createdAt: item.created_at || ''
        };
      });

    return models;
  }

  async listModels({ signal } = {}) {
    try {
      const fetched = await this.fetchModels({ signal });
      if (fetched && fetched.length > 0) {
        if (!this.model) {
          this.model = fetched[0].id;
        }
        return fetched;
      }
    } catch {}
    return CLAUDE_MODELS.map(m => ({ ...m }));
  }

  async sendMessage({ system, messages = [], tools, maxTokens = 4096, temperature, signal, model } = {}) {
    const key = this.apiKey || getStoredApiKey();
    if (!key) {
      throw new Error('Claude API key is not configured. Please set your API key in Tools → Claude API Key…');
    }

    let targetModel = model || this.model;
    if (!targetModel) {
      try {
        const models = await this.listModels({ signal });
        if (models && models.length > 0) {
          targetModel = models[0].id;
          this.model = targetModel;
        }
      } catch {}
    }

    if (!targetModel) {
      throw new Error('No Claude model selected or available.');
    }

    const payload = {
      model: targetModel,
      max_tokens: maxTokens,
      messages
    };

    if (typeof temperature === 'number') {
      payload.temperature = temperature;
    }

    if (system) {
      payload.system = system;
    }

    if (Array.isArray(tools) && tools.length > 0) {
      payload.tools = tools;
    }

    let response;
    try {
      response = await this.fetchFn(this.baseUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify(payload),
        signal
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new Error('Failed to connect to Claude API: ' + (error?.message || String(error)));
    }

    if (!response.ok) {
      let errorDetails = '';
      try {
        const errorJson = await response.json();
        errorDetails = errorJson?.error?.message || JSON.stringify(errorJson);
      } catch {
        try {
          errorDetails = await response.text();
        } catch {}
      }

      if (response.status === 401) {
        throw new Error('Invalid Claude API key. Please check your key in Tools → Claude API Key… (' + (errorDetails || 'Unauthorized') + ')');
      } else if (response.status === 429) {
        throw new Error('Claude API rate limit reached: ' + (errorDetails || 'Please try again in a moment.'));
      } else {
        throw new Error(`Claude API error (${response.status}): ${errorDetails || response.statusText}`);
      }
    }

    return await response.json();
  }
}
