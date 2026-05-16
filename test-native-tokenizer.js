import { countTextTokens } from './src/utils/token-utils.js';
import logger from './src/utils/logger.js';

async function runTest() {
    console.log('--- Tokenizer Performance Test ---');

    const largeText = 'This is a test. '.repeat(100000); // ~400k tokens
    console.log(`Testing with ${largeText.length} characters...`);

    const start = Date.now();
    const tokens = countTextTokens(largeText, 'claude');
    const end = Date.now();

    console.log(`Result: ${tokens} tokens`);
    console.log(`Time taken: ${end - start}ms`);

    if (end - start > 100) {
        console.log('Performance: JS Fallback active (slow)');
    } else {
        console.log('Performance: Native Rust active (FAST!)');
    }
}

runTest().catch(console.error);
