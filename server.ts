// 服务端入口：`node server.ts`
import { createApp } from './src/server/app.ts';

const port = Number(process.env.PORT ?? 8787);
const persistPath = process.env.STATE_PATH ?? 'data/state.json';
const { server } = createApp(persistPath);

server.listen(port, () => {
  console.log(`[agent-workflow] server listening on http://localhost:${port}`);
  console.log(`[agent-workflow] state file: ${persistPath}`);
});
