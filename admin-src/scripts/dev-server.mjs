// Dev server for the admin shell. The editor runtime is served as source modules
// (no stage-1 build needed) and the live site files come from the repo root.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, configFile: path.join(root, 'vite.config.js') });
await server.listen();
server.printUrls();
