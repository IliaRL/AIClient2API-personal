/**
 * Unit tests for OpenAIConverter.toGeminiRequest() — tool-use conversion path.
 *
 * Gemini's strict requirement: messages must strictly alternate user/model roles.
 * These tests verify that all tool result formats produce valid Gemini conversations.
 */

import OpenAIConverter from '../../src/converters/strategies/OpenAIConverter.js';

const converter = new OpenAIConverter();

/**
 * Helper: extract the `contents` array from the Gemini request.
 * Also asserts no consecutive same-role messages (Gemini's hard constraint).
 */
function getContents(openaiMessages, extraFields = {}) {
    const result = converter.toGeminiRequest({ messages: openaiMessages, ...extraFields });
    const contents = result.contents || [];

    // Verify Gemini alternating-role invariant
    for (let i = 1; i < contents.length; i++) {
        if (contents[i].role === contents[i - 1].role) {
            throw new Error(
                `Gemini alternating-role violation at index ${i}: ` +
                `consecutive "${contents[i].role}" messages`
            );
        }
    }

    return contents;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. OpenAI-format tool result (role: 'tool')
// ─────────────────────────────────────────────────────────────────────────────
describe('OpenAI-format tool result (role: tool)', () => {
    const messages = [
        { role: 'user', content: 'List files in the current directory.' },
        {
            role: 'assistant',
            content: null,
            tool_calls: [{
                id: 'tc_001',
                type: 'function',
                function: { name: 'Bash', arguments: '{"command":"ls -la"}' }
            }]
        },
        {
            role: 'tool',
            tool_call_id: 'tc_001',
            content: 'total 8\ndrwxr-xr-x  5 user  staff  160 May 26 03:00 .\n'
        }
    ];

    test('produces a functionResponse node for the tool result', () => {
        const contents = getContents(messages);
        const toolNode = contents.find(c =>
            c.parts?.some(p => p.functionResponse)
        );
        expect(toolNode).toBeDefined();
        expect(toolNode.role).toBe('user');
        expect(toolNode.parts[0].functionResponse.name).toBe('Bash');
        expect(toolNode.parts[0].functionResponse.response.result).toContain('total 8');
    });

    test('alternating-role constraint is satisfied', () => {
        expect(() => getContents(messages)).not.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Anthropic-format tool result (role: 'user' + content[].type === 'tool_result')
//    THIS IS THE BUG: these items were previously silently dropped
// ─────────────────────────────────────────────────────────────────────────────
describe('Anthropic-format tool result (role: user with tool_result content)', () => {
    const messages = [
        { role: 'user', content: 'What files are here?' },
        {
            role: 'assistant',
            content: [
                { type: 'text', text: "I'll check that for you." },
                { type: 'tool_use', id: 'tu_001', name: 'Bash', input: { command: 'ls' } }
            ]
        },
        {
            role: 'user',
            content: [
                {
                    type: 'tool_result',
                    tool_use_id: 'tu_001',
                    content: 'src/\ntests/\npackage.json\n'
                }
            ]
        }
    ];

    test('produces a functionResponse node — not an empty/dropped node', () => {
        const contents = getContents(messages);
        const toolNode = contents.find(c =>
            c.parts?.some(p => p.functionResponse)
        );
        expect(toolNode).toBeDefined();
        expect(toolNode.role).toBe('user');
        expect(toolNode.parts[0].functionResponse.name).toBe('Bash');
        expect(toolNode.parts[0].functionResponse.response.result).toContain('src/');
    });

    test('tool_result node is not silently dropped (contents length > 1)', () => {
        const contents = getContents(messages);
        // Should have: user + model (with functionCall) + user (functionResponse)
        expect(contents.length).toBeGreaterThanOrEqual(2);
    });

    test('alternating-role constraint is satisfied', () => {
        expect(() => getContents(messages)).not.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Multiple consecutive tool calls → must merge into a single user node
// ─────────────────────────────────────────────────────────────────────────────
describe('Multiple consecutive tool results merge into one user node', () => {
    const messages = [
        { role: 'user', content: 'Show me files and git status.' },
        {
            role: 'assistant',
            content: null,
            tool_calls: [
                { id: 'tc_a', type: 'function', function: { name: 'Bash', arguments: '{"command":"ls"}' } },
                { id: 'tc_b', type: 'function', function: { name: 'Bash', arguments: '{"command":"git status"}' } }
            ]
        },
        { role: 'tool', tool_call_id: 'tc_a', content: 'src/ tests/' },
        { role: 'tool', tool_call_id: 'tc_b', content: 'On branch master\nnothing to commit' }
    ];

    test('both tool results land in a single merged user node', () => {
        const contents = getContents(messages);
        const toolNodes = contents.filter(c =>
            c.parts?.some(p => p.functionResponse)
        );
        // Both functionResponses must be in exactly ONE merged user node
        expect(toolNodes).toHaveLength(1);
        expect(toolNodes[0].parts.filter(p => p.functionResponse)).toHaveLength(2);
    });

    test('alternating-role constraint is satisfied', () => {
        expect(() => getContents(messages)).not.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Multi-turn: second turn after tool call has user message
// ─────────────────────────────────────────────────────────────────────────────
describe('Multi-turn conversation after tool use', () => {
    const messages = [
        { role: 'user', content: 'What is in src/?' },
        {
            role: 'assistant',
            content: null,
            tool_calls: [{
                id: 'tc_1',
                type: 'function',
                function: { name: 'Bash', arguments: '{"command":"ls src/"}' }
            }]
        },
        { role: 'tool', tool_call_id: 'tc_1', content: 'core/ providers/ converters/' },
        { role: 'assistant', content: 'The src directory contains core/, providers/, and converters/ folders.' },
        { role: 'user', content: 'Tell me more about providers/' }
    ];

    test('produces correct number of turns', () => {
        const contents = getContents(messages);
        // user → model(+functionCall) → user(functionResponse) → model → user
        expect(contents.length).toBe(5);
    });

    test('final message is the follow-up user turn', () => {
        const contents = getContents(messages);
        const last = contents[contents.length - 1];
        expect(last.role).toBe('user');
        expect(last.parts[0].text).toContain('providers/');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Missing tool_call_id / tool_use_id → graceful skip, no crash
// ─────────────────────────────────────────────────────────────────────────────
describe('Graceful handling of missing IDs', () => {
    test('role:tool with unknown tool_call_id is skipped without throwing', () => {
        const messages = [
            { role: 'user', content: 'Hello' },
            { role: 'tool', tool_call_id: 'unknown_id', content: 'some result' }
        ];
        expect(() => getContents(messages)).not.toThrow();
    });

    test('tool_result with unknown tool_use_id is skipped without throwing', () => {
        const messages = [
            { role: 'user', content: 'Hello' },
            {
                role: 'user',
                content: [{ type: 'tool_result', tool_use_id: 'unknown_id', content: 'result' }]
            }
        ];
        expect(() => getContents(messages)).not.toThrow();
    });
});
