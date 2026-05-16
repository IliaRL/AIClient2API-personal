import { ProviderPoolManager } from '../src/providers/provider-pool-manager.js';
import fs from 'fs';
import path from 'path';

const configPath = '/Users/ilialiston/AIClient2API/configs/config.json';
const poolsPath = '/Users/ilialiston/AIClient2API/configs/provider_pools.json';

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const pools = JSON.parse(fs.readFileSync(poolsPath, 'utf8'));

const manager = new ProviderPoolManager(pools, { globalConfig: config });

async function test() {
    console.log('Testing acquireSlot for claude-kiro-oauth...');
    try {
        const slot = await manager.acquireSlot('claude-kiro-oauth', 'claude-haiku-4-5');
        if (slot) {
            console.log('Successfully acquired slot:', slot.uuid);
            manager.releaseSlot('claude-kiro-oauth', slot.uuid);
            console.log('Successfully released slot');
        } else {
            console.log('Failed to acquire slot: No healthy providers');
        }
    } catch (err) {
        console.error('Test failed with error:', err);
    }

    console.log('\nTesting isModelOnCooldown...');
    manager.markModelCooldown('gemini-antigravity', 'gemini-3-flash', 5000);
    console.log('Is on cooldown (expected true):', manager.isModelOnCooldown('gemini-antigravity', 'gemini-3-flash'));

    await new Promise(r => setTimeout(r, 6000));
    console.log('Is on cooldown after 6s (expected false):', manager.isModelOnCooldown('gemini-antigravity', 'gemini-3-flash'));
}

test();
