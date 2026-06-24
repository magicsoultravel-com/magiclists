/** @module {"owns":"cloud backup UI, MEGA and local-folder sync", "related":["backup.js","cloud/cloudProvider.js","cloud/megaProvider.js","cloud/localFolderProvider.js"]} */
import {
    applyBackupToStorage,
    backupFilename,
    buildBackupPackage,
    decryptBackupPackage,
    encryptBackupPackage,
    formatExportTimestamp,
    isEncryptedBackupPackage,
    parseBackupPackage,
    serializeBackupPackage
} from './backup.js';
import { formatCloudError, getCloudProvider } from './cloud/cloudProvider.js';
import './cloud/localFolderProvider.js';
import './cloud/megaProvider.js';
import { SidePanel } from './hamburger.js';
import { clampPanelToViewport, positionPopoverBelowAnchor } from './popoverPosition.js';
import { showAppToast } from './toast.js';
import { CARD_ICONS } from './icons.js';

const CONFIG_KEY = 'matrix_cloud_config';
const POPOVER_POS_KEY = 'matrix_cloud_popover_pos';
const PASSPHRASE_KEY = 'matrix_cloud_passphrase';
const HAS_LOCAL_FOLDER = typeof window.showDirectoryPicker === 'function';

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

function readPopoverPos() {
    try {
        const pos = JSON.parse(sessionStorage.getItem(POPOVER_POS_KEY) || 'null');
        if (Number.isFinite(pos?.x) && Number.isFinite(pos?.y)) return pos;
    } catch { /* ignore */ }
    return null;
}

function writePopoverPos(x, y) {
    sessionStorage.setItem(POPOVER_POS_KEY, JSON.stringify({ x, y }));
}

function readPassphraseSession() {
    try {
        return JSON.parse(sessionStorage.getItem(PASSPHRASE_KEY) || 'null') || {};
    } catch {
        return {};
    }
}

