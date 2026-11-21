import { el } from '../utils.js';

/** Drop zone + file picker + optional URL entry used by image and file blocks. */
export function createUploader(component, { accept, label, allowUrl, onFile, onUrl }) {
    const zone = el('div', { className: 'uploader', tabIndex: 0 });
    const input = el('input', { type: 'file', accept: accept || '', hidden: true });
    const pick = el('button', { type: 'button', className: 'btn btn-ghost btn-sm' }, 'Upload');
    const status = el('span', { className: 'uploader__status' });
    zone.append(el('span', { className: 'uploader__label' }, label), pick, input);

    const handleFile = async (file) => {
        if (!file) return;
        status.textContent = `Uploading ${file.name}…`;
        zone.classList.add('is-busy');
        try {
            await onFile(file);
        } catch (error) {
            status.textContent = `Upload failed: ${error.message}`;
        } finally {
            zone.classList.remove('is-busy');
        }
    };
    component.addEventListener(pick, 'click', () => input.click());
    component.addEventListener(input, 'change', () => handleFile(input.files[0]));
    component.addEventListener(zone, 'dragover', (event) => {
        if (event.dataTransfer?.types.includes('Files')) {
            event.preventDefault();
            event.stopPropagation();
            zone.classList.add('is-dragover');
        }
    });
    component.addEventListener(zone, 'dragleave', () => zone.classList.remove('is-dragover'));
    component.addEventListener(zone, 'drop', (event) => {
        if (!event.dataTransfer?.files.length) return;
        event.preventDefault();
        event.stopPropagation();
        zone.classList.remove('is-dragover');
        handleFile(event.dataTransfer.files[0]);
    });
    if (allowUrl) {
        const form = el('form', { className: 'uploader__url' });
        const field = el('input', { type: 'url', placeholder: 'or paste a link…', required: true });
        form.append(field, el('button', { type: 'submit', className: 'btn btn-ghost btn-sm' }, 'Embed'));
        component.addEventListener(form, 'submit', (event) => {
            event.preventDefault();
            onUrl(field.value.trim());
        });
        zone.append(form);
    }
    zone.append(status);
    return zone;
}
