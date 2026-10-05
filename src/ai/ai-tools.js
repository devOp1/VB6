import { clone, lower } from '../core/core.js';
import { findModule, createForm, createControl, newId, BASIC_CONTROL_TYPES, EXTENDED_CONTROL_TYPES } from '../project/model.js';
import { compileProject } from '../language/compiler.js';

export function createAiProjectTools(ide) {
  function getProject() {
    if (!ide.project) throw new Error('No active project is open in the IDE.');
    return ide.project;
  }

  function requireModule(name) {
    const project = getProject();
    const module = findModule(project, name);
    if (!module) throw new Error('Module "' + name + '" does not exist in the open project.');
    return module;
  }

  const toolDefs = [
    {
      name: 'get_project_summary',
      description: 'Get an overview of the currently open VB6 project, including its name, startup module/procedure, and list of all modules (forms, classes, standard modules) with line counts.',
      input_schema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    },
    {
      name: 'read_module',
      description: 'Read the full Visual Basic 6 source code of a specified module.',
      input_schema: {
        type: 'object',
        properties: {
          module: {
            type: 'string',
            description: 'Name of the module to read (e.g., "Form1", "Module1", "Class1")'
          }
        },
        required: ['module'],
        additionalProperties: false
      }
    },
    {
      name: 'write_module',
      description: 'Replace the entire source code of a specified module. Updates the module in the IDE and records an undo step.',
      input_schema: {
        type: 'object',
        properties: {
          module: {
            type: 'string',
            description: 'Name of the module to update (e.g., "Form1", "Module1")'
          },
          code: {
            type: 'string',
            description: 'The complete new VB6 source code for the module'
          }
        },
        required: ['module', 'code'],
        additionalProperties: false
      }
    },
    {
      name: 'add_module',
      description: 'Add a new module, class module, or form to the project with initial code.',
      input_schema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the new module (must be a valid VB identifier, e.g. "Module2", "CalculatorForm")'
          },
          kind: {
            type: 'string',
            enum: ['module', 'class', 'form'],
            description: 'The kind of module: "module" (standard .bas), "class" (.cls), or "form" (.frm)'
          },
          code: {
            type: 'string',
            description: 'Optional initial source code for the module'
          }
        },
        required: ['name', 'kind'],
        additionalProperties: false
      }
    },
    {
      name: 'remove_module',
      description: 'Remove a module from the project.',
      input_schema: {
        type: 'object',
        properties: {
          module: {
            type: 'string',
            description: 'Name of the module to remove'
          }
        },
        required: ['module'],
        additionalProperties: false
      }
    },
    {
      name: 'get_form_designer',
      description: 'Get the visual layout, properties, and controls of a form module.',
      input_schema: {
        type: 'object',
        properties: {
          module: {
            type: 'string',
            description: 'Name of the form module (e.g. "Form1")'
          }
        },
        required: ['module'],
        additionalProperties: false
      }
    },
    {
      name: 'update_form_properties',
      description: 'Update top-level properties of a form (such as Caption, Width, Height, ClientWidth, ClientHeight, BackColor, StartUpPosition).',
      input_schema: {
        type: 'object',
        properties: {
          module: {
            type: 'string',
            description: 'Name of the form module'
          },
          properties: {
            type: 'object',
            description: 'Key-value map of form properties to update'
          }
        },
        required: ['module', 'properties'],
        additionalProperties: false
      }
    },
    {
      name: 'add_control',
      description: 'Add a visual control (e.g. CommandButton, TextBox, Label, Timer, CheckBox, ListBox, ComboBox, Frame, PictureBox, etc.) to a form.',
      input_schema: {
        type: 'object',
        properties: {
          module: {
            type: 'string',
            description: 'Name of the form module'
          },
          type: {
            type: 'string',
            description: 'Type of control to add (e.g., "CommandButton", "TextBox", "Label", "CheckBox", "OptionButton", "ListBox", "ComboBox", "Frame", "Timer", "PictureBox", "Image", "ProgressBar", "Slider", "RichTextBox", "MSFlexGrid")'
          },
          name: {
            type: 'string',
            description: 'Optional name for the control (e.g., "Command1", "txtInput", "lblResult"). If omitted, an auto-incremented name will be generated.'
          },
          properties: {
            type: 'object',
            description: 'Optional initial properties (Caption, Text, Left, Top, Width, Height, Enabled, Visible, ToolTipText, etc.). Dimensions and positions are in twips (15 twips = 1 pixel).'
          }
        },
        required: ['module', 'type'],
        additionalProperties: false
      }
    },
    {
      name: 'update_control',
      description: 'Update properties of an existing control on a form.',
      input_schema: {
        type: 'object',
        properties: {
          module: {
            type: 'string',
            description: 'Name of the form module'
          },
          controlName: {
            type: 'string',
            description: 'Name of the control to update (e.g., "Command1", "Text1")'
          },
          properties: {
            type: 'object',
            description: 'Key-value map of properties to update (e.g., { Caption: "Calculate", Width: 1800 })'
          }
        },
        required: ['module', 'controlName', 'properties'],
        additionalProperties: false
      }
    },
    {
      name: 'remove_control',
      description: 'Remove a control from a form.',
      input_schema: {
        type: 'object',
        properties: {
          module: {
            type: 'string',
            description: 'Name of the form module'
          },
          controlName: {
            type: 'string',
            description: 'Name of the control to remove'
          }
        },
        required: ['module', 'controlName'],
        additionalProperties: false
      }
    },
    {
      name: 'check_syntax',
      description: 'Compile the project and check for syntax / semantic errors across all modules without running it.',
      input_schema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    },
    {
      name: 'search_project',
      description: 'Search for text across all modules in the project.',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Text string to search for'
          },
          caseSensitive: {
            type: 'boolean',
            description: 'Whether the search is case-sensitive (default: false)'
          }
        },
        required: ['query'],
        additionalProperties: false
      }
    },
    {
      name: 'list_control_types',
      description: 'List all supported VB6 control types and their standard properties.',
      input_schema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    }
  ];

  async function executeTool(name, args = {}) {
    const project = getProject();

    switch (name) {
      case 'get_project_summary': {
        const activeMod = ide.activeModule;
        return {
          name: project.name,
          startup: project.startup,
          modules: project.modules.map(m => ({
            id: m.id,
            name: m.name,
            kind: m.kind,
            lineCount: m.code ? m.code.split('\n').length : 0,
            hasForm: !!m.form,
            formType: m.form?.type || null
          })),
          activeModule: activeMod?.name || null
        };
      }

      case 'read_module': {
        const module = requireModule(args.module);
        return {
          name: module.name,
          kind: module.kind,
          hasForm: !!module.form,
          code: module.code
        };
      }

      case 'write_module': {
        const module = requireModule(args.module);
        const before = clone(project);
        module.code = args.code;

        try {
          const editor = ide.documents?.editors?.get(module.id);
          if (editor) {
            editor.setDocument(module, ide.project);
          }
        } catch {}

        ide.record(before, 'AI: Edit ' + module.name);
        ide.markDirty();
        if (ide.renderDocument) ide.renderDocument();

        return {
          success: true,
          module: module.name,
          lineCount: module.code.split('\n').length,
          message: 'Module ' + module.name + ' code updated successfully.'
        };
      }

      case 'add_module': {
        const moduleName = args.name.trim();
        if (!/^[A-Za-z_]\w*$/.test(moduleName)) {
          throw new Error('Invalid VB6 module name: "' + moduleName + '". Must start with a letter/underscore and contain alphanumeric characters.');
        }
        if (project.modules.some(m => lower(m.name) === lower(moduleName))) {
          throw new Error('A module named "' + moduleName + '" already exists in the project.');
        }

        const before = clone(project);
        let newMod;
        if (args.kind === 'form') {
          newMod = createForm(moduleName);
          if (args.code) newMod.code = args.code;
        } else {
          newMod = {
            id: newId(),
            name: moduleName,
            kind: args.kind,
            code: args.code !== undefined ? args.code : 'Option Explicit\n\n'
          };
        }

        project.modules.push(newMod);
        ide.record(before, 'AI: Add ' + moduleName);
        ide.markDirty();
        ide.renderAll();

        return {
          success: true,
          name: newMod.name,
          kind: newMod.kind,
          id: newMod.id,
          message: 'Created ' + newMod.kind + ' "' + newMod.name + '".'
        };
      }

      case 'remove_module': {
        const module = requireModule(args.module);
        if (project.modules.length <= 1) {
          throw new Error('Cannot remove the only module in the project.');
        }

        const before = clone(project);
        project.modules = project.modules.filter(m => m.id !== module.id);
        if (ide.docs) {
          ide.docs = ide.docs.filter(d => d.id !== module.id);
        }
        if (project.startup === module.name) {
          project.startup = project.modules[0].name;
        }

        ide.record(before, 'AI: Remove ' + module.name);
        ide.markDirty();
        ide.renderAll();

        return {
          success: true,
          removed: module.name,
          message: 'Removed module "' + module.name + '".'
        };
      }

      case 'get_form_designer': {
        const module = requireModule(args.module);
        if (!module.form) {
          throw new Error('Module "' + module.name + '" is not a Form.');
        }
        return {
          module: module.name,
          type: module.form.type || 'Form',
          properties: clone(module.form.properties || {}),
          controls: clone(module.form.controls || []).map(c => ({
            id: c.id,
            name: c.name,
            type: c.type,
            properties: c.properties || {}
          })),
          menus: clone(module.form.menus || [])
        };
      }

      case 'update_form_properties': {
        const module = requireModule(args.module);
        if (!module.form) {
          throw new Error('Module "' + module.name + '" is not a Form.');
        }
        const before = clone(project);
        module.form.properties = module.form.properties || {};
        Object.assign(module.form.properties, args.properties);

        ide.record(before, 'AI: Update form ' + module.name);
        ide.markDirty();
        ide.renderAll();

        return {
          success: true,
          module: module.name,
          properties: module.form.properties
        };
      }

      case 'add_control': {
        const module = requireModule(args.module);
        if (!module.form) {
          throw new Error('Module "' + module.name + '" is not a Form.');
        }

        const validTypes = [...BASIC_CONTROL_TYPES, ...EXTENDED_CONTROL_TYPES];
        const type = args.type;
        if (!validTypes.includes(type)) {
          throw new Error('Unsupported control type: "' + type + '". Available types: ' + validTypes.join(', '));
        }

        let name = args.name?.trim();
        if (!name) {
          let num = 1;
          const base = type === 'CommandButton' ? 'Command' : type === 'TextBox' ? 'Text' : type === 'Label' ? 'Label' : type === 'OptionButton' ? 'Option' : type === 'CheckBox' ? 'Check' : type;
          while (module.form.controls.some(c => lower(c.name) === lower(base + num))) {
            num++;
          }
          name = base + num;
        }

        if (module.form.controls.some(c => lower(c.name) === lower(name))) {
          throw new Error('A control named "' + name + '" already exists on ' + module.name + '.');
        }

        const before = clone(project);
        const left = args.properties?.Left !== undefined ? args.properties.Left : 360;
        const top = args.properties?.Top !== undefined ? args.properties.Top : 360;
        const control = createControl(type, name, left, top);

        if (args.properties && typeof args.properties === 'object') {
          Object.assign(control.properties, args.properties);
        }

        module.form.controls.push(control);
        ide.record(before, 'AI: Add ' + name + ' (' + type + ')');
        ide.markDirty();
        ide.renderAll();

        return {
          success: true,
          module: module.name,
          control: {
            id: control.id,
            name: control.name,
            type: control.type,
            properties: control.properties
          },
          message: 'Added ' + type + ' "' + name + '" to ' + module.name + '.'
        };
      }

      case 'update_control': {
        const module = requireModule(args.module);
        if (!module.form) {
          throw new Error('Module "' + module.name + '" is not a Form.');
        }

        const control = module.form.controls.find(c => lower(c.name) === lower(args.controlName));
        if (!control) {
          throw new Error('Control "' + args.controlName + '" not found on form ' + module.name + '.');
        }

        const before = clone(project);
        control.properties = control.properties || {};
        Object.assign(control.properties, args.properties);

        if (args.properties?.Name && args.properties.Name !== control.name) {
          const newName = args.properties.Name;
          if (!/^[A-Za-z_]\w*$/.test(newName)) throw new Error('Invalid control name: ' + newName);
          control.name = newName;
        }

        ide.record(before, 'AI: Update ' + control.name);
        ide.markDirty();
        ide.renderAll();

        return {
          success: true,
          module: module.name,
          control: control.name,
          properties: control.properties
        };
      }

      case 'remove_control': {
        const module = requireModule(args.module);
        if (!module.form) {
          throw new Error('Module "' + module.name + '" is not a Form.');
        }

        const control = module.form.controls.find(c => lower(c.name) === lower(args.controlName));
        if (!control) {
          throw new Error('Control "' + args.controlName + '" not found on form ' + module.name + '.');
        }

        const before = clone(project);
        module.form.controls = module.form.controls.filter(c => c.id !== control.id);

        ide.record(before, 'AI: Remove ' + control.name);
        ide.markDirty();
        ide.renderAll();

        return {
          success: true,
          removed: control.name,
          module: module.name
        };
      }

      case 'check_syntax': {
        const compiled = compileProject(ide.project);
        ide.diagnostics = compiled.diagnostics || [];
        if (ide.editor?.setDiagnostics) {
          ide.editor.setDiagnostics(ide.diagnostics);
        }
        return {
          valid: compiled.valid,
          moduleCount: compiled.modules ? compiled.modules.size : project.modules.length,
          errorCount: compiled.diagnostics ? compiled.diagnostics.length : 0,
          diagnostics: (compiled.diagnostics || []).map(d => ({
            module: d.module,
            line: d.line,
            column: d.column,
            message: d.message,
            severity: d.severity || 'error'
          }))
        };
      }

      case 'search_project': {
        const query = args.query;
        if (!query) throw new Error('Query string is required.');
        const needle = args.caseSensitive ? query : query.toLowerCase();
        const matches = [];

        for (const module of project.modules) {
          if (!module.code) continue;
          const lines = module.code.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const check = args.caseSensitive ? line : line.toLowerCase();
            if (check.includes(needle)) {
              matches.push({
                module: module.name,
                line: i + 1,
                text: line.trim()
              });
              if (matches.length >= 200) break;
            }
          }
        }

        return {
          query,
          matchCount: matches.length,
          matches
        };
      }

      case 'list_control_types': {
        return {
          basicControls: [
            { type: 'CommandButton', description: 'Standard push button. Default event: Click.' },
            { type: 'TextBox', description: 'Single or multi-line editable text box. Default event: Change.' },
            { type: 'Label', description: 'Non-editable text display label. Properties: Caption, Alignment.' },
            { type: 'CheckBox', description: 'Two-state checkbox. Properties: Value (0=Unchecked, 1=Checked, 2=Grayed), Caption.' },
            { type: 'OptionButton', description: 'Radio button. Properties: Value (True/False), Caption.' },
            { type: 'ListBox', description: 'Scrollable list of items. Methods: AddItem, RemoveItem, Clear. Property: ListIndex.' },
            { type: 'ComboBox', description: 'Dropdown combo box. Methods: AddItem, Clear. Properties: Style, Text, ListIndex.' },
            { type: 'Frame', description: 'Visual group container for controls with Caption.' },
            { type: 'Timer', description: 'Periodic timer event. Properties: Interval (ms), Enabled. Event: Timer.' },
            { type: 'PictureBox', description: 'Image container and drawing surface. Methods: Cls, PSet, Line, Circle, Print.' },
            { type: 'Image', description: 'Lightweight graphic display.' },
            { type: 'HScrollBar', description: 'Horizontal scroll bar. Properties: Min, Max, Value, SmallChange, LargeChange.' },
            { type: 'VScrollBar', description: 'Vertical scroll bar. Properties: Min, Max, Value, SmallChange, LargeChange.' },
            { type: 'Shape', description: 'Geometric shape (Rectangle, Square, Oval, Circle). Properties: Shape, BackColor, FillStyle.' },
            { type: 'Line', description: 'Visual line on a form. Properties: X1, Y1, X2, Y2, BorderColor, BorderWidth.' }
          ],
          extendedControls: [
            { type: 'TreeView', description: 'Hierarchical node tree control. Nodes collection: Add, Clear.' },
            { type: 'ListView', description: 'Icon / list / report view control. ListItems, ColumnHeaders collections.' },
            { type: 'ProgressBar', description: 'Progress bar indicator. Properties: Min, Max, Value.' },
            { type: 'Slider', description: 'Track bar slider. Properties: Min, Max, Value.' },
            { type: 'StatusBar', description: 'Status bar at bottom of form. Panels collection.' },
            { type: 'Toolbar', description: 'Tool button bar. Buttons collection.' },
            { type: 'TabStrip', description: 'Tab container. Tabs collection.' },
            { type: 'RichTextBox', description: 'Rich text editing control.' },
            { type: 'MSFlexGrid', description: 'Data grid. Properties: Rows, Cols, TextMatrix(r, c).' }
          ]
        };
      }

      default:
        throw new Error('Unknown tool: "' + name + '"');
    }
  }

  return {
    tools: toolDefs,
    execute: executeTool
  };
}
