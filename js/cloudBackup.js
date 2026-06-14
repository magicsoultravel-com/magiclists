import {
    applyBackupToStorage,
    backupFilename,
    buildBackupPackage,
    parseBackupPackage,
    serializeBackupPackage
} from './backup.js';
import { formatCloudError, getCloudProvider } from './cloud/cloudProvider.js';
import './cloud/megaProvider.js';
import { positionPopoverBelowAnchor } from './popoverPosition.js';
import { showAppToast } from './toast.js';
import { CARD_ICONS } from './ui.js';

const CONFIG_KEY = 'matrix_cloud_config';

function readConfig() {
    try {
        return JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    } catch {
        return null;
    }
}

function writeConfig(config) {
    if (!config) {
        localStorage.removeItem(CONFIG_KEY);
        return;
    }
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

function formatBytes(size) {
    if (!size || size < 1024) return `${size || 0} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCheckpointDate(timestamp) {
    if (!timestamp) return 'Unknown date';
    return new Date(timestamp * 1000).toLocaleString();
}

export const CloudBackup = {
    panel: null,
    anchor: null,
    step: null,
    folderParentId: null,
    busy: false,
    show2fa: false,
    loginDraft: null,
    getLoggedIn: () => false,
    outsideHandler: null,
    keyHandler: null,

    init({ getLoggedIn } = {}) {
        this.getLoggedIn = getLoggedIn || (() => false);
    },

    getProvider() {
        const config = readConfig();
        if (!config?.provider) return null;
        return getCloudProvider(config.provider);
    },

    isConfigured() {
        const config = readConfig();
        return !!(config?.provider && config?.folderId);
    },

    async ensureConnected() {
        const provider = this.getProvider();
        const config = readConfig();
        if (!provider || !config?.folderId) {
            return { ok: false, error: 'Cloud not configured' };
        }
        if (provider.isConnected()) {
            provider.resolveBackupFolder(config.folderId);
            return { ok: true };
        }
        const result = await provider.reconnectFromSession();
        if (!result.ok) return result;
        provider.resolveBackupFolder(config.folderId);
        return { ok: true };
    },

    updateButtons() {
        const exportBtn = document.getElementById('btn-cloud-export');
        const importBtn = document.getElementById('btn-cloud-import');
        const configured = this.isConfigured();
        const connected = configured && this.getProvider()?.isConnected();

        [exportBtn, importBtn].forEach((btn) => {
            if (!btn) return;
            const enabled = configured && connected;
            btn.disabled = !enabled;
            btn.classList.toggle('is-disabled', !enabled);
            btn.title = enabled
                ? btn.getAttribute('data-enabled-title') || btn.title
                : 'Connect cloud first (Cloud icon)';
        });
    },

    ensurePanel() {
        if (this.panel) return this.panel;

        const panel = document.createElement('div');
        panel.className = 'cloud-popover clock-style-popover is-hidden';
        panel.setAttribute('role', 'dialog');
        panel.innerHTML = `
            <div class="cloud-popover__header">
                <span class="cloud-popover__title" data-cloud-title>Cloud backup</span>
                <button type="button" class="card-act cloud-popover__close" data-cloud-close title="Close" aria-label="Close">${CARD_ICONS.close}</button>
            </div>
            <div class="cloud-popover__body" data-cloud-body></div>
        `;
        document.body.appendChild(panel);

        panel.querySelector('[data-cloud-close]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.close();
        });

        this.panel = panel;
        return panel;
    },

    bindDismiss() {
        this.unbindDismiss();
        this.outsideHandler = (e) => {
            if (!this.panel || this.panel.classList.contains('is-hidden')) return;
            if (this.panel.contains(e.target)) return;
            if (this.anchor?.contains(e.target)) return;
            this.close();
        };
        this.keyHandler = (e) => {
            if (e.key === 'Escape') this.close();
        };
        document.addEventListener('mousedown', this.outsideHandler);
        document.addEventListener('keydown', this.keyHandler);
    },

    unbindDismiss() {
        if (this.outsideHandler) {
            document.removeEventListener('mousedown', this.outsideHandler);
            this.outsideHandler = null;
        }
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
            this.keyHandler = null;
        }
    },

    open(anchor, { step = null, mode = null } = {}) {
        if (!this.getLoggedIn()) return;
        this.anchor = anchor;
        this.ensurePanel();
        this.step = step || (this.isConfigured() ? 'status' : 'provider');
        if (mode === 'import') this.step = 'import';
        this.renderStep();
        this.panel.classList.remove('is-hidden');
        positionPopoverBelowAnchor(this.panel, anchor);
        this.bindDismiss();
    },

    close() {
        this.panel?.classList.add('is-hidden');
        this.unbindDismiss();
        this.step = null;
        this.folderParentId = null;
        this.busy = false;
        this.loginDraft = null;
    },

    setTitle(text) {
        const title = this.panel?.querySelector('[data-cloud-title]');
        if (title) title.textContent = text;
    },

    setBody(html) {
        const body = this.panel?.querySelector('[data-cloud-body]');
        if (!body) return;
        body.innerHTML = html;
    },

    renderStep() {
        switch (this.step) {
            case 'provider':
                this.renderProviderStep();
                break;
            case 'login':
                this.renderLoginStep();
                break;
            case 'folder':
                this.renderFolderStep();
                break;
            case 'status':
                this.renderStatusStep();
                break;
            case 'import':
                this.renderImportStep();
                break;
            default:
                this.renderProviderStep();
        }
        if (this.anchor && this.panel) {
            requestAnimationFrame(() => positionPopoverBelowAnchor(this.panel, this.anchor));
        }
    },

    renderProviderStep() {
        this.setTitle('Pick your cloud provider');
        this.setBody(`
            <p class="cloud-popover__hint">Choose where to store workspace checkpoints.</p>
            <div class="cloud-popover__providers">
                <button type="button" class="cloud-popover__provider is-active" data-cloud-provider="mega">
                    <span class="cloud-popover__provider-name">MEGA</span>
                    <span class="cloud-popover__provider-note">End-to-end encrypted storage</span>
                </button>
                <div class="cloud-popover__provider is-disabled" aria-disabled="true">
                    <span class="cloud-popover__provider-name">More providers</span>
                    <span class="cloud-popover__provider-note">Coming later</span>
                </div>
            </div>
            <div class="cloud-popover__actions">
                <button type="button" class="btn btn--compact btn--block" data-cloud-continue>Continue</button>
            </div>
        `);

        this.panel.querySelector('[data-cloud-continue]')?.addEventListener('click', () => {
            this.show2fa = false;
            this.loginDraft = null;
            this.step = 'login';
            this.renderStep();
        });
    },

    renderLoginStep() {
        this.setTitle('Connect to MEGA');
        const config = readConfig();
        const draft = this.loginDraft || {};
        const show2fa = this.show2fa;

        this.setBody(`
            <p class="cloud-popover__hint">Enter your MEGA email and password, then click Connect. Credentials stay in this browser tab only.</p>
            <p class="cloud-popover__hint">No authenticator app? You don't need a 2FA code unless two-factor is enabled on your MEGA account.</p>
            <form class="cloud-popover__login-form" data-cloud-login-form>
                <label class="cloud-popover__field">
                    <span>Email</span>
                    <input type="email" class="cloud-popover__input" data-cloud-email autocomplete="username" required>
                </label>
                <label class="cloud-popover__field">
                    <span>Password</span>
                    <input type="password" class="cloud-popover__input" data-cloud-password autocomplete="current-password" required>
                </label>
                <button type="button" class="cloud-popover__2fa-toggle ${show2fa ? 'is-hidden' : ''}" data-cloud-show-2fa>I use two-factor authentication</button>
                <div class="cloud-popover__2fa-block ${show2fa ? '' : 'is-hidden'}" data-cloud-2fa-block>
                    <label class="cloud-popover__field">
                        <span>Authenticator code</span>
                        <input type="text" class="cloud-popover__input" data-cloud-2fa inputmode="numeric" autocomplete="one-time-code" maxlength="8">
                    </label>
                    <p class="cloud-popover__hint">Open your authenticator app (Google Authenticator, Authy, etc.) and enter the current 6-digit code. MEGA does not send this code by email.</p>
                </div>
                <p class="cloud-popover__error is-hidden" data-cloud-error></p>
                <p class="cloud-popover__connecting is-hidden" data-cloud-connecting>Connecting to MEGA…</p>
                <div class="cloud-popover__actions cloud-popover__actions--split">
                    <button type="button" class="btn btn--compact" data-cloud-back>Back</button>
                    <button type="submit" class="btn btn--compact" data-cloud-connect>Connect</button>
                </div>
            </form>
        `);

        const emailInput = this.panel.querySelector('[data-cloud-email]');
        const passwordInput = this.panel.querySelector('[data-cloud-password]');
        const tfaInput = this.panel.querySelector('[data-cloud-2fa]');

        if (emailInput) emailInput.value = draft.email || config?.email || '';
        if (passwordInput) passwordInput.value = draft.password || '';
        if (tfaInput) tfaInput.value = draft.secondFactorCode || '';

        this.panel.querySelector('[data-cloud-back]')?.addEventListener('click', () => {
            if (this.busy) return;
            this.show2fa = false;
            this.loginDraft = null;
            this.step = 'provider';
            this.renderStep();
        });

        this.panel.querySelector('[data-cloud-show-2fa]')?.addEventListener('click', () => {
            this.loginDraft = {
                email: this.panel.querySelector('[data-cloud-email]')?.value?.trim() || '',
                password: this.panel.querySelector('[data-cloud-password]')?.value || '',
                secondFactorCode: ''
            };
            this.show2fa = true;
            this.renderLoginStep();
        });

        this.panel.querySelector('[data-cloud-login-form]')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleConnect();
        });

        if (show2fa) {
            requestAnimationFrame(() => tfaInput?.focus());
        }
    },

    setLoginBusy(busy) {
        this.busy = busy;
        const back = this.panel?.querySelector('[data-cloud-back]');
        const connect = this.panel?.querySelector('[data-cloud-connect]');
        const status = this.panel?.querySelector('[data-cloud-connecting]');
        if (back) back.disabled = busy;
        if (connect) {
            connect.disabled = busy;
            connect.textContent = busy ? 'Connecting…' : 'Connect';
        }
        status?.classList.toggle('is-hidden', !busy);
    },

    async handleConnect() {
        if (this.busy) return;
        const email = this.panel.querySelector('[data-cloud-email]')?.value?.trim();
        const password = this.panel.querySelector('[data-cloud-password]')?.value || '';
        const secondFactorCode = this.panel.querySelector('[data-cloud-2fa]')?.value?.trim() || '';
        const errorEl = this.panel.querySelector('[data-cloud-error]');

        if (!email || !password) {
            if (errorEl) {
                errorEl.textContent = 'Email and password are required.';
                errorEl.classList.remove('is-hidden');
            }
            return;
        }

        this.loginDraft = { email, password, secondFactorCode };
        this.setLoginBusy(true);
        if (errorEl) errorEl.classList.add('is-hidden');

        const slowToast = window.setTimeout(() => {
            showAppToast('Connecting to MEGA…');
        }, 2000);

        const provider = getCloudProvider('mega');
        const result = await provider.connect({ email, password, secondFactorCode });

        window.clearTimeout(slowToast);
        this.setLoginBusy(false);

        if (!result.ok) {
            if (result.mfaRequired) {
                this.show2fa = true;
                this.renderLoginStep();
            }
            const errNode = this.panel.querySelector('[data-cloud-error]');
            if (errNode) {
                errNode.textContent = result.error || 'Connection failed';
                errNode.classList.remove('is-hidden');
            }
            return;
        }

        this.loginDraft = null;
        this.show2fa = false;
        showAppToast('Connected to MEGA');
        this.folderParentId = null;
        this.step = 'folder';
        this.renderStep();
    },

    renderFolderStep() {
        const provider = getCloudProvider('mega');
        const folders = provider.browseFolders(this.folderParentId);
        const currentMeta = this.folderParentId
            ? provider.getFolderMeta(this.folderParentId)
            : { path: '/', name: 'Root' };

        this.setTitle('Choose backup folder');
        this.setBody(`
            <p class="cloud-popover__hint">Pick a folder on MEGA for checkpoints, or use the default.</p>
            <div class="cloud-popover__path">${currentMeta?.path || '/'}</div>
            <div class="cloud-popover__folder-list" data-cloud-folders>
                ${this.folderParentId ? `
                    <button type="button" class="cloud-popover__folder-row" data-cloud-folder-up>
                        <span>..</span><span class="cloud-popover__folder-meta">Up</span>
                    </button>
                ` : ''}
                ${folders.map((folder) => `
                    <button type="button" class="cloud-popover__folder-row" data-cloud-folder-id="${folder.id}">
                        <span>${folder.name}</span><span class="cloud-popover__folder-meta">Open</span>
                    </button>
                `).join('') || '<p class="cloud-popover__empty">No subfolders here.</p>'}
            </div>
            <div class="cloud-popover__inline">
                <input type="text" class="cloud-popover__input" data-cloud-new-folder placeholder="New folder name">
                <button type="button" class="btn btn--compact" data-cloud-create-folder>Create</button>
            </div>
            <p class="cloud-popover__error is-hidden" data-cloud-error></p>
            <div class="cloud-popover__actions cloud-popover__actions--stack">
                <button type="button" class="btn btn--compact btn--block" data-cloud-use-default>Use magicnotes/backups</button>
                <button type="button" class="btn btn--compact btn--block" data-cloud-select-folder ${this.folderParentId ? '' : 'disabled'}>Select this folder</button>
            </div>
        `);

        this.panel.querySelector('[data-cloud-folder-up]')?.addEventListener('click', () => {
            const meta = provider.getFolderMeta(this.folderParentId);
            this.folderParentId = meta?.parentId || null;
            this.renderStep();
        });

        this.panel.querySelectorAll('[data-cloud-folder-id]').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.folderParentId = btn.getAttribute('data-cloud-folder-id');
                this.renderStep();
            });
        });

        this.panel.querySelector('[data-cloud-create-folder]')?.addEventListener('click', () => {
            this.handleCreateFolder();
        });

        this.panel.querySelector('[data-cloud-use-default]')?.addEventListener('click', () => {
            this.handleUseDefaultFolder();
        });

        this.panel.querySelector('[data-cloud-select-folder]')?.addEventListener('click', () => {
            if (this.folderParentId) this.saveFolderSelection(this.folderParentId);
        });
    },

    async handleCreateFolder() {
        if (this.busy) return;
        const name = this.panel.querySelector('[data-cloud-new-folder]')?.value?.trim();
        const errorEl = this.panel.querySelector('[data-cloud-error]');
        if (!name) return;

        this.busy = true;
        if (errorEl) errorEl.classList.add('is-hidden');

        try {
            const provider = getCloudProvider('mega');
            const created = await provider.createFolder(this.folderParentId, name);
            this.folderParentId = created.id;
            this.renderStep();
        } catch (err) {
            if (errorEl) {
                errorEl.textContent = formatCloudError(err);
                errorEl.classList.remove('is-hidden');
            }
        } finally {
            this.busy = false;
        }
    },

    async handleUseDefaultFolder() {
        if (this.busy) return;
        const errorEl = this.panel.querySelector('[data-cloud-error]');
        this.busy = true;
        if (errorEl) errorEl.classList.add('is-hidden');

        try {
            const provider = getCloudProvider('mega');
            const folder = await provider.ensureDefaultFolder();
            await this.saveFolderSelection(folder.id, folder.path);
        } catch (err) {
            if (errorEl) {
                errorEl.textContent = formatCloudError(err);
                errorEl.classList.remove('is-hidden');
            }
            this.busy = false;
        }
    },

    async saveFolderSelection(folderId, folderPathOverride = null) {
        const provider = getCloudProvider('mega');
        const folder = provider.setBackupFolder(folderId);
        const email = provider.getSessionEmail() || readConfig()?.email || '';

        writeConfig({
            provider: 'mega',
            folderId: folder.id,
            folderPath: folderPathOverride || folder.path,
            email,
            lastCheckpointAt: readConfig()?.lastCheckpointAt || null
        });

        this.busy = false;
        this.updateButtons();
        showAppToast('Cloud backup connected');
        this.step = 'status';
        this.renderStep();
    },

    renderStatusStep() {
        const config = readConfig();
        const provider = this.getProvider();
        const connected = provider?.isConnected();
        const lastAt = config?.lastCheckpointAt
            ? formatCheckpointDate(config.lastCheckpointAt)
            : 'Never';

        this.setTitle('Cloud backup');
        this.setBody(`
            <div class="cloud-popover__status">
                <div class="cloud-popover__status-row">
                    <span>Status</span>
                    <span class="${connected ? 'cloud-popover__ok' : 'cloud-popover__warn'}">${connected ? 'Connected' : 'Reconnect needed'}</span>
                </div>
                <div class="cloud-popover__status-row">
                    <span>Folder</span>
                    <span>${config?.folderPath || '—'}</span>
                </div>
                <div class="cloud-popover__status-row">
                    <span>Last checkpoint</span>
                    <span>${lastAt}</span>
                </div>
            </div>
            <p class="cloud-popover__hint">Manual file export/import still works locally.</p>
            <div class="cloud-popover__actions cloud-popover__actions--stack">
                ${connected ? '' : '<button type="button" class="btn btn--compact btn--block" data-cloud-reconnect>Reconnect</button>'}
                <button type="button" class="btn btn--compact btn--block" data-cloud-create>Create checkpoint</button>
                <button type="button" class="btn btn--compact btn--block" data-cloud-import-list>Restore checkpoint…</button>
                <button type="button" class="btn btn--compact btn--block btn--icon-danger" data-cloud-disconnect>Disconnect</button>
            </div>
        `);

        this.panel.querySelector('[data-cloud-reconnect]')?.addEventListener('click', () => {
            this.show2fa = false;
            this.loginDraft = null;
            this.step = 'login';
            this.renderStep();
        });

        this.panel.querySelector('[data-cloud-create]')?.addEventListener('click', () => {
            this.close();
            this.exportCheckpoint(this.anchor);
        });

        this.panel.querySelector('[data-cloud-import-list]')?.addEventListener('click', () => {
            this.step = 'import';
            this.renderStep();
        });

        this.panel.querySelector('[data-cloud-disconnect]')?.addEventListener('click', () => {
            this.disconnect();
        });
    },

    async renderImportStep() {
        this.setTitle('Restore checkpoint');
        this.setBody('<p class="cloud-popover__hint">Loading checkpoints…</p>');

        const connected = await this.ensureConnected();
        if (!connected.ok) {
            this.setBody(`<p class="cloud-popover__error">${connected.error}</p>`);
            return;
        }

        try {
            const provider = this.getProvider();
            const backups = provider.listBackups();

            if (!backups.length) {
                this.setBody('<p class="cloud-popover__empty">No checkpoints found in this folder.</p>');
                return;
            }

            this.setBody(`
                <p class="cloud-popover__hint">Restore replaces your local workspace.</p>
                <div class="cloud-popover__backup-list">
                    ${backups.map((entry) => `
                        <div class="cloud-popover__backup-row">
                            <div class="cloud-popover__backup-meta">
                                <span class="cloud-popover__backup-date">${formatCheckpointDate(entry.timestamp)}</span>
                                <span class="cloud-popover__backup-size">${formatBytes(entry.size)}</span>
                            </div>
                            <button type="button" class="btn btn--compact" data-cloud-restore-id="${entry.id}">Restore</button>
                        </div>
                    `).join('')}
                </div>
            `);

            this.panel.querySelectorAll('[data-cloud-restore-id]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    this.restoreCheckpoint(btn.getAttribute('data-cloud-restore-id'));
                });
            });
        } catch (err) {
            this.setBody(`<p class="cloud-popover__error">${formatCloudError(err)}</p>`);
        }

        if (this.anchor && this.panel) {
            requestAnimationFrame(() => positionPopoverBelowAnchor(this.panel, this.anchor));
        }
    },

    async exportCheckpoint(anchor) {
        if (!this.getLoggedIn() || this.busy) return;

        const connected = await this.ensureConnected();
        if (!connected.ok) {
            showAppToast(connected.error || 'Cloud not connected');
            if (anchor) this.open(anchor);
            return;
        }

        this.busy = true;
        try {
            const pkg = buildBackupPackage();
            const filename = backupFilename(pkg.timestamp);
            const json = serializeBackupPackage(pkg);
            const provider = this.getProvider();
            await provider.uploadBackup(json, filename);

            const config = readConfig() || {};
            config.lastCheckpointAt = pkg.timestamp;
            writeConfig(config);

            this.updateButtons();
            showAppToast('Checkpoint saved');
        } catch (err) {
            showAppToast(formatCloudError(err));
        } finally {
            this.busy = false;
        }
    },

    async restoreCheckpoint(id) {
        if (!id || this.busy) return;
        const confirmed = confirm('Restore this checkpoint? Your current workspace will be replaced.');
        if (!confirmed) return;

        this.busy = true;
        try {
            const provider = this.getProvider();
            const text = await provider.downloadBackup(id);
            const parsed = parseBackupPackage(text);
            applyBackupToStorage(parsed);
            const itemCount = parsed.matrix_database?.items?.length ?? 0;
            alert(`Restore successful (${itemCount} items). Reloading…`);
            window.location.reload();
        } catch (err) {
            showAppToast(formatCloudError(err));
            this.busy = false;
        }
    },

    disconnect() {
        this.getProvider()?.disconnect();
        writeConfig(null);
        this.updateButtons();
        showAppToast('Cloud disconnected');
        this.step = 'provider';
        this.renderStep();
    },

    handleCloudClick(anchor) {
        if (!this.getLoggedIn()) return;
        if (this.panel && !this.panel.classList.contains('is-hidden') && this.anchor === anchor) {
            this.close();
            return;
        }
        this.open(anchor);
    },

    handleImportClick(anchor) {
        if (!this.getLoggedIn()) return;
        if (!this.isConfigured()) {
            this.open(anchor);
            return;
        }
        this.open(anchor, { mode: 'import' });
    }
};
