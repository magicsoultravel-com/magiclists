const providers = new Map();

export function registerCloudProvider(id, factory) {
    providers.set(id, factory);
}

export function getCloudProvider(id) {
    const factory = providers.get(id);
    if (!factory) throw new Error(`Unknown cloud provider: ${id}`);
    return factory();
}

export function listCloudProviders() {
    return [...providers.keys()];
}

export function formatCloudError(err) {
    if (!err) return 'Unknown cloud error';
    if (typeof err === 'string') return err;
    return err.message || String(err);
}
