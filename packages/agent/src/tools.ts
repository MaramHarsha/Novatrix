import type { ChatCompletionTool } from 'openai/resources/chat/completions';

export const tools: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'terminal_exec',
      description:
        'Run a shell command in Docker when SANDBOX_MODE=docker. Required: `sandbox_profile` — use "novatrix" (ProjectDiscovery stack + common CLI in novatrix-sandbox image) or "exegol" (full Exegol image). Sessions default to both enabled: prefer novatrix for speed; use exegol when a tool is missing in novatrix. In mock mode only a bare host shell exists.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Full shell command to run' },
          sandbox_profile: {
            type: 'string',
            enum: ['novatrix', 'exegol'],
            description: 'Which Docker profile runs the command (default: novatrix)',
          },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'http_request',
      description: 'Perform an HTTP request (GET/POST/...) for API or web checks. URL must match allowlist.',
      parameters: {
        type: 'object',
        properties: {
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] },
          url: { type: 'string' },
          headers: { type: 'string', description: 'JSON object string of headers' },
          body: { type: 'string', description: 'Optional raw body' },
        },
        required: ['method', 'url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_navigate',
      description:
        'Headless browser capture for a URL in allowlist: screenshot (Docker/chromium) or HTML fetch (mock). Runs inside sandbox workspace.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Target URL' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_read',
      description: 'Read a UTF-8 text file under the sandbox workspace (relative path only).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path, e.g. notes.txt or subdir/x.json' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_write',
      description: 'Write UTF-8 text to a path under the sandbox workspace (relative path only).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_finding',
      description:
        'Record a security finding. For low/critical severities, evidence must contain verbatim proof (tool output, HTTP excerpt, etc.). Use severity info when no proof exists yet.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['info', 'low', 'medium', 'high', 'critical'] },
          description: { type: 'string' },
          evidence: {
            type: 'string',
            description: 'Required for low–critical: command output lines, HTTP status/body snippet, or other verifiable proof from this run',
          },
          payload: { type: 'string' },
        },
        required: ['title', 'severity', 'description', 'evidence'],
      },
    },
  },
];
