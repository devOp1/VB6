import { el } from '../core/core.js';
import { modal } from '../ide/ui.js';
import { getStoredApiKey, setStoredApiKey, clearStoredApiKey } from './claude-api.js';

export async function openClaudeKeyDialog(ide) {
  const currentKey = getStoredApiKey();
  const maskedKey = currentKey ? (currentKey.length > 10 ? currentKey.slice(0, 7) + '…' + currentKey.slice(-4) : '••••••••') : '';

  const inputKey = el('input', {
    type: 'password',
    class: 'dialog-input ai-key-input',
    placeholder: 'sk-ant-api03-...',
    value: currentKey,
    'aria-label': 'Claude API Key',
    style: { width: '100%', boxSizing: 'border-box', fontFamily: 'monospace' }
  });

  const showKeyCheck = el('input', {
    type: 'checkbox',
    id: 'ai-show-key-checkbox',
    onchange: () => {
      inputKey.type = showKeyCheck.checked ? 'text' : 'password';
    }
  });

  const statusNote = el('div', { class: 'ai-key-status' },
    currentKey
      ? el('p', { style: { color: 'var(--vb-link, #000080)', margin: '4px 0' } }, 'Current API key: ', el('code', {}, maskedKey))
      : el('p', { style: { color: 'var(--vb-gray, #808080)', margin: '4px 0' } }, 'No Claude API key is currently saved.')
  );

  const body = el('div', { class: 'ai-key-dialog-body', style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
    el('p', { style: { margin: '0 0 4px 0' } }, 'Enter your Anthropic Claude API key to enable AI agent features on your open Visual Basic projects:'),
    el('label', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
      el('span', {}, 'Claude API Key:'),
      inputKey
    ),
    el('label', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', cursor: 'pointer' } },
      showKeyCheck,
      'Show API key text'
    ),
    statusNote,
    el('p', { class: 'option-note', style: { fontSize: '10px', color: 'var(--vb-gray, #808080)', margin: '6px 0 0 0' } },
      'Your key is saved locally in your browser storage and is used only for direct calls to Anthropic Claude APIs. It is never included in project files or exports.'
    )
  );

  let finishedAction = null;
  const result = await modal('Claude API Key', {
    width: 480,
    content: body,
    buttons: [
      {
        label: 'Save Key',
        value: 'save',
        primary: true,
        action: () => {
          const val = inputKey.value.trim();
          if (!val) {
            clearStoredApiKey();
            if (ide?.ai) ide.ai.client.setApiKey('');
            ide?.status?.('Claude API key cleared.');
          } else {
            setStoredApiKey(val);
            if (ide?.ai) ide.ai.client.setApiKey(val);
            ide?.status?.('Claude API key saved.');
          }
          finishedAction = 'save';
          return true;
        }
      },
      {
        label: 'Clear Key',
        value: 'clear',
        action: () => {
          clearStoredApiKey();
          inputKey.value = '';
          if (ide?.ai) ide.ai.client.setApiKey('');
          ide?.status?.('Claude API key cleared.');
          finishedAction = 'clear';
          return true;
        }
      },
      {
        label: 'Cancel',
        value: false
      }
    ],
    onReady: () => {
      queueMicrotask(() => {
        inputKey.focus();
        if (inputKey.value) inputKey.select();
      });
    }
  });

  return finishedAction || result;
}
