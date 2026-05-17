import { convertData } from '../convert/convert.js';
import { MODEL_PROVIDER } from '../utils/common.js';
import { CONFIG } from '../core/config-manager.js';

/**
 * 获取模型配置元数据
 * @param {string} modelId - 模型 ID 或别名
 * @param {string|null} provider - 自定义模型归属的提供商
 * @returns {Object|null} 模型配置
 */
export function getCustomModelConfig(modelId, provider = null) {
    if (!CONFIG.customModels || !Array.isArray(CONFIG.customModels)) {
        return null;
    }

    let targetProvider = provider && provider !== MODEL_PROVIDER.AUTO ? provider : null;
    let targetModelId = modelId;

    // Only treat "prefix:rest" as provider:model when prefix has no slash
    // (provider names are simple tokens; model IDs like "openai/gpt-oss-20b:free" must not be split)
    if (typeof modelId === 'string' && modelId.includes(':')) {
        const [prefix, ...modelParts] = modelId.split(':');
        if (!prefix.includes('/')) {
            targetProvider = prefix;
            targetModelId = modelParts.join(':');
        }
    }

    if (!targetProvider) {
        return CONFIG.customModels.find(m =>
            !m.provider &&
            (m.id === targetModelId || m.alias === targetModelId)
        ) || null;
    }

    return CONFIG.customModels.find(m =>
        m.provider === targetProvider &&
        (m.id === targetModelId || m.alias === targetModelId)
    ) || null;
}

/**
 * 各提供商支持的模型列表
 * 用于前端UI选择不支持的模型
 */
export const PROVIDER_MODELS = {
    'gemini-cli-oauth': [
        // Active gemini-cli-oauth models (gemma removed 2026-05-15 — no longer
        // exposed on the upstream account).
        'gemini-3.1-pro-preview',
        'gemini-3-flash-preview',
        'gemini-3.1-flash-lite-preview',
        'gemini-2.5-pro',
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
    ],
    'gemini-antigravity': [
        'gemini-3-flash',
        'gemini-3.1-pro-high',
        'gemini-3.1-pro-low',
        'gemini-claude-sonnet-4-6',
        'gemini-claude-opus-4-6-thinking',
    ],
    'claude-custom': [],
    'claude-kiro-oauth': [
        // Only these three models are verified live on this account. Re-add others only after confirming access.
        'claude-haiku-4-5',
        'claude-sonnet-4-5',
        'claude-sonnet-4-5-20250929',
    ],
    'openai-custom': [],
    'openaiResponses-custom': [],
    'openai-qwen-oauth': [
        'coder-model',
        'vision-model',
        'qwen3-coder-plus',
        'qwen3-coder-flash',
    ],
    'openai-iflow': [
        // iFlow 特有模型
        'iflow-rome-30ba3b',
        // Qwen 模型
        'qwen3-coder-plus',
        'qwen3-max',
        'qwen3-vl-plus',
        'qwen3-max-preview',
        'qwen3-32b',
        'qwen3-235b-a22b-thinking-2507',
        'qwen3-235b-a22b-instruct',
        'qwen3-235b',
        // Kimi 模型
        'kimi-k2-0905',
        'kimi-k2',
        // GLM 模型
        'glm-4.6',
        // DeepSeek 模型
        'deepseek-v3.2',
        'deepseek-r1',
        'deepseek-v3',
        // 手动定义
        'glm-4.7',
        'glm-5',
        'kimi-k2.5',
        'minimax-m2.1',
        'minimax-m2.5',
    ],
    'openai-codex-oauth': [
        // Verified live on 2026-05-15. gpt-5.3-codex-spark returned 400 invalid
        // request upstream and was removed; re-add if Codex enables it.
        'gpt-5.2',
        'gpt-5.3-codex',
        'gpt-5.4',
        'gpt-5.4-mini',
        'gpt-5.5',
    ],
    'github-models': [
        // Exhaustively live-verified 2026-05-16 against models.inference.ai.azure.com.
        // Dead: gpt-5-mini (unavailable), claude-haiku-4-5 (unknown), o3-mini (unavailable),
        //       o1/o1-mini/o1-preview (unavailable), all Mistral variants (unknown),
        //       Meta-Llama 70B/3.3/3.2 (unknown), Phi-3.5, Cohere, AI21 (unknown).
        'gpt-4o',
        'gpt-4o-mini',
        'gpt-4.1',
        'gpt-4.1-mini',
        'gpt-4.1-nano',
        'DeepSeek-R1',
        'DeepSeek-V3-0324',
        'Meta-Llama-3.1-405B-Instruct',
        'Meta-Llama-3.1-8B-Instruct',
        'Phi-4'
    ],
    'nvidia-nim': [
        // Verified live against integrate.api.nvidia.com on 2026-05-15 with the
        // configured account. Older entries (nvidia/llama-3.1-nemotron-ultra-253b,
        // qwen/qwen3-235b-a22b, microsoft/phi-4-reasoning-plus,
        // deepseek-ai/deepseek-r1-0528, google/gemma-3-27b-it,
        // moonshotai/kimi-k2-instruct, nvidia/llama-3.3-nemotron-super-49b)
        // 404/410 on this key and were removed.
        'nvidia/llama-3.3-nemotron-super-49b-v1.5',
        'nvidia/llama-3.3-nemotron-super-49b-v1',
        'meta/llama-4-maverick-17b-128e-instruct',
        'meta/llama-3.3-70b-instruct',
        'moonshotai/kimi-k2.6',
        'mistralai/mistral-small-4-119b-2603',
        'openai/gpt-oss-120b'
    ],
    'forward-api': [],
    'grok-web': [
        'grok-4.1-mini',
        'grok-4.1-thinking',
        'grok-4.20',
        'grok-4.20-auto',
        'grok-4.20-fast',
        'grok-4.20-expert',
        'grok-4.20-heavy',
        'grok-imagine-1.0',
        'grok-imagine-1.0-edit',
        'grok-imagine-1.0-fast',
        'grok-imagine-1.0-fast-edit',
    ]
};

