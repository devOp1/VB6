import { el } from '../core/core.js';
import { icon } from '../ide/ui.js';
import { getStoredApiKey, CLAUDE_MODELS, CLAUDE_DEFAULT_MODEL } from './claude-api.js';
import { openClaudeKeyDialog } from './key-dialog.js';

export class AiAgentPanel {
  constructor(aiService, ide) {
    this.aiService = aiService;
    this.ide = ide;
    this.key = 'tool:ai';
    this.title = 'AI Agent';
    this.glyph = 'properties';
    this.width = 860;
    this.height = 620;
    this.runningController = null;

    this.root = el('div', { class: 'ai-agent-panel' });
    this.status = el('div', { class: 'tool-status ai-agent-status', role: 'status' }, 'Ready');

    this.buildHeader();
    this.buildMessagesArea();
    this.buildSuggestionsBar();
    this.buildInputArea();

    this.root.append(this.header, this.messagesContainer, this.suggestionsBar, this.inputContainer, this.status);
    this.refreshKeyStatus();
    this.loadModels(false);
  }

  buildHeader() {
    const options = CLAUDE_MODELS.length > 0
      ? CLAUDE_MODELS.map(m => el('option', { value: m.id }, m.name || m.id))
      : [el('option', { value: '' }, 'Loading models…')];

    this.modelSelect = el('select', {
      class: 'ai-model-select',
      'aria-label': 'Claude Model',
      onchange: () => {
        if (this.aiService?.client) {
          this.aiService.client.model = this.modelSelect.value;
        }
      }
    }, ...options);

    this.refreshModelsBtn = el('button', {
      type: 'button',
      class: 'tool-button',
      title: 'Refresh available models from Claude API',
      onclick: () => this.loadModels(true)
    }, icon('refresh', 12), 'Refresh');

    this.keyStatusBadge = el('button', {
      type: 'button',
      class: 'ai-key-badge',
      title: 'Configure Claude API Key',
      onclick: async () => {
        await openClaudeKeyDialog(this.ide);
        this.refreshKeyStatus();
        this.loadModels(false);
      }
    });

    this.clearBtn = el('button', {
      type: 'button',
      class: 'tool-button',
      title: 'Clear conversation history',
      onclick: () => this.clearHistory()
    }, icon('delete', 12), 'Clear');

    const toolbar = el('div', { class: 'object-toolbar ai-toolbar' },
      el('span', { class: 'ai-toolbar-label' }, 'Model:'),
      this.modelSelect,
      this.refreshModelsBtn,
      this.keyStatusBadge,
      el('div', { style: { flex: '1' } }),
      this.clearBtn
    );

    this.header = toolbar;
  }

  buildMessagesArea() {
    this.messagesContainer = el('div', { class: 'ai-messages-list', tabindex: 0, 'aria-label': 'AI Conversation' });
    this.renderWelcome();
  }

  renderWelcome() {
    this.messagesContainer.replaceChildren(
      el('div', { class: 'ai-welcome-box' },
        el('h4', {}, 'Visual Basic 6 AI Agent'),
        el('p', {}, 'The AI Agent can inspect your open project, write or refactor code, design forms, add controls, and check syntax automatically.'),
        el('p', { class: 'ai-welcome-hint' }, 'Type your instruction below or select a quick action to get started.')
      )
    );
  }

  buildSuggestionsBar() {
    const suggestions = [
      { label: 'Inspect Project', prompt: 'Inspect the project structure and summarize the forms and modules.' },
      { label: 'Check Syntax & Fix', prompt: 'Compile the project, check for any syntax errors or issues, and fix them.' },
      { label: 'Add Button to Form', prompt: 'Add a new CommandButton to the active form with a click event handler.' },
      { label: 'Add Error Handling', prompt: 'Inspect the code and add standard VB6 error handling (On Error GoTo) to key procedures.' }
    ];

    this.suggestionsBar = el('div', { class: 'ai-suggestions-bar' },
      el('span', { class: 'ai-suggestions-label' }, 'Suggestions:'),
      ...suggestions.map(s => el('button', {
        type: 'button',
        class: 'ai-suggestion-chip',
        onclick: () => {
          this.promptInput.value = s.prompt;
          this.promptInput.focus();
        }
      }, s.label))
    );
  }

