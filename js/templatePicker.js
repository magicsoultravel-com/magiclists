import { randomNoteColor } from './colorPicker.js';
import { createNoteId, defaultStartDateTimeNow } from './noteModel.js';
import { buildMeetingDraftItem, buildSheetDraftItem } from './sheet.js';
import { Editor } from './editor.js';

function baseDraftFields() {
    return {
        id: createNoteId(),
        owner_id: 'admin',
        visibility: 'private',
        type: 'note',
        title: '',
        content: '',
        status: 'active',
        categories: [],
        backgroundColor: randomNoteColor(),
        startDateTime: defaultStartDateTimeNow(),
        endDateTime: '',
        isRecurring: false,
        hideFromCalendar: false,
        hiddenFromBoard: false,
        attachments: [],
        steps: [],
        editorBodyLayout: 'both',
        tileSize: 'large'
    };
}

export const TemplatePicker = {
    overlay: null,
    categories: [],

    init() {
        this.overlay = document.getElementById('template-picker-overlay');
        if (!this.overlay) return;

        this.overlay.addEventListener('mousedown', (e) => {
            if (e.target === this.overlay) this.close();
        });

        this.overlay.querySelectorAll('[data-template]').forEach((tile) => {
            tile.addEventListener('click', () => {
                const template = tile.dataset.template;
                if (!template) return;
                const categories = this.categories;
                this.close();
                Editor.open(this.buildDraftItem(template), categories);
            });
        });

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (!this.isOpen()) return;
            e.preventDefault();
            e.stopPropagation();
            this.close();
        }, true);
    },

    isOpen() {
        return this.overlay && !this.overlay.classList.contains('is-hidden');
    },

    open(categories = []) {
        if (!this.overlay) {
            Editor.open(null, categories);
            return;
        }
        this.categories = categories;
        this.overlay.classList.remove('is-hidden');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this.overlay?.classList.add('is-open');
            });
        });
    },

    close() {
        if (!this.overlay) return;
        this.overlay.classList.remove('is-open');
        this.overlay.classList.add('is-hidden');
    },

    buildDraftItem(template) {
        const base = baseDraftFields();
        if (template === 'sheet') return buildSheetDraftItem(base);
        if (template === 'meeting') return buildMeetingDraftItem(base);
        return base;
    }
};