export const MANAGED_MODEL_LIST_PROVIDERS = [
    'openai-custom',
    'openaiResponses-custom',
    'claude-custom'
];

export function getManagedModelListProviderType(providerType) {
    return MANAGED_MODEL_LIST_PROVIDERS.find(baseType =>
        providerType === baseType || providerType.startsWith(baseType + '-')
    ) || null;
}

export function usesManagedModelList(providerType) {
    return getManagedModelListProviderType(providerType) !== null;
}

export function normalizeModelIds(models = []) {
    return [...new Set(
        (Array.isArray(models) ? models : [])
            .filter(model => typeof model === 'string')
            .map(model => model.trim())
            .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b));
}

export function getCustomModelActualProvider(modelConfig) {
    if (!modelConfig) {
        return '';
    }
    if (Object.prototype.hasOwnProperty.call(modelConfig, 'actualProvider')) {
        return modelConfig.actualProvider || '';
    }
    return modelConfig.provider || '';
}

export function getCustomModelListProvider(modelConfig) {
    return modelConfig?.provider || getCustomModelActualProvider(modelConfig);
}

export function customModelMatchesProvider(modelConfig, providerType) {
    const listProvider = getCustomModelListProvider(modelConfig);
    return listProvider === providerType || (listProvider && providerType.startsWith(listProvider + '-'));
}

function extractModelIdsFromListShape(modelList) {
    if (!modelList) {
        return [];
    }

    if (Array.isArray(modelList)) {
        return modelList.map(item => {
            if (typeof item === 'string') return item;
            return item?.id || item?.name || item?.model || null;
        }).filter(Boolean);
    }

    if (Array.isArray(modelList.data)) {
        return modelList.data.map(item => item?.id || item?.name || item?.model || null).filter(Boolean);
    }

    if (Array.isArray(modelList.models)) {
        return modelList.models.map(item => {
            if (typeof item === 'string') return item;
            return item?.id || item?.name || item?.model || null;
        }).filter(Boolean);
    }

    return [];
}

export function extractModelIdsFromNativeList(modelList, providerType) {
    let convertedModelList = modelList;

    // 只有在提供商类型与目标类型协议不同时才尝试转换
    if (providerType !== MODEL_PROVIDER.OPENAI_CUSTOM && !providerType.startsWith(MODEL_PROVIDER.OPENAI_CUSTOM + '-')) {
        try {
            convertedModelList = convertData(modelList, 'modelList', providerType, MODEL_PROVIDER.OPENAI_CUSTOM);
        } catch {
            convertedModelList = modelList;
        }
    }

    const convertedIds = normalizeModelIds(extractModelIdsFromListShape(convertedModelList));
    if (convertedIds.length > 0) {
        return convertedIds;
    }

    return normalizeModelIds(extractModelIdsFromListShape(modelList));
}

export function getConfiguredSupportedModels(providerType, providerConfig = {}) {
    if (!usesManagedModelList(providerType)) {
        return [];
    }

    return normalizeModelIds(providerConfig?.supportedModels);
}

/**
 * 获取指定提供商类型支持的模型列表
 * @param {string} providerType - 提供商类型
 * @returns {Array<string>} 模型列表
 */
export function getProviderModels(providerType) {
    let models = [];
    if (PROVIDER_MODELS[providerType]) {
        models = [...PROVIDER_MODELS[providerType]];
    } else {
        // 尝试前缀匹配 (例如 openai-custom-1 -> openai-custom)
        for (const key of Object.keys(PROVIDER_MODELS)) {
            if (providerType.startsWith(key + '-')) {
                models = [...PROVIDER_MODELS[key]];
                break;
            }
        }
    }

    // 注入自定义模型
    if (CONFIG.customModels && Array.isArray(CONFIG.customModels)) {
        CONFIG.customModels.forEach(m => {
            // 匹配模型列表归属提供商或其后缀分组
            if (customModelMatchesProvider(m, providerType)) {
                // 注入 ID
                if (!models.includes(m.id)) {
                    models.push(m.id);
                }
            }
        });
    }

    return normalizeModelIds(models);
}

/**
 * 获取所有提供商的模型列表
 * @returns {Object} 所有提供商的模型映射
 */
export function getAllProviderModels() {
    // 执行深拷贝，避免修改原始 PROVIDER_MODELS 对象
    const allModels = {};
    for (const provider in PROVIDER_MODELS) {
        allModels[provider] = [...PROVIDER_MODELS[provider]];
    }
    
    // 合并自定义模型到对应的提供商
    if (CONFIG.customModels && Array.isArray(CONFIG.customModels)) {
        CONFIG.customModels.forEach(m => {
            // 如果指定了模型列表归属提供商，注入到该提供商
            // 如果没有指定（Auto），则注入到特殊的虚拟分组
            const targetProvider = getCustomModelListProvider(m) || 'custom-auto';
            
            if (!allModels[targetProvider]) {
                allModels[targetProvider] = [];
            }
            
            // 注入 ID
            if (!allModels[targetProvider].includes(m.id)) {
                allModels[targetProvider].push(m.id);
            }
        });
    }
    
    // 对每个列表进行排序
    for (const provider in allModels) {
        allModels[provider] = normalizeModelIds(allModels[provider]);
    }
    
    return allModels;
}
