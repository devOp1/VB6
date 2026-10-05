import { ClaudeApiClient, CLAUDE_MODELS, CLAUDE_DEFAULT_MODEL, getStoredApiKey, setStoredApiKey, clearStoredApiKey } from './claude-api.js';
import { AiAgent } from './agent.js';
import { AiAgentPanel } from './ai-panel.js';
import { openClaudeKeyDialog } from './key-dialog.js';

export function installAi(ide, studioAPI) {
  if (ide.ai) return ide.ai;

  const client = new ClaudeApiClient();
  const agent = new AiAgent(ide, { client });

  const aiService = {
    client,
    agent,
    openClaudeKeyDialog: () => openClaudeKeyDialog(ide),
    openAgent: () => ide.openAiAgent(),
    getStoredApiKey,
    setStoredApiKey,
    clearStoredApiKey
  };

  ide.ai = aiService;

  if (studioAPI) {
    studioAPI.AI = {
      ClaudeApiClient,
      AiAgent,
      AiAgentPanel,
      openClaudeKeyDialog,
      installAi,
      CLAUDE_MODELS,
      CLAUDE_DEFAULT_MODEL
    };
  }

  const resetDocuments = ide.documents.reset;
  ide.documents.reset = function(...args) {
    const tool = this.tools.get('tool:ai');
    if (tool) this.tools.delete('tool:ai');
    try {
      return resetDocuments.apply(this, args);
    } finally {
      if (tool) this.openTool(tool);
    }
  };

  const menu = ide.menu.bind(ide);
  const command = ide.command.bind(ide);

  ide.openAiAgent = () => {
    let tool = ide.documents.tools.get('tool:ai');
    if (!tool) tool = new AiAgentPanel(aiService, ide);
    ide.documents.openTool(tool);
    return tool;
  };

  ide.openClaudeKeyDialog = () => openClaudeKeyDialog(ide);

  ide.menu = name => {
    const items = menu(name);
    if (name === 'Tools') {
      items.unshift(
        { label: 'AI Agent…', id: 'aiAgent', icon: 'properties' },
        { label: 'Claude API Key…', id: 'claudeApiKey', icon: 'properties' },
        null
      );
    }
    return items;
  };

  ide.command = (id, ...args) => {
    if (id === 'aiAgent') return ide.openAiAgent();
    if (id === 'claudeApiKey') return ide.openClaudeKeyDialog();
    return command(id, ...args);
  };

  return aiService;
}
