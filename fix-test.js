const fs = require('fs');

let content = fs.readFileSync('tests/sites-worker.test.mjs', 'utf8');

content = content.replace(
`test("E2E: Chat message delivery", async () => {
  const env = await createTestEnv();
  const res = await worker.fetch(apiRequest("/api/chat", { method: "POST", body: { message: "hello" } }), env);
  assert.equal(res.status, 404);
});`,
`test("E2E: Chat message delivery", async () => {
  const env = await createTestEnv();
  const person1 = { id: "p-msg-1", token: "m1", nickname: "Alice", role: "mechanic", skills: ["AI"], greeting: "Hello from Alice!", socialEnergy: 3 };
  const person2 = { id: "p-msg-2", token: "m2", nickname: "Bob", role: "illusionist", skills: ["UI"], greeting: "Hello from Bob!", socialEnergy: 5 };

  await worker.fetch(apiRequest("/api/participants", { method: "POST", participantToken: person1.token, body: person1 }), env);
  await worker.fetch(apiRequest("/api/participants", { method: "POST", participantToken: person2.token, body: person2 }), env);

  await worker.fetch(apiRequest("/api/host/event", { method: "POST", hostToken: env.HOST_TOKEN, body: { mode: "countdown", durationSeconds: 5 } }), env);
  env.database.prepare("UPDATE event_state SET ends_at = 0 WHERE id = 1").run();
  await worker.fetch(apiRequest("/api/host/complete-round", { method: "POST", hostToken: env.HOST_TOKEN }), env);

  const matchRes = await worker.fetch(apiRequest(\`/api/matches/me?participantId=\${person1.id}\`, { participantToken: person1.token }), env);
  const matchData = await matchRes.json();
  assert.equal(matchData.match.id, person2.id);
  assert.equal(matchData.match.greeting, "Hello from Bob!");
});`);

fs.writeFileSync('tests/sites-worker.test.mjs', content);
