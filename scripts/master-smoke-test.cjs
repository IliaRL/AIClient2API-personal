const http = require('http');

const API_KEY = 'sk-a60f3efdf9b97e63c84ab4a3583f9d1c';
const PORT = 3000;
const HOST = '127.0.0.1';

async function makeRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
        if (options.onChunk) options.onChunk(chunk.toString());
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: data
        });
      });
    });

    req.on('error', (e) => reject(e));
    if (postData) req.write(JSON.stringify(postData));
    req.end();
  });
}

async function testChat(model) {
  console.log(`\n[Chat] Testing ${model}...`);
  const start = Date.now();
  const res = await makeRequest({
    hostname: HOST,
    port: PORT,
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    }
  }, {
    model: model,
    max_tokens: 50,
    messages: [{ role: 'user', content: 'Say hello world' }]
  });

  const duration = Date.now() - start;
  if (res.statusCode === 200) {
    const json = JSON.parse(res.data);
    console.log(`✅ Success (${duration}ms): ${json.content[0].text}`);
    return duration;
  } else {
    console.log(`❌ Failed (${res.statusCode}): ${res.data}`);
    return duration;
  }
}

async function testStreaming(model) {
  console.log(`\n[Stream] Testing ${model}...`);
  let chunkCount = 0;
  const start = Date.now();
  const res = await makeRequest({
    hostname: HOST,
    port: PORT,
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    onChunk: (chunk) => {
      if (chunk.includes('data:')) chunkCount++;
    }
  }, {
    model: model,
    max_tokens: 50,
    stream: true,
    messages: [{ role: 'user', content: 'Count from 1 to 5' }]
  });

  const duration = Date.now() - start;
  if (res.statusCode === 200 && chunkCount > 0) {
    console.log(`✅ Success (${duration}ms, ${chunkCount} chunks received)`);
  } else {
    console.log(`❌ Failed (${res.statusCode}): ${res.data}`);
  }
}

async function testToolUse(model) {
  console.log(`\n[Tool] Testing ${model}...`);
  const res = await makeRequest({
    hostname: HOST,
    port: PORT,
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    }
  }, {
    model: model,
    max_tokens: 1024,
    tools: [{
      name: 'calculate_sum',
      description: 'Calculate the sum of two numbers',
      input_schema: {
        type: 'object',
        properties: {
          a: { type: 'number' },
          b: { type: 'number' }
        },
        required: ['a', 'b']
      }
    }],
    messages: [{ role: 'user', content: 'What is 123 + 456? Use the calculate_sum tool.' }]
  });

  if (res.statusCode === 200) {
    const json = JSON.parse(res.data);
    const toolUse = json.content.find(c => c.type === 'tool_use');
    if (toolUse && toolUse.name === 'calculate_sum') {
      console.log(`✅ Success: Model called ${toolUse.name} with ${JSON.stringify(toolUse.input)}`);
    } else {
      console.log(`❌ Failed: No tool call found in response: ${JSON.stringify(json.content)}`);
    }
  } else {
    console.log(`❌ Failed (${res.statusCode}): ${res.data}`);
  }
}

async function testSchemaGuard(model) {
  console.log(`\n[Schema Guard] Testing ${model} (Flattening)...`);
  const res = await makeRequest({
    hostname: HOST,
    port: PORT,
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    }
  }, {
    model: model,
    max_tokens: 1024,
    tools: [{
      name: 'Skill',
      description: 'Execute a skill',
      input_schema: {
        type: 'object',
        properties: {
          skill: { type: 'string' },
          args: { type: 'string' }
        },
        required: ['skill']
      }
    }],
    // Force a "bad" input that the proxy should fix
    messages: [{
      role: 'user',
      content: 'Run the test skill with args: {"nested": "value"}. Use the Skill tool.'
    }]
  });

  if (res.statusCode === 200) {
    const json = JSON.parse(res.data);
    const toolUse = json.content.find(c => c.type === 'tool_use');
    if (toolUse && toolUse.name === 'Skill') {
      const argsType = typeof toolUse.input.args;
      if (argsType === 'string') {
        console.log(`✅ Success: Tool call argument was flattened to string: ${toolUse.input.args}`);
      } else {
        console.log(`❌ Failed: Argument remains ${argsType}, expected string. Value: ${JSON.stringify(toolUse.input.args)}`);
      }
    } else {
      console.log(`❌ Failed: No tool call found in response: ${JSON.stringify(json.content)}`);
    }
  } else {
    console.log(`❌ Failed (${res.statusCode}): ${res.data}`);
  }
}

async function run() {
  console.log('Starting Master Smoke Test...');

  // 1. Antigravity Warmup Test
  console.log('\n--- 1. Antigravity Warmup ---');
  const duration1 = await testChat('gemini-3-flash');
  if (duration1 > 30000) {
    console.log('ℹ️ First call took >30s (expected for Antigravity OAuth bootstrap)');
  } else {
    console.log(`ℹ️ First call took ${duration1}ms (already warm or fast)`);
  }

  // 2. Chat Test (Other provider)
  console.log('\n--- 2. Standard Chat ---');
  await testChat('claude-sonnet-4-6');

  // 3. Streaming Test
  console.log('\n--- 3. Streaming ---');
  await testStreaming('claude-sonnet-4-6');

  // 4. Tool Use Test
  console.log('\n--- 4. Tool Use ---');
  await testToolUse('claude-sonnet-4-6');

  // 5. Schema Guard Test (Flattening)
  console.log('\n--- 5. Schema Guard (Flattening) ---');
  await testSchemaGuard('claude-sonnet-4-6');

  // 6. Claude-pick Routing Test
  console.log('\n--- 6. Claude-pick Routing (High-Tier) ---');
  // Tests the routing for models typically used by claude-pick
  const highTierModels = ['claude-sonnet-4-6', 'gemini-3.1-pro-low', 'gpt-4o'];
  for (const model of highTierModels) {
    await testChat(model);
  }

  // 7. Identity Verification Test
  console.log('\n--- 7. Identity Verification ---');
  const identityRes = await makeRequest({
    hostname: HOST, port: PORT, path: '/v1/messages', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` }
  }, {
    model: 'gemini-3-flash',
    max_tokens: 10,
    messages: [{ role: 'user', content: 'respond with ok' }]
  });
  if (identityRes.statusCode === 200) {
    const json = JSON.parse(identityRes.data);
    if (json.model === 'gemini-3-flash') {
      console.log('✅ Success: Model identity preserved in response');
    } else {
      console.log(`❌ Failed: Model identity mismatch. Expected gemini-3-flash, got ${json.model}`);
    }
  }

  console.log('\nMaster Smoke Test Completed.');
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
