import fs from 'fs';
const f1 = '/Users/ilialiston/AIClient2API/src/handlers/api-handlers.js';
const f2 = '/Users/ilialiston/AIClient2API/src/utils/request-handlers.js';

let content1 = fs.readFileSync(f1, 'utf8');
if (!content1.includes('DEBUG: api-handlers.js')) {
  fs.writeFileSync(f1, content1.replace(
    'export async function handleContentGenerationRequest(req, res, service, endpointType, CONFIG, PROMPT_LOG_FILENAME, providerPoolManager, pooluuid, requestPath = null) {',
    'export async function handleContentGenerationRequest(req, res, service, endpointType, CONFIG, PROMPT_LOG_FILENAME, providerPoolManager, pooluuid, requestPath = null) {\n    console.log("DEBUG: api-handlers.js handleContentGenerationRequest CALLED!");'
  ));
}

let content2 = fs.readFileSync(f2, 'utf8');
if (!content2.includes('DEBUG: request-handlers.js')) {
  fs.writeFileSync(f2, content2.replace(
    'export async function handleContentGenerationRequest(req, res, service, endpointType, CONFIG, PROMPT_LOG_FILENAME, providerPoolManager = null, pooluuid = null, requestPath = null) {',
    'export async function handleContentGenerationRequest(req, res, service, endpointType, CONFIG, PROMPT_LOG_FILENAME, providerPoolManager = null, pooluuid = null, requestPath = null) {\n    console.log("DEBUG: request-handlers.js handleContentGenerationRequest CALLED!");'
  ));
}
