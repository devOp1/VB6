import test from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeApiClient, getStoredApiKey, setStoredApiKey, clearStoredApiKey, CLAUDE_MODELS, CLAUDE_DEFAULT_MODEL } from '../src/ai/claude-api.js';
import { createAiProjectTools } from '../src/ai/ai-tools.js';
import { AiAgent } from '../src/ai/agent.js';
import { installAi } from '../src/ai/ai-integration.js';
import { newProject, createForm, createControl } from '../src/project/model.js';

// Setup mock mockIde helper
function createMockIde() {
  const project = newProject();
  const recordedHistory = [];
  let isDirty = false;
  let statusText = '';

  const ide = {
    project,
    activeDoc: { id: project.modules[0].id, view: 'form' },
    get activeModule() {
      return this.project.modules.find(m => m.id === this.activeDoc?.id) || this.project.modules[0];
    },
    docs: [{ id: project.modules[0].id, view: 'form', key: project.modules[0].id + ':form' }],
    documents: {
      tools: new Map(),
      openTool(tool) {
        this.tools.set(tool.key, tool);
      },
      closeTool(key) {
        return this.tools.delete(key);
      },
      reset() {}
    },
    record(before, label) {
      recordedHistory.push({ before, label });
    },
    markDirty() {
      isDirty = true;
    },
    renderAll() {},
    renderDocument() {},
    status(msg) {
      statusText = msg;
    },
    menu(name) {
      if (name === 'Tools') {
        return [
          { id: 'options', label: 'Options…' }
        ];
      }
      return [];
    },
    command(id) {
      return 'cmd:' + id;
    }
  };

  return { ide, recordedHistory, getDirty: () => isDirty, getStatus: () => statusText };
}

test('Claude API key storage get/set/clear works correctly', () => {
  clearStoredApiKey();
  assert.equal(getStoredApiKey(), '');

  setStoredApiKey('sk-ant-test-key-12345', false);
  assert.equal(getStoredApiKey(), 'sk-ant-test-key-12345');

  clearStoredApiKey();
  assert.equal(getStoredApiKey(), '');
});

test('ClaudeApiClient throws error if no API key is set', async () => {
  clearStoredApiKey();
  const client = new ClaudeApiClient({ apiKey: '' });
  await assert.rejects(
    async () => await client.sendMessage({ messages: [{ role: 'user', content: 'hello' }] }),
    /Claude API key is not configured/
  );
});

test('ClaudeApiClient formats request correctly and parses response', async () => {
  let capturedUrl = '';
  let capturedOptions = null;

  const mockFetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'msg_123',
        content: [{ type: 'text', text: 'Hello! I am Claude.' }],
        stop_reason: 'end_turn'
      })
    };
  };

  const client = new ClaudeApiClient({
    apiKey: 'sk-ant-test-123',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    model: 'claude-3-7-sonnet-20250219',
    fetchFn: mockFetch
  });

  const response = await client.sendMessage({
    system: 'You are a VB6 expert.',
    messages: [{ role: 'user', content: 'Hi' }],
    tools: [{ name: 'test_tool', description: 'desc', input_schema: { type: 'object', properties: {} } }]
  });

  assert.equal(capturedUrl, 'https://api.anthropic.com/v1/messages');
  assert.equal(capturedOptions.method, 'POST');
  assert.equal(capturedOptions.headers['x-api-key'], 'sk-ant-test-123');
  assert.equal(capturedOptions.headers['anthropic-version'], '2023-06-01');
  assert.equal(capturedOptions.headers['anthropic-dangerous-direct-browser-access'], 'true');

  const parsedBody = JSON.parse(capturedOptions.body);
  assert.equal(parsedBody.model, 'claude-3-7-sonnet-20250219');
  assert.equal(parsedBody.system, 'You are a VB6 expert.');
  assert.equal(parsedBody.tools.length, 1);
  assert.equal(parsedBody.temperature, undefined);
  assert.equal(response.content[0].text, 'Hello! I am Claude.');

  // If temperature is explicitly supplied, verify it is included
  await client.sendMessage({
    messages: [{ role: 'user', content: 'Hi' }],
    temperature: 0.5
  });
  const parsedWithTemp = JSON.parse(capturedOptions.body);
  assert.equal(parsedWithTemp.temperature, 0.5);
});

