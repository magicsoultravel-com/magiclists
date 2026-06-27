/** @module {"owns":"cloud provider registry and factory dispatch", "related":["cloudBackup.js","cloud/megaProvider.js","cloud/localFolderProvider.js"]} */
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

const MAC_INTEGRITY_MESSAGE = 'Checkpoint download failed integrity check. The file may be corrupted on MEGA (often from an older export with special characters). Re-export from the source device after updating, or download the file via mega.nz to verify.';

function mapMacVerificationMessage(message) {
    if (typeof message === 'string' && message.includes('MAC verification failed')) {
        return MAC_INTEGRITY_MESSAGE;
    }
    return null;
}

export function formatCloudError(err) {
    if (!err) return 'Unknown cloud error';
    if (typeof err === 'string') {
        return mapMacVerificationMessage(err) || err;
    }
    const message = err.message || String(err);
    return mapMacVerificationMessage(message) || message;
}
