// Private child of the browser workflows. Serve the production build with a fully
// stubbed server-side fetch: no test prompts or credentials can leave via a gateway.
import { createServer } from 'node:http';
import next from 'next';

if (!process.send || process.env.OPENCODE_BASE_URL !== 'https://profile-test.invalid/v1') {
  throw new Error('Run via npm run test:profiles:ui with its disposable database.');
}
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const planProbe = process.env.TEST_GATEWAY_PLANS === '1' && [
    'https://opencode.ai/inference/go/openai/v1/chat/completions',
    'https://opencode.ai/inference/openai/v1/chat/completions',
  ].includes(request.url);
  if (!planProbe && request.url !== `${process.env.OPENCODE_BASE_URL}/chat/completions`) throw new Error('Test egress blocked');
  const { messages, model, temperature } = await request.json();
  const routingId = request.headers.get('x-opencode-session');
  if (planProbe) {
    if (request.headers.get('user-agent') !== 'coworkerz/1.0' || !/^ses_[a-f0-9]{32}$/.test(routingId || '')) return new Response(null, {status: 400});
    if (!request.headers.has('authorization')) return new Response(null, {status: 401});
    if (model.endsWith('-free')) return new Response(null, {status: 403}); // synthetic denial, not a live entitlement check
    if (model !== 'kimi-k3') return new Response(null, {status: 404});
  }
  const turn = messages[0].content.includes('executive-turn/v3');
  if (turn) process.send({ type: 'turn', messages, model, temperature, routingId }); // only in-memory, synthetic inputs
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