test('ClaudeApiClient handles 401 and 429 errors clearly', async () => {
  const mockFetch401 = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: { message: 'invalid x-api-key' } })
  });

  const client401 = new ClaudeApiClient({ apiKey: 'bad-key', model: 'claude-test', fetchFn: mockFetch401 });
  await assert.rejects(
    async () => await client401.sendMessage({ messages: [] }),
    /Invalid Claude API key/
  );

  const mockFetch429 = async () => ({
    ok: false,
    status: 429,
    json: async () => ({ error: { message: 'rate limit exceeded' } })
  });

  const client429 = new ClaudeApiClient({ apiKey: 'good-key', model: 'claude-test', fetchFn: mockFetch429 });
  await assert.rejects(
    async () => await client429.sendMessage({ messages: [] }),
    /rate limit/
  );
});

test('ClaudeApiClient fetchModels and listModels work correctly with API and fallbacks', async () => {
  let capturedUrl = '';
  let capturedHeaders = null;

  const mockFetch = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: 'claude-3-7-sonnet-20250219', display_name: 'Claude 3.7 Sonnet', created_at: '2025-02-19T00:00:00Z' },
          { id: 'claude-3-5-sonnet-20241022', display_name: 'Claude 3.5 Sonnet', created_at: '2024-10-22T00:00:00Z' },
          { id: 'claude-3-haiku-20240307', display_name: 'Claude 3 Haiku', created_at: '2024-03-07T00:00:00Z' }
        ]
      })
    };
  };

  const client = new ClaudeApiClient({
    apiKey: 'sk-ant-test-models-key',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    fetchFn: mockFetch
  });

  const models = await client.fetchModels();
  assert.equal(capturedUrl, 'https://api.anthropic.com/v1/models');
  assert.equal(capturedHeaders['x-api-key'], 'sk-ant-test-models-key');
  assert.equal(models.length, 3);
  assert.equal(models[0].id, 'claude-3-7-sonnet-20250219');
  assert.equal(models[0].name, 'Claude 3.7 Sonnet (claude-3-7-sonnet-20250219)');

  // Test fallback in listModels if fetch fails
  const failingClient = new ClaudeApiClient({
    apiKey: 'sk-ant-test-models-key',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    fetchFn: async () => ({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error'
    })
  });

  const fallbackList = await failingClient.listModels();
  assert.equal(fallbackList.length, 0);
});

test('ClaudeApiClient and AiAgent automatically use first loaded model when none is set', async () => {
  let capturedModelInSendMessage = '';

  const mockFetch = async (url, options) => {
    if (url.includes('/v1/models')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: 'claude-custom-first-model', display_name: 'Claude Custom First' },
            { id: 'claude-custom-second-model', display_name: 'Claude Custom Second' }
          ]
        })
      };
    }
    const body = JSON.parse(options.body);
    capturedModelInSendMessage = body.model;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'msg_dyn',
        content: [{ type: 'text', text: 'Handled with first loaded model' }],
        stop_reason: 'end_turn'
      })
    };
  };

  const client = new ClaudeApiClient({
    apiKey: 'sk-ant-test-first-model',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    fetchFn: mockFetch
  });

  assert.equal(client.model, '');

  const models = await client.listModels();
  assert.equal(models.length, 2);
  assert.equal(models[0].id, 'claude-custom-first-model');
  assert.equal(client.model, 'claude-custom-first-model');

  const response = await client.sendMessage({
    messages: [{ role: 'user', content: 'test' }]
  });

  assert.equal(capturedModelInSendMessage, 'claude-custom-first-model');
  assert.equal(response.content[0].text, 'Handled with first loaded model');
});

