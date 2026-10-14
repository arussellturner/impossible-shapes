import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';

const GITHUB_REPO = 'arussellturner/impossible-shapes';

function getGitHubToken(): string | null {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.VITE_GITHUB_TOKEN) return process.env.VITE_GITHUB_TOKEN;
  try {
    const out = execSync('printf "protocol=https\\nhost=github.com\\n\\n" | git credential fill', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const match = out.match(/^password=(.+)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

function attachSuggestionEndpoint(
  middlewares: {
    use: (
      route: string,
      fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void
    ) => void;
  }
) {
  const handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.method !== 'POST') {
      next();
      return;
    }

    let rawBody = '';
    req.on('data', (chunk) => {
      rawBody += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const payload = JSON.parse(rawBody || '{}') as {
          title?: string;
          category?: string;
          description?: string;
          submitter?: string;
          includeSceneContext?: boolean;
          sceneContext?: {
            presetId?: string;
            orientation?: string;
            blockCount?: number;
            weldCount?: number;
            blocks?: Array<{ x: number; y: number; z: number }>;
          };
        };

        const title = (payload.title || '').trim();
        const description = (payload.description || '').trim();
        const category = (payload.category || 'enhancement').trim();
        const submitter = (payload.submitter || '').trim();

        if (!title || !description) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Please provide both a title and a description.' }));
          return;
        }

        const token = getGitHubToken();
        if (!token) {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: 'GitHub token not available on server; use fallback URL.',
              fallback: true,
            })
          );
          return;
        }

        const categoryLabels: Record<string, string> = {
          enhancement: 'enhancement',
          ux: 'enhancement',
          geometry: 'enhancement',
          bug: 'bug',
        };
        const label = categoryLabels[category] || 'enhancement';

        const bodyLines: string[] = [
          `### Suggestion Summary`,
          `**Category:** \`${category}\``,
          submitter ? `**Submitted by:** ${submitter}` : '',
          '',
          '### Description',
          description,
        ].filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''));

        if (payload.includeSceneContext && payload.sceneContext) {
          const sc = payload.sceneContext;
          bodyLines.push(
            '',
            '---',
            '<details>',
            '<summary><strong>Canvas Shape Snapshot (Diagnostic Context)</strong></summary>',
            '',
            `- **Active Preset:** \`${sc.presetId ?? 'custom'}\``,
            `- **Orientation:** \`${sc.orientation ?? 'penrose-horizontal'}\``,
            `- **Blocks:** ${sc.blockCount ?? 0}`,
            `- **Escher Welds:** ${sc.weldCount ?? 0}`,
            '',
            '```json',
            JSON.stringify(sc.blocks ?? []),
            '```',
            '</details>'
          );
        }

        const issueTitle = title.startsWith('[Suggestion]') ? title : `[Suggestion] ${title}`;

        const ghRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'User-Agent': 'EscherCAD-Suggestion-Bot',
          },
          body: JSON.stringify({
            title: issueTitle,
            body: bodyLines.join('\n'),
            labels: [label],
          }),
        });

        const ghData = (await ghRes.json()) as {
          number?: number;
          html_url?: string;
          title?: string;
          message?: string;
        };

        if (!ghRes.ok || !ghData.html_url) {
          res.statusCode = ghRes.status || 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: ghData.message || 'Failed to create GitHub issue.',
            })
          );
          return;
        }

        res.statusCode = 201;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            number: ghData.number,
            html_url: ghData.html_url,
            title: ghData.title,
          })
        );
      } catch (err) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            error: err instanceof Error ? err.message : 'Unexpected server error',
          })
        );
      }
    });
  };
  middlewares.use('/api/suggestions', handler);
  middlewares.use('/impossible-shapes/api/suggestions', handler);
}

function githubSuggestionPlugin(): Plugin {
  return {
    name: 'github-suggestion-api',
    configureServer(server) {
      attachSuggestionEndpoint(server.middlewares);
    },
    configurePreviewServer(server) {
      attachSuggestionEndpoint(server.middlewares);
    },
  };
}

export default defineConfig({
  base: '/impossible-shapes/',
  plugins: [react(), githubSuggestionPlugin()],
});
