import { ClaudeApiClient } from './claude-api.js';
import { createAiProjectTools } from './ai-tools.js';

export const AI_SYSTEM_PROMPT = `You are an expert Visual Basic 6 (VB6) autonomous programming agent running directly inside VB6 Studio Web IDE.
You are tasked with working on the user's active VB6 project according to their instructions.

You have access to tools that let you inspect the project, read module source code, edit code, add/remove modules, inspect and edit forms/controls in the form designer, and compile/check syntax.

### WORKFLOW RULES:
1. Always start by inspecting the project structure (using get_project_summary) or reading relevant modules (using read_module) or form designers (get_form_designer) to understand the existing code before proposing or making changes.
2. When creating or modifying code:
   - Write standard Visual Basic 6 code.
   - Use 'Option Explicit' at the top of code modules.
   - Use standard VB6 data types: Integer, Long, Single, Double, Currency, String, Boolean, Byte, Variant, Object.
   - Use VB6 control structures: If...Then...Else...End If, Select Case...Case...End Select, For...Next, For Each...In...Next, Do While...Loop, Do Until...Loop.
   - Use proper subroutine and function syntax: Sub Name(args) ... End Sub, Function Name(args) As ReturnType ... End Function.
   - Use VB6 error handling when appropriate: On Error GoTo ErrorHandler ... Exit Sub ... ErrorHandler: ... Resume Next / Exit Sub.
   - In form code, event procedures follow the pattern: <ObjectName>_<EventName>(<parameters>). For example: Command1_Click(), Form_Load(), Text1_Change().
3. Form & Controls:
   - Measurements (Left, Top, Width, Height) are specified in Twips (15 twips = 1 pixel). Standard button size: Width 1200-1800 twips, Height 360-450 twips.
   - When adding controls, choose appropriate names (e.g., cmdCalculate, txtInput, lblResult, or Command1, Text1, Label1).
4. Validation:
   - After modifying or adding code or controls, run 'check_syntax' to verify that the project compiles with no errors.
   - If there are syntax or compiler errors, read the diagnostics and fix the code before completing.
5. Provide a concise, clear explanation of the changes made and how to test or use them in the IDE.`;

export class AiAgent {
  constructor(ide, { client = new ClaudeApiClient(), maxTurns = 15 } = {}) {
    this.ide = ide;
    this.client = client;
    this.maxTurns = maxTurns;
    this.history = [];
    this.toolsContext = createAiProjectTools(ide);
  }

  clearHistory() {
    this.history = [];
  }

  async runPrompt(userPrompt, { signal, model, onActivity = () => {}, onStatus = () => {} } = {}) {
    if (!userPrompt || typeof userPrompt !== 'string' || !userPrompt.trim()) {
      throw new Error('Prompt cannot be empty.');
    }

    onStatus('Planning and analyzing request…');
    this.history.push({
      role: 'user',
      content: userPrompt.trim()
    });

    let currentTurn = 0;
    let finalAssistantText = '';

    while (currentTurn < this.maxTurns) {
      if (signal?.aborted) {
        throw new Error('AI Agent operation was cancelled.');
      }

      currentTurn++;
      onStatus(`AI Agent turn ${currentTurn}/${this.maxTurns}: contact Claude API…`);

      const response = await this.client.sendMessage({
        system: AI_SYSTEM_PROMPT,
        messages: this.history,
        tools: this.toolsContext.tools,
        model,
        signal
      });

      if (!response || !Array.isArray(response.content)) {
        throw new Error('Received invalid response from Claude API.');
      }

      this.history.push({
        role: 'assistant',
        content: response.content
      });

      const textBlocks = response.content.filter(b => b.type === 'text');
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');

      if (textBlocks.length > 0) {
        const text = textBlocks.map(b => b.text).join('\n\n');
        finalAssistantText = text;
        onActivity({
          type: 'assistant_text',
          text,
          turn: currentTurn
        });
      }

      if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
        onStatus('Ready');
        return {
          response: finalAssistantText,
          turns: currentTurn,
          history: this.history
        };
      }

      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        if (signal?.aborted) {
          throw new Error('AI Agent operation was cancelled.');
        }

        onStatus(`Executing tool: ${toolUse.name}…`);
        onActivity({
          type: 'tool_call',
          id: toolUse.id,
          name: toolUse.name,
          input: toolUse.input,
          turn: currentTurn
        });

        let resultData;
        let isError = false;
        try {
          resultData = await this.toolsContext.execute(toolUse.name, toolUse.input);
        } catch (error) {
          isError = true;
          resultData = { error: error.message || String(error) };
        }

        onActivity({
          type: 'tool_result',
          id: toolUse.id,
          name: toolUse.name,
          result: resultData,
          isError,
          turn: currentTurn
        });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: typeof resultData === 'string' ? resultData : JSON.stringify(resultData, null, 2),
          is_error: isError
        });
      }

      this.history.push({
        role: 'user',
        content: toolResults
      });
    }

    onStatus('Completed maximum iterations.');
    return {
      response: finalAssistantText || 'Reached maximum tool iterations.',
      turns: currentTurn,
      history: this.history
    };
  }
}