test('AI Project Tools can inspect project, read and write modules', async () => {
  const { ide, recordedHistory, getDirty } = createMockIde();
  const toolsContext = createAiProjectTools(ide);

  // 1. get_project_summary
  const summary = await toolsContext.execute('get_project_summary');
  assert.equal(summary.name, 'Project1');
  assert.ok(summary.modules.length >= 1);
  assert.equal(summary.modules[0].name, 'Form1');

  // 2. read_module
  const modData = await toolsContext.execute('read_module', { module: 'Form1' });
  assert.equal(modData.name, 'Form1');
  assert.equal(modData.hasForm, true);

  // 3. write_module
  const newCode = 'Option Explicit\n\nPrivate Sub Form_Load()\n    MsgBox "Hello from AI"\nEnd Sub\n';
  const writeRes = await toolsContext.execute('write_module', { module: 'Form1', code: newCode });
  assert.equal(writeRes.success, true);
  assert.equal(ide.project.modules[0].code, newCode);
  assert.ok(getDirty());
  assert.ok(recordedHistory.some(h => h.label.includes('Edit Form1')));
});

test('AI Project Tools can add, remove modules and add controls to forms', async () => {
  const { ide } = createMockIde();
  const toolsContext = createAiProjectTools(ide);

  // 1. add_module (standard module)
  const addRes = await toolsContext.execute('add_module', {
    name: 'ModuleMath',
    kind: 'module',
    code: 'Option Explicit\n\nPublic Function Add(a As Long, b As Long) As Long\n    Add = a + b\nEnd Function\n'
  });
  assert.equal(addRes.success, true);
  assert.equal(ide.project.modules.some(m => m.name === 'ModuleMath'), true);

  // 2. add_control to Form1
  const addCtrlRes = await toolsContext.execute('add_control', {
    module: 'Form1',
    type: 'CommandButton',
    name: 'cmdCalculate',
    properties: { Caption: 'Calculate', Left: 1200, Top: 1500, Width: 1800, Height: 450 }
  });
  assert.equal(addCtrlRes.success, true);
  assert.equal(addCtrlRes.control.name, 'cmdCalculate');
  assert.equal(addCtrlRes.control.properties.Caption, 'Calculate');

  // 3. get_form_designer
  const formDesigner = await toolsContext.execute('get_form_designer', { module: 'Form1' });
  assert.equal(formDesigner.module, 'Form1');
  assert.ok(formDesigner.controls.some(c => c.name === 'cmdCalculate'));

  // 4. update_control
  const updateCtrlRes = await toolsContext.execute('update_control', {
    module: 'Form1',
    controlName: 'cmdCalculate',
    properties: { Caption: 'Run Calculation' }
  });
  assert.equal(updateCtrlRes.success, true);
  assert.equal(updateCtrlRes.properties.Caption, 'Run Calculation');

  // 5. check_syntax
  const syntaxCheck = await toolsContext.execute('check_syntax');
  assert.equal(syntaxCheck.valid, true);
  assert.equal(syntaxCheck.errorCount, 0);

  // 6. search_project
  const searchRes = await toolsContext.execute('search_project', { query: 'Add = a + b' });
  assert.equal(searchRes.matchCount, 1);
  assert.equal(searchRes.matches[0].module, 'ModuleMath');

  // 7. remove_control
  const remCtrlRes = await toolsContext.execute('remove_control', { module: 'Form1', controlName: 'cmdCalculate' });
  assert.equal(remCtrlRes.success, true);
  assert.equal(ide.project.modules[0].form.controls.some(c => c.name === 'cmdCalculate'), false);

  // 8. remove_module
  const remModRes = await toolsContext.execute('remove_module', { module: 'ModuleMath' });
  assert.equal(remModRes.success, true);
  assert.equal(ide.project.modules.some(m => m.name === 'ModuleMath'), false);
});

