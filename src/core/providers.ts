/** The two subscription CLIs whose accounts are managed: Claude Code and the Codex CLI (ChatGPT). */
export const providers = ['claude-cli', 'codex-cli'] as const;
export type Provider = (typeof providers)[number];