function writePassphraseSession(data) {
    if (!data?.enabled && !data?.passphrase) {
        sessionStorage.removeItem(PASSPHRASE_KEY);
        return;
    }
    sessionStorage.setItem(PASSPHRASE_KEY, JSON.stringify({
        enabled: !!data.enabled,
        passphrase: data.passphrase || ''
    }));
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatBytes(size) {
    if (!size || size < 1024) return `${size || 0} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCheckpointDate(timestamp) {
    return formatExportTimestamp(timestamp);
}

function formatFileDate(timestamp) {
    if (!timestamp) return '—';
    return new Date(timestamp * 1000).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });
}

function buildFolderNavHtml({ parentId, folders, listClass = 'cloud-popover__folder-list' }) {
    const upRow = parentId ? `
        <button type="button" class="cloud-popover__folder-row" data-cloud-folder-up>
            <span>..</span><span class="cloud-popover__folder-meta">Up</span>
        </button>
    ` : '';
    const folderRows = folders.length
        ? folders.map((folder) => `
            <button type="button" class="cloud-popover__folder-row" data-cloud-folder-id="${escapeHtml(folder.id)}">
                <span>${escapeHtml(folder.name)}</span><span class="cloud-popover__folder-meta">Open</span>
            </button>
        `).join('')
        : '<p class="cloud-popover__empty">No subfolders here.</p>';
    return `
        <div class="${listClass}" data-cloud-folders>
            ${upRow}
            ${folderRows}
        </div>
    `;
}

export const CloudBackup = {
    panel: null,
    anchor: null,
    step: null,
    backStep: null,
    folderParentId: null,
    browseParentId: null,
    busy: false,
    show2fa: false,
    loginDraft: null,
    selectedProvider: 'mega',
    floatingPosition: false,
    autoTimerId: null,
    getLoggedIn: () => false,
    outsideHandler: null,
    keyHandler: null,

    init({ getLoggedIn } = {}) {
        this.getLoggedIn = getLoggedIn || (() => false);
        this.startAutoTimer();
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

    startAutoTimer() {
        this.stopAutoTimer();
        const config = readConfig();
        if (!config?.autoEnabled || !this.isConfigured()) return;
        const minutes = Math.max(5, Number(config.autoIntervalMinutes) || 60);
        this.autoTimerId = window.setInterval(() => {
            if (this.getLoggedIn() && !this.busy) {
                this.exportCheckpoint(null, { silent: true });
            }
        }, minutes * 60 * 1000);
    },

    stopAutoTimer() {
        if (this.autoTimerId) {
            window.clearInterval(this.autoTimerId);
            this.autoTimerId = null;
        }
    },

    refreshLastCheckpointAt() {
        const provider = this.getProvider();
        const config = readConfig();
        if (!provider || !config) return;
        Promise.resolve(provider.listBackups()).then((backups) => {
            const newest = backups?.[0]?.timestamp || null;
            config.lastCheckpointAt = newest;
            writeConfig(config);
        }).catch(() => { /* ignore */ });
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
            <div class="cloud-popover__header" data-cloud-pop-drag>
                <button type="button" class="btn btn--compact btn-icon cloud-popover__back is-hidden" data-cloud-pop-back aria-label="Back">◀</button>
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

        panel.querySelector('[data-cloud-pop-back]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.goBack();
        });

        this.bindHeaderDrag(panel);
        this.panel = panel;
        return panel;
    },

    bindHeaderDrag(panel) {
        const header = panel.querySelector('[data-cloud-pop-drag]');
        if (!header || header.dataset.dragBound === 'true') return;
        header.dataset.dragBound = 'true';

        header.addEventListener('pointerdown', (e) => {
            if (e.target.closest('[data-cloud-close]')
                || e.target.closest('[data-cloud-pop-back]')
                || e.button !== 0) return;

            e.preventDefault();
            let dragging = true;
            const startX = e.clientX;
            const startY = e.clientY;
            const startLeft = parseFloat(panel.style.left) || panel.getBoundingClientRect().left;
            const startTop = parseFloat(panel.style.top) || panel.getBoundingClientRect().top;

            panel.classList.add('cloud-popover--dragging');
            header.setPointerCapture(e.pointerId);

            const onMove = (ev) => {
                if (!dragging) return;
                const nx = startLeft + (ev.clientX - startX);
                const ny = startTop + (ev.clientY - startY);
                const clamped = clampPanelToViewport(panel, nx, ny);
                panel.style.left = `${clamped.x}px`;
                panel.style.top = `${clamped.y}px`;
            };

            const onUp = (ev) => {
                if (!dragging) return;
                dragging = false;
                panel.classList.remove('cloud-popover--dragging');
                header.releasePointerCapture(ev.pointerId);
                this.floatingPosition = true;
                writePopoverPos(
                    parseFloat(panel.style.left) || 0,
                    parseFloat(panel.style.top) || 0
                );
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                document.removeEventListener('pointercancel', onUp);
            };

            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
            document.addEventListener('pointercancel', onUp);
        });
    },

    positionPanel() {
        if (!this.panel) return;
        if (this.floatingPosition) {
            const pos = readPopoverPos();
            if (pos) {
                const clamped = clampPanelToViewport(this.panel, pos.x, pos.y);
                this.panel.style.left = `${clamped.x}px`;
                this.panel.style.top = `${clamped.y}px`;
                return;
            }
        }
        if (this.anchor) {
            positionPopoverBelowAnchor(this.panel, this.anchor);
        }
    },

    updateHeaderBack() {
        const back = this.panel?.querySelector('[data-cloud-pop-back]');
        if (!back) return;
        back.classList.toggle('is-hidden', !this.backStep);
    },

    goBack() {
        if (!this.backStep) return;
        this.step = this.backStep;
        this.backStep = null;
        if (this.step !== 'browse') this.browseParentId = null;
        this.renderStep();
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
        if (mode === 'import') {
            this.step = 'import';
            this.backStep = this.isConfigured() ? 'status' : null;
        }
        this.backStep = null;
        const saved = readPopoverPos();
        this.floatingPosition = !!saved;
        this.renderStep();
        this.panel.classList.remove('is-hidden');
        this.positionPanel();
        this.bindDismiss();
    },

    close() {
        this.panel?.classList.add('is-hidden');
        this.unbindDismiss();
        this.step = null;
        this.backStep = null;
        this.folderParentId = null;
        this.browseParentId = null;
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

    finishRenderStep() {
        this.updateHeaderBack();
        if (this.panel) {
            this.panel.classList.toggle('cloud-popover--browse', this.step === 'browse');
        }
        if (this.panel && (this.floatingPosition || this.anchor)) {
            requestAnimationFrame(() => this.positionPanel());
        }
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
                return;
            case 'browse':
                this.renderBrowseStep();
                return;
            default:
                this.renderProviderStep();
        }
        this.finishRenderStep();
    },

    renderProviderStep() {
        this.backStep = null;
        this.setTitle('Pick your cloud provider');
        this.setBody(`
            <p class="cloud-popover__hint">Choose where to store workspace checkpoints.</p>
            <div class="cloud-popover__providers">
                <button type="button" class="cloud-popover__provider ${this.selectedProvider === 'mega' ? 'is-active' : ''}" data-cloud-provider="mega">
                    <span class="cloud-popover__provider-name">MEGA</span>
                    <span class="cloud-popover__provider-note">End-to-end encrypted storage</span>
                </button>
                <button type="button" class="cloud-popover__provider ${this.selectedProvider === 'local' ? 'is-active' : ''} ${HAS_LOCAL_FOLDER ? '' : 'is-disabled'}" data-cloud-provider="local" ${HAS_LOCAL_FOLDER ? '' : 'disabled aria-disabled="true"'}>
                    <span class="cloud-popover__provider-name">Local folder</span>
                    <span class="cloud-popover__provider-note">${HAS_LOCAL_FOLDER ? 'Save checkpoints to a folder on this device' : 'Needs a Chromium-based browser'}</span>
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

        this.panel.querySelectorAll('[data-cloud-provider]').forEach((btn) => {
            btn.addEventListener('click', () => {
                if (btn.disabled || btn.classList.contains('is-disabled')) return;
                this.selectedProvider = btn.getAttribute('data-cloud-provider') || 'mega';
                this.renderProviderStep();
                this.finishRenderStep();
            });
        });

        this.panel.querySelector('[data-cloud-continue]')?.addEventListener('click', () => {
            if (this.selectedProvider === 'local') {
                this.handleLocalConnect();
                return;
            }
            this.show2fa = false;
            this.loginDraft = null;
            this.step = 'login';
            this.renderStep();
        });
    },

    async handleLocalConnect() {
        if (this.busy) return;
        this.busy = true;
        const provider = getCloudProvider('local');
        const result = await provider.connect();
        this.busy = false;
        if (!result.ok) {
            showAppToast(result.error || 'Could not connect folder');
            return;
        }
        const folder = provider.setBackupFolder('.');
        writeConfig({
            provider: 'local',
            folderId: folder.id,
            folderPath: folder.path,
            email: '',
            lastCheckpointAt: readConfig()?.lastCheckpointAt || null,
            autoEnabled: readConfig()?.autoEnabled || false,
            autoIntervalMinutes: readConfig()?.autoIntervalMinutes || 60,
            encryptCheckpoints: readConfig()?.encryptCheckpoints || false
        });
        this.updateButtons();
        this.startAutoTimer();
        showAppToast('Local folder connected');
        this.step = 'status';
        this.renderStep();
    },

    renderLoginStep() {
        this.backStep = null;
        this.setTitle('Connect to MEGA');
        const config = readConfig();
        const draft = this.loginDraft || {};
        const show2fa = this.show2fa;

        this.setBody(`
            <p class="cloud-popover__hint">Uses the unofficial megajs API. Your MEGA password is kept in this browser tab only (sessionStorage). Backup files are JSON and include workspace secrets unless you enable encryption below.</p>
            <p class="cloud-popover__hint">Enter your MEGA email and password, then click Connect.</p>
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
            this.finishRenderStep();
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
                this.finishRenderStep();
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
        this.backStep = null;
        this.step = 'folder';
        this.renderStep();
    },

    bindFolderNavHandlers(provider, parentKey = 'folderParentId') {
        this.panel.querySelector('[data-cloud-folder-up]')?.addEventListener('click', () => {
            const currentId = this[parentKey];
            const meta = provider.getFolderMeta?.(currentId) || provider.getDirectoryMeta?.(currentId);
            this[parentKey] = meta?.parentId || null;
            this.renderStep();
        });

        this.panel.querySelectorAll('[data-cloud-folder-id]').forEach((btn) => {
            btn.addEventListener('click', () => {
                this[parentKey] = btn.getAttribute('data-cloud-folder-id');
                this.renderStep();
            });
        });
    },

    renderFolderStep() {
        this.backStep = 'login';
        const provider = getCloudProvider('mega');
        const folders = provider.browseFolders(this.folderParentId);
        const currentMeta = provider.getDirectoryMeta(this.folderParentId);

        this.setTitle('Choose backup folder');
        this.setBody(`
            <p class="cloud-popover__hint">Pick a folder on MEGA for checkpoints, or use the default.</p>
            <div class="cloud-popover__path">${escapeHtml(currentMeta?.path || '/')}</div>
            ${buildFolderNavHtml({ parentId: this.folderParentId, folders })}
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

        this.bindFolderNavHandlers(provider, 'folderParentId');

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
        const prev = readConfig() || {};

        writeConfig({
            provider: 'mega',
            folderId: folder.id,
            folderPath: folderPathOverride || folder.path,
            email,
            lastCheckpointAt: prev.lastCheckpointAt || null,
            autoEnabled: prev.autoEnabled || false,
            autoIntervalMinutes: prev.autoIntervalMinutes || 60,
            encryptCheckpoints: prev.encryptCheckpoints || false
        });

        this.busy = false;
        this.updateButtons();
        this.startAutoTimer();
        showAppToast('Cloud backup connected');
        this.backStep = null;
        this.step = 'status';
        this.renderStep();
    },

    renderStatusStep() {
        this.backStep = null;
        const config = readConfig();
        const provider = this.getProvider();
        const connected = provider?.isConnected();
        const isMega = config?.provider === 'mega';
        const lastAt = config?.lastCheckpointAt
            ? formatCheckpointDate(config.lastCheckpointAt)
            : 'Never';
        const passSession = readPassphraseSession();

        this.setTitle('Cloud backup');
        this.setBody(`
            <div class="cloud-popover__status">
                <div class="cloud-popover__status-row">
                    <span>Status</span>
                    <span class="${connected ? 'cloud-popover__ok' : 'cloud-popover__warn'}">${connected ? 'Connected' : 'Reconnect needed'}</span>
                </div>
                <div class="cloud-popover__status-row">
                    <span>Provider</span>
                    <span>${config?.provider === 'local' ? 'Local folder' : 'MEGA'}</span>
                </div>
                <div class="cloud-popover__status-row">
                    <span>Folder</span>
                    <span>${escapeHtml(config?.folderPath || '—')}</span>
                </div>
                <div class="cloud-popover__status-row">
                    <span>Last checkpoint</span>
                    <span>${lastAt}</span>
                </div>
            </div>
            <label class="cloud-popover__field cloud-popover__field--inline">
                <input type="checkbox" data-cloud-auto ${config?.autoEnabled ? 'checked' : ''}>
                <span>Auto-checkpoints</span>
            </label>
            <div class="cloud-popover__auto-row">
                <span class="cloud-popover__hint">Every</span>
                <input type="number" class="cloud-popover__input" data-cloud-auto-interval min="5" max="1440" step="5" value="${Number(config?.autoIntervalMinutes) || 60}">
                <span class="cloud-popover__hint">min</span>
            </div>
            <label class="cloud-popover__field cloud-popover__field--inline">
                <input type="checkbox" data-cloud-encrypt ${config?.encryptCheckpoints ? 'checked' : ''}>
                <span>Encrypt checkpoints</span>
            </label>
            <label class="cloud-popover__field">
                <span>Passphrase (this tab only)</span>
                <input type="password" class="cloud-popover__input" data-cloud-passphrase autocomplete="new-password" placeholder="${config?.encryptCheckpoints ? 'Required when encryption is on' : 'Optional'}">
            </label>
            <p class="cloud-popover__hint">Manual file export/import still works locally.</p>
            <div class="cloud-popover__actions cloud-popover__actions--stack">
                ${connected ? '' : `<button type="button" class="btn btn--compact btn--block" data-cloud-reconnect>${config?.provider === 'local' ? 'Pick folder again' : 'Reconnect'}</button>`}
                ${connected && isMega ? '<button type="button" class="btn btn--compact btn--block" data-cloud-browse>Browse files…</button>' : ''}
                <button type="button" class="btn btn--compact btn--block" data-cloud-create>Create checkpoint</button>
                <button type="button" class="btn btn--compact btn--block" data-cloud-import-list>Restore checkpoint…</button>
                <button type="button" class="btn btn--compact btn--block btn--icon-danger" data-cloud-disconnect>Disconnect</button>
            </div>
        `);

        const passInput = this.panel.querySelector('[data-cloud-passphrase]');
        if (passInput && passSession.passphrase) passInput.value = passSession.passphrase;

        const saveSettings = () => {
            const next = readConfig() || {};
            next.autoEnabled = !!this.panel.querySelector('[data-cloud-auto]')?.checked;
            next.autoIntervalMinutes = Math.max(5, Number(this.panel.querySelector('[data-cloud-auto-interval]')?.value) || 60);
            next.encryptCheckpoints = !!this.panel.querySelector('[data-cloud-encrypt]')?.checked;
            writeConfig(next);
            writePassphraseSession({
                enabled: next.encryptCheckpoints,
                passphrase: this.panel.querySelector('[data-cloud-passphrase]')?.value || ''
            });
            this.startAutoTimer();
        };

        this.panel.querySelector('[data-cloud-auto]')?.addEventListener('change', saveSettings);
        this.panel.querySelector('[data-cloud-auto-interval]')?.addEventListener('change', saveSettings);
        this.panel.querySelector('[data-cloud-encrypt]')?.addEventListener('change', saveSettings);
        this.panel.querySelector('[data-cloud-passphrase]')?.addEventListener('change', saveSettings);

        this.panel.querySelector('[data-cloud-reconnect]')?.addEventListener('click', () => {
            if (config?.provider === 'local') {
                this.handleLocalConnect();
                return;
            }
            this.show2fa = false;
            this.loginDraft = null;
            this.step = 'login';
            this.renderStep();
        });

        this.panel.querySelector('[data-cloud-browse]')?.addEventListener('click', () => {
            this.backStep = 'status';
            this.browseParentId = null;
            this.step = 'browse';
            this.renderStep();
        });

        this.panel.querySelector('[data-cloud-create]')?.addEventListener('click', () => {
            saveSettings();
            this.close();
            this.exportCheckpoint(this.anchor);
        });

        this.panel.querySelector('[data-cloud-import-list]')?.addEventListener('click', () => {
            this.backStep = 'status';
            this.step = 'import';
            this.renderStep();
        });

        this.panel.querySelector('[data-cloud-disconnect]')?.addEventListener('click', () => {
            this.disconnect();
        });
    },

    async renderBrowseStep() {
        this.setTitle('MEGA files');
        this.setBody('<p class="cloud-popover__hint">Loading…</p>');
        this.finishRenderStep();

        const connected = await this.ensureConnected();
        if (!connected.ok) {
            this.setBody(`<p class="cloud-popover__error">${escapeHtml(connected.error)}</p>`);
            this.finishRenderStep();
            return;
        }

        try {
            const provider = this.getProvider();
            if (!provider.listDirectoryContents) {
                this.setBody('<p class="cloud-popover__error">Browse not supported for this provider.</p>');
                this.finishRenderStep();
                return;
            }

            const { meta, folders, files } = provider.listDirectoryContents(this.browseParentId);
            const folderSection = folders.length
                ? `<p class="cloud-popover__section-label">Folders</p>${buildFolderNavHtml({
                    parentId: this.browseParentId,
                    folders,
                    listClass: 'cloud-popover__browse-list'
                })}`
                : buildFolderNavHtml({
                    parentId: this.browseParentId,
                    folders: [],
                    listClass: 'cloud-popover__browse-list'
                });

            const fileSection = files.length ? `
                <p class="cloud-popover__section-label">Files</p>
                <div class="cloud-popover__browse-list">
                    ${files.map((file) => `
                        <div class="cloud-popover__file-row">
                            <span>${escapeHtml(file.name)}</span>
                            <span class="cloud-popover__file-meta">${formatBytes(file.size)} · ${formatFileDate(file.timestamp)}</span>
                        </div>
                    `).join('')}
                </div>
            ` : '';

            this.setBody(`
                <div class="cloud-popover__path">${escapeHtml(meta?.path || '/')}</div>
                ${folderSection}
                ${fileSection}
                ${!folders.length && !files.length && !this.browseParentId ? '<p class="cloud-popover__empty">This folder is empty.</p>' : ''}
            `);

            this.bindFolderNavHandlers(provider, 'browseParentId');
        } catch (err) {
            this.setBody(`<p class="cloud-popover__error">${escapeHtml(formatCloudError(err))}</p>`);
        }

        this.finishRenderStep();
    },

    async renderImportStep() {
        this.setTitle('Restore checkpoint');
        this.setBody('<p class="cloud-popover__hint">Loading checkpoints…</p>');
        this.finishRenderStep();

        const connected = await this.ensureConnected();
        if (!connected.ok) {
            this.setBody(`<p class="cloud-popover__error">${escapeHtml(connected.error)}</p>`);
            this.finishRenderStep();
            return;
        }

        try {
            const provider = this.getProvider();
            const backups = await Promise.resolve(provider.listBackups());

            if (!backups.length) {
                this.setBody('<p class="cloud-popover__empty">No checkpoints found in this folder.</p>');
                this.finishRenderStep();
                return;
            }

            this.setBody(`
                <p class="cloud-popover__hint">Restore replaces your local workspace.</p>
                <div class="cloud-popover__backup-list">
                    ${backups.map((entry) => `
                        <div class="cloud-popover__backup-row">
                            <input type="checkbox" class="cloud-popover__backup-check" data-cloud-pick-id="${escapeHtml(entry.id)}" aria-label="Select checkpoint">
                            <div class="cloud-popover__backup-meta">
                                <span class="cloud-popover__backup-date">${formatCheckpointDate(entry.timestamp)}</span>
                                <span class="cloud-popover__backup-size">${formatBytes(entry.size)}</span>
                            </div>
                            <div class="cloud-popover__backup-actions">
                                <button type="button" class="btn btn--compact" data-cloud-restore-id="${escapeHtml(entry.id)}">Restore</button>
                                <button type="button" class="btn btn--compact btn--icon-danger" data-cloud-delete-id="${escapeHtml(entry.id)}">Delete</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div class="cloud-popover__backup-toolbar">
                    <button type="button" class="btn btn--compact btn--icon-danger" data-cloud-delete-selected>Delete selected</button>
                    <button type="button" class="btn btn--compact btn--icon-danger" data-cloud-delete-all>Delete all</button>
                </div>
            `);

            this.panel.querySelectorAll('[data-cloud-restore-id]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    this.restoreCheckpoint(btn.getAttribute('data-cloud-restore-id'));
                });
            });

            this.panel.querySelectorAll('[data-cloud-delete-id]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    this.deleteCheckpoints([btn.getAttribute('data-cloud-delete-id')]);
                });
            });

            this.panel.querySelector('[data-cloud-delete-selected]')?.addEventListener('click', () => {
                const ids = [...this.panel.querySelectorAll('[data-cloud-pick-id]:checked')]
                    .map((el) => el.getAttribute('data-cloud-pick-id'))
                    .filter(Boolean);
                if (!ids.length) {
                    showAppToast('Select checkpoints to delete');
                    return;
                }
                this.deleteCheckpoints(ids);
            });

            this.panel.querySelector('[data-cloud-delete-all]')?.addEventListener('click', () => {
                const ids = backups.map((entry) => entry.id);
                this.deleteCheckpoints(ids, { confirmAll: true });
            });
        } catch (err) {
            this.setBody(`<p class="cloud-popover__error">${escapeHtml(formatCloudError(err))}</p>`);
        }

        this.finishRenderStep();
    },

    async deleteCheckpoints(ids, { confirmAll = false } = {}) {
        const list = (Array.isArray(ids) ? ids : []).filter(Boolean);
        if (!list.length || this.busy) return;

        const message = confirmAll
            ? `Delete all ${list.length} checkpoints in this folder?`
            : `Delete ${list.length} checkpoint${list.length > 1 ? 's' : ''}?`;
        if (!confirm(message)) return;

        this.busy = true;
        try {
            const provider = this.getProvider();
            if (provider.deleteBackups) {
                await provider.deleteBackups(list);
            } else {
                for (const id of list) {
                    await provider.deleteBackup(id);
                }
            }
            this.refreshLastCheckpointAt();
            showAppToast('Checkpoint(s) deleted');
            this.renderImportStep();
        } catch (err) {
            showAppToast(formatCloudError(err));
        } finally {
            this.busy = false;
        }
    },

    async exportCheckpoint(anchor, { silent = false } = {}) {
        if (!this.getLoggedIn() || this.busy) return;

        const connected = await this.ensureConnected();
        if (!connected.ok) {
            if (!silent) showAppToast(connected.error || 'Cloud not connected');
            if (anchor) this.open(anchor);
            return;
        }

        const config = readConfig() || {};
        const passSession = readPassphraseSession();
        if (config.encryptCheckpoints && !passSession.passphrase) {
            if (!silent) showAppToast('Set a passphrase in Cloud settings first');
            if (anchor) this.open(anchor);
            return;
        }

        this.busy = true;
        try {
            const pkg = buildBackupPackage();
            const filename = backupFilename(pkg.timestamp);
            let json = serializeBackupPackage(pkg);
            if (config.encryptCheckpoints) {
                json = await encryptBackupPackage(json, passSession.passphrase);
            }
            const provider = this.getProvider();
            await provider.uploadBackup(json, filename);

            config.lastCheckpointAt = pkg.timestamp;
            writeConfig(config);

            this.updateButtons();
            SidePanel.updateStorageFooter();
            if (!silent) showAppToast('Checkpoint saved');
        } catch (err) {
            if (!silent) showAppToast(formatCloudError(err));
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
            let parsed;
            let raw;
            try {
                raw = JSON.parse(text);
            } catch {
                throw new Error('Invalid backup file');
            }
            if (isEncryptedBackupPackage(raw)) {
                const passSession = readPassphraseSession();
                let passphrase = passSession.passphrase;
                if (!passphrase) {
                    passphrase = prompt('Passphrase for encrypted checkpoint:') || '';
                }
                parsed = await decryptBackupPackage(text, passphrase);
            } else {
                parsed = parseBackupPackage(text);
            }
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
        this.stopAutoTimer();
        this.updateButtons();
        showAppToast('Cloud disconnected');
        this.selectedProvider = 'mega';
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