test('AiAgent executes autonomous multi-turn tool calling loop on project', async () => {
  const { ide } = createMockIde();

  let turnCount = 0;
  const mockFetch = async (url, options) => {
    if (url.includes('/v1/models')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: 'claude-3-7-sonnet-20250219', display_name: 'Claude 3.7 Sonnet' }]
        })
      };
    }
    turnCount++;
    const body = JSON.parse(options.body);

    if (turnCount === 1) {
      // First turn: Claude decides to read Form1
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [
            { type: 'text', text: 'I will inspect the Form1 code.' },
            { type: 'tool_use', id: 'call_1', name: 'read_module', input: { module: 'Form1' } }
          ],
          stop_reason: 'tool_use'
        })
      };
    } else if (turnCount === 2) {
      // Second turn: Claude adds a button and writes click event
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [
            { type: 'text', text: 'Now adding a button and code.' },
            { type: 'tool_use', id: 'call_2', name: 'add_control', input: { module: 'Form1', type: 'CommandButton', name: 'btnTest' } }
          ],
          stop_reason: 'tool_use'
        })
      };
    } else {
      // Final turn: Claude responds with completion message
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [
            { type: 'text', text: 'Successfully added btnTest to Form1.' }
          ],
          stop_reason: 'end_turn'
        })
      };
    }
  };

  const client = new ClaudeApiClient({ apiKey: 'sk-test', fetchFn: mockFetch });
  const agent = new AiAgent(ide, { client, maxTurns: 5 });

  const activities = [];
  const result = await agent.runPrompt('Please add a test button to Form1', {
    onActivity: a => activities.push(a)
  });

  assert.equal(result.response, 'Successfully added btnTest to Form1.');
  assert.equal(result.turns, 3);
  assert.ok(ide.project.modules[0].form.controls.some(c => c.name === 'btnTest'));
  assert.ok(activities.some(a => a.type === 'tool_call' && a.name === 'read_module'));
  assert.ok(activities.some(a => a.type === 'tool_call' && a.name === 'add_control'));
});

function withMockDom(fn) {
  const oldDoc = globalThis.document;
  try {
    globalThis.document = {
      createTextNode: (text) => ({ nodeType: 3, textContent: text, text }),
      createElement: (tag) => {
        const elem = {
          tagName: tag.toUpperCase(),
          attributes: {},
          dataset: {},
          style: {},
          children: [],
          classList: {
            classes: new Set(),
            add(c) { this.classes.add(c); },
            remove(c) { this.classes.delete(c); },
            contains(c) { return this.classes.has(c); },
            toggle(c, v) { if (v === undefined ? !this.contains(c) : v) this.add(c); else this.remove(c); }
          },
          setAttribute(k, v) { this.attributes[k] = String(v); },
          getAttribute(k) { return this.attributes[k]; },
          removeAttribute(k) { delete this.attributes[k]; },
          append(...nodes) { this.children.push(...nodes); },
          replaceChildren(...nodes) { this.children = nodes; },
          cloneNode(deep) {
            return {
              ...this,
              dataset: { ...this.dataset },
              style: { ...this.style },
              attributes: { ...this.attributes },
              classList: {
                classes: new Set(this.classList.classes),
                add(c) { this.classes.add(c); },
                remove(c) { this.classes.delete(c); },
                contains(c) { return this.classes.has(c); },
                toggle(c, v) { if (v === undefined ? !this.contains(c) : v) this.add(c); else this.remove(c); }
              }
            };
          },
          addEventListener() {},
          removeEventListener() {},
          querySelector() { return null; },
          querySelectorAll() { return []; },
          focus() {}
        };
        return elem;
      }
    };
    return fn();
  } finally {
    if (oldDoc === undefined) delete globalThis.document;
    else globalThis.document = oldDoc;
  }
}

test('installAi integrates menus and commands into the IDE', () => {
  withMockDom(() => {
    const { ide } = createMockIde();
    const studioAPI = {};
    const aiService = installAi(ide, studioAPI);

    assert.ok(ide.ai);
    assert.ok(studioAPI.AI);

    // Verify Tools menu includes AI Agent and Claude API Key
    const toolsMenu = ide.menu('Tools');
    assert.equal(toolsMenu[0].id, 'aiAgent');
    assert.equal(toolsMenu[0].label, 'AI Agent…');
    assert.equal(toolsMenu[1].id, 'claudeApiKey');
    assert.equal(toolsMenu[1].label, 'Claude API Key…');

    // Verify commands open the tools
    const panel = ide.command('aiAgent');
    assert.ok(panel);
    assert.equal(panel.key, 'tool:ai');
    assert.equal(panel.title, 'AI Agent');

    // Verify second install is idempotent
    const second = installAi(ide, studioAPI);
    assert.equal(second, aiService);
  });
});
