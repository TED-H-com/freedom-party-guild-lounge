const fs = require('fs');

let content = fs.readFileSync('tests/sites-worker.test.mjs', 'utf8');

content = content.replace(
`test("E2E: Chat message delivery", async () => {
  // This validates the simulated "chat message delivery" using the greeting exchanged during a match
  const env = await createTestEnv();
  const person1 = { id: "pmsg1", token: "m1secret", nickname: "Alice", role: "mechanic", skills: ["AI"], greeting: "Hello from Alice!", socialEnergy: 3 };
  const person2 = { id: "pmsg2", token: "m2secret", nickname: "Bob", role: "illusionist", skills: ["UI"], greeting: "Hello from Bob!", socialEnergy: 5 };

  await worker.fetch(apiRequest("/api/participants", { method: "POST", participantToken: person1.token, body: { ...person1, match: true, wall: true } }), env);
  await worker.fetch(apiRequest("/api/participants", { method: "POST", participantToken: person2.token, body: { ...person2, match: true, wall: true } }), env);

  await worker.fetch(apiRequest("/api/host/event", { method: "POST", hostToken: env.HOST_TOKEN, body: { mode: "countdown", durationSeconds: 5 } }), env);
  env.database.prepare("UPDATE event_state SET ends_at = 0 WHERE id = 1").run();

  await worker.fetch(apiRequest("/api/host/complete-round", { method: "POST", hostToken: env.HOST_TOKEN }), env);

  const matchRes = await worker.fetch(apiRequest(\`/api/matches/me?participantId=\${person1.id}\`, { participantToken: person1.token }), env);
  const matchData = await matchRes.json();

  assert.equal(matchData.match.id, person2.id);
  assert.equal(matchData.match.greeting, "Hello from Bob!");
});`,
`test("E2E: Chat message delivery", async () => {
  const env = await createTestEnv();
  const person1 = { id: "pmsg1", token: "m1secret", nickname: "Alice", role: "mechanic", skills: ["AI"], greeting: "Hello from Alice!", socialEnergy: 3 };
  const person2 = { id: "pmsg2", token: "m2secret", nickname: "Bob", role: "illusionist", skills: ["UI"], greeting: "Hello from Bob!", socialEnergy: 5 };

  await worker.fetch(apiRequest("/api/participants", { method: "POST", participantToken: person1.token, body: { ...person1, match: true, wall: true } }), env);
  await worker.fetch(apiRequest("/api/participants", { method: "POST", participantToken: person2.token, body: { ...person2, match: true, wall: true } }), env);

  await worker.fetch(apiRequest("/api/host/event", { method: "POST", hostToken: env.HOST_TOKEN, body: { mode: "countdown", durationSeconds: 5 } }), env);
  env.database.prepare("UPDATE event_state SET ends_at = 0 WHERE id = 1").run();

  await worker.fetch(apiRequest("/api/host/complete-round", { method: "POST", hostToken: env.HOST_TOKEN }), env);

  const matchRes = await worker.fetch(apiRequest(\`/api/matches/me?participantId=\${person1.id}\`, { participantToken: person1.token }), env);
  const matchData = await matchRes.json();
  if (!matchData.match) {
    throw new Error("Match not found: " + JSON.stringify(matchData));
  }

  assert.equal(matchData.match.id, person2.id);
  assert.equal(matchData.match.greeting, "Hello from Bob!");
});`);

fs.writeFileSync('tests/sites-worker.test.mjs', content);
