import { initApiService, getApiServiceWithFallback } from './src/services/service-manager.js';
import fs from 'fs';

async function test() {
    const config = JSON.parse(fs.readFileSync('./configs/config.json', 'utf8'));
    config.providerPools = JSON.parse(fs.readFileSync('./configs/provider_pools.json', 'utf8'));
    config.MODEL_PROVIDER = 'claude-kiro-oauth';
    
    await initApiService(config);
    const result = await getApiServiceWithFallback(config, 'claude-sonnet-4-6');
    console.log("Provider:", result.actualProviderType);
    console.log("Model:", result.actualModel);
}

test().catch(console.error);
