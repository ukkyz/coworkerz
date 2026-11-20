// Private child of customize-bots.spec.ts. Serve the production build with a fully
// stubbed server-side fetch: no test prompts or credentials can leave via a gateway.
import { createServer } from 'node:http';
import next from 'next';

if (!process.send || process.env.OPENCODE_BASE_URL !== 'https://profile-test.invalid/v1') {
  throw new Error('Run via npm run test:profiles:ui with its disposable database.');
}
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  if (request.url !== `${process.env.OPENCODE_BASE_URL}/chat/completions`) throw new Error('Test egress blocked');
  const { messages, model, temperature } = await request.json();
  const turn = messages[0].content.includes('executive-turn/v3');
  if (turn) process.send({ type: 'turn', messages, model, temperature }); // only in-memory, synthetic inputs
  const raw = turn ? {
    dialogue: 'CEO, measure pilot onboarding hours. Compare against the baseline before committing.',
    knowledgeTopic: 'Measure The Pilot Baseline', knowledgeInsight: 'Measure before making a decision.',
    knowledgeCategory: model.includes('mimo') ? 'finance' : 'architecture', confidenceScore: 91, tags: ['pilot', 'baseline', 'gate'],
  } : { note: 'Synthetic non-turn response.' };
  return Response.json({ choices: [{ message: { content: JSON.stringify(raw) } }] });
};

const app = next({ dev: false, hostname: '127.0.0.1' });
await app.prepare();
const server = createServer(app.getRequestHandler());
server.listen(0, '127.0.0.1', () => process.send({ type: 'ready', port: server.address().port }));
process.once('disconnect', async () => {
  server.close();
  server.closeAllConnections();
  await app.close();
  process.exit(0);
});
