const fs = require('fs');

let content = fs.readFileSync('tests/sites-worker.test.mjs', 'utf8');

content = content.replace(
`test("E2E: Chat message delivery", async () => {
  const env = await createTestEnv();
  // We need to use valid token strings that hash correctly for tests
  // the helper creates DB participants by posting to /api/participants
  const person1 = { id: "p-msg-1", token: "m1secret", nickname: "Alice", role: "mechanic", skills: ["AI"], greeting: "Hello from Alice!", socialEnergy: 3, match: true, wall: true };
  const person2 = { id: "p-msg-2", token: "m2secret", nickname: "Bob", role: "illusionist", skills: ["UI"], greeting: "Hello from Bob!", socialEnergy: 5, match: true, wall: true };

  await worker.fetch(apiRequest("/api/participants", { method: "POST", participantToken: person1.token, body: person1 }), env);
  await worker.fetch(apiRequest("/api/participants", { method: "POST", participantToken: person2.token, body: person2 }), env);

  await worker.fetch(apiRequest("/api/host/event", { method: "POST", hostToken: env.HOST_TOKEN, body: { mode: "countdown", durationSeconds: 5 } }), env);
  env.database.prepare("UPDATE event_state SET ends_at = 0 WHERE id = 1").run();

  await worker.fetch(apiRequest("/api/host/complete-round", { method: "POST", hostToken: env.HOST_TOKEN }), env);

  // Fix: handleMyMatch calls requireParticipant which checks the token.
  // We need to set the participantToken parameter in apiRequest
  const matchRes = await worker.fetch(apiRequest(\`/api/matches/me?participantId=\${person1.id}\`, { participantToken: person1.token }), env);
  const matchData = await matchRes.json();
  if (!matchData.match) {
    throw new Error("Match not found: " + JSON.stringify(matchData));
  }

  assert.equal(matchData.match.id, person2.id);
  assert.equal(matchData.match.greeting, "Hello from Bob!");
});`,
`test("E2E: Chat message delivery", async () => {
  const env = await createTestEnv();
  const people = [
    { id: "person-msg1", token: "msg-alpha-secret", nickname: "光子", role: "mechanic", skills: ["AI"], greeting: "Hello Alice", socialEnergy: 1 },
    { id: "person-msg2", token: "msg-bravo-secret", nickname: "小璐", role: "illusionist", skills: ["設計"], greeting: "Hello Bob", socialEnergy: 5 },
  ];

  for (const person of people) {
    await worker.fetch(apiRequest("/api/participants", {
      method: "POST",
      participantToken: person.token,
      body: { ...person, wall: true, match: true },
    }), env);
  }

  await worker.fetch(apiRequest("/api/host/event", {
    method: "POST", hostToken: env.HOST_TOKEN, body: { mode: "countdown", durationSeconds: 5 },
  }), env);
  env.database.prepare("UPDATE event_state SET ends_at = 0 WHERE id = 1").run();
  await worker.fetch(apiRequest("/api/host/complete-round", { method: "POST", hostToken: env.HOST_TOKEN }), env);

  const matchResponse = await worker.fetch(apiRequest(\`/api/matches/me?participantId=\${people[0].id}\`, { participantToken: people[0].token }), env);
  const matchData = await matchResponse.json();

  if (!matchData.match) {
    throw new Error("Match not found: " + JSON.stringify(matchData));
  }

  assert.equal(matchData.match.id, people[1].id);
  assert.equal(matchData.match.greeting, "Hello Bob");
});`);

fs.writeFileSync('tests/sites-worker.test.mjs', content);