  buildInputArea() {
    this.promptInput = el('textarea', {
      class: 'ai-prompt-input',
      placeholder: 'Ask the AI agent to edit code, add controls, create forms, fix errors, or build features... (Ctrl+Enter to run)',
      rows: 3,
      spellcheck: false,
      'aria-label': 'AI Prompt'
    });

    this.promptInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        this.run();
      }
    });

    this.runBtn = el('button', {
      type: 'button',
      class: 'default-button ai-run-btn',
      onclick: () => this.run()
    }, icon('run', 14), 'Run Agent');

    this.stopBtn = el('button', {
      type: 'button',
      class: 'tool-button ai-stop-btn',
      style: { display: 'none' },
      onclick: () => this.stop()
    }, icon('stop', 14), 'Cancel');

    const actions = el('div', { class: 'ai-input-actions' },
      el('span', { class: 'ai-input-hint' }, 'Ctrl+Enter to send'),
      this.stopBtn,
      this.runBtn
    );

    this.inputContainer = el('div', { class: 'ai-input-pane' },
      this.promptInput,
      actions
    );
  }

  refreshKeyStatus() {
    const key = getStoredApiKey();
    if (key) {
      this.keyStatusBadge.textContent = 'API Key: Set ✓';
      this.keyStatusBadge.classList.add('ai-key-ok');
      this.keyStatusBadge.classList.remove('ai-key-missing');
    } else {
      this.keyStatusBadge.textContent = 'Set Claude Key ⚠️';
      this.keyStatusBadge.classList.add('ai-key-missing');
      this.keyStatusBadge.classList.remove('ai-key-ok');
    }
  }

  async loadModels(showToast = false) {
    if (!this.aiService?.client?.listModels) return;
    const currentVal = this.modelSelect.value;
    try {
      if (showToast) {
        this.status.textContent = 'Fetching models list from Claude API…';
      }
      const models = await this.aiService.client.listModels();
      if (Array.isArray(models) && models.length > 0) {
        this.modelSelect.replaceChildren(
          ...models.map(m => el('option', { value: m.id }, m.name || m.id))
        );
        if (currentVal && models.some(m => m.id === currentVal)) {
          this.modelSelect.value = currentVal;
        } else {
          this.modelSelect.value = models[0].id;
        }
        if (this.aiService?.client) {
          this.aiService.client.model = this.modelSelect.value;
        }
        if (showToast) {
          this.status.textContent = `Loaded ${models.length} Claude models.`;
        }
      }
    } catch (err) {
      if (showToast) {
        this.status.textContent = 'Could not load models: ' + (err?.message || err);
      }
    }
  }

  clearHistory() {
    this.aiService.agent.clearHistory();
    this.renderWelcome();
    this.status.textContent = 'Conversation cleared.';
  }

  appendUserMessage(text) {
    if (this.messagesContainer.querySelector('.ai-welcome-box')) {
      this.messagesContainer.replaceChildren();
    }
    const bubble = el('div', { class: 'ai-message ai-message-user' },
      el('div', { class: 'ai-message-header' }, 'User:'),
      el('div', { class: 'ai-message-text' }, text)
    );
    this.messagesContainer.append(bubble);
    this.scrollToBottom();
  }

  appendActivityItem(activity) {
    let item;
    if (activity.type === 'tool_call') {
      let desc = activity.name;
      if (activity.name === 'read_module') desc = `Read module: ${activity.input?.module}`;
      else if (activity.name === 'write_module') desc = `Modify module: ${activity.input?.module}`;
      else if (activity.name === 'add_module') desc = `Add ${activity.input?.kind}: ${activity.input?.name}`;
      else if (activity.name === 'add_control') desc = `Add control: ${activity.input?.type} on ${activity.input?.module}`;
      else if (activity.name === 'check_syntax') desc = `Check project syntax`;
      else if (activity.name === 'get_form_designer') desc = `Inspect form: ${activity.input?.module}`;
      else if (activity.name === 'get_project_summary') desc = `Inspect project structure`;

      item = el('div', { class: 'ai-activity-item ai-tool-call' },
        icon('object', 12),
        el('span', { class: 'ai-activity-name' }, desc)
      );
    } else if (activity.type === 'tool_result') {
      const isErr = activity.isError;
      let summary = 'Completed';
      if (isErr) summary = 'Failed: ' + (activity.result?.error || 'Error');
      else if (activity.name === 'check_syntax') {
        summary = activity.result?.valid ? 'Syntax valid (0 errors)' : `Syntax errors: ${activity.result?.errorCount}`;
      } else if (activity.result?.message) {
        summary = activity.result.message;
      }

      item = el('div', { class: 'ai-activity-item ai-tool-result' + (isErr ? ' is-error' : '') },
        icon(isErr ? 'close' : 'check', 12),
        el('span', {}, summary)
      );
    } else if (activity.type === 'assistant_text') {
      item = el('div', { class: 'ai-message ai-message-assistant' },
        el('div', { class: 'ai-message-header' }, 'Claude:'),
        el('div', { class: 'ai-message-text' }, activity.text)
      );
    }

    if (item) {
      this.messagesContainer.append(item);
      this.scrollToBottom();
    }
  }

  scrollToBottom() {
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  setRunning(running) {
    this.runBtn.style.display = running ? 'none' : 'inline-flex';
    this.stopBtn.style.display = running ? 'inline-flex' : 'none';
    this.promptInput.disabled = running;
    this.modelSelect.disabled = running;
    this.refreshModelsBtn.disabled = running;
    this.clearBtn.disabled = running;
  }

  async run() {
    const prompt = this.promptInput.value.trim();
    if (!prompt) return;

    if (!getStoredApiKey()) {
      const opened = await openClaudeKeyDialog(this.ide);
      this.refreshKeyStatus();
      if (!getStoredApiKey()) {
        this.status.textContent = 'Please configure a Claude API Key to use the AI Agent.';
        return;
      }
    }

    this.promptInput.value = '';
    this.appendUserMessage(prompt);
    this.setRunning(true);
    this.status.textContent = 'AI Agent is starting…';

    const controller = new AbortController();
    this.runningController = controller;

    try {
      const model = this.modelSelect.value;
      const result = await this.aiService.agent.runPrompt(prompt, {
        signal: controller.signal,
        model,
        onStatus: (statusText) => {
          this.status.textContent = statusText;
        },
        onActivity: (activity) => {
          this.appendActivityItem(activity);
        }
      });

      this.status.textContent = 'Ready';
      this.ide.status?.('AI Agent completed project updates.');
    } catch (error) {
      if (error?.name === 'AbortError' || error.message?.includes('cancelled')) {
        this.status.textContent = 'AI Agent was cancelled.';
        this.appendActivityItem({
          type: 'assistant_text',
          text: 'Operation was cancelled by user.'
        });
      } else {
        this.status.textContent = 'Error: ' + error.message;
        this.appendActivityItem({
          type: 'assistant_text',
          text: '⚠️ Error: ' + error.message
        });
      }
    } finally {
      this.runningController = null;
      this.setRunning(false);
      this.promptInput.focus();
    }
  }

  stop() {
    if (this.runningController) {
      this.runningController.abort();
    }
  }

  refresh() {
    this.refreshKeyStatus();
    this.loadModels(false);
  }

  dispose() {
    this.stop();
  }
}
