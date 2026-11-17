/**
 * Shared, native password controls for local vault and OneDrive probe.
 * Do not intercept paste/copy/input events: preserve password-manager insertion
 * and the exact characters the user provided (including spaces).
 */
export function initPasswordFields() {
    for (const toggle of document.querySelectorAll('[data-password-toggle]')) {
        const id = toggle.dataset.passwordToggle;
        const input = id ? document.getElementById(id) : null;
        if (!(input instanceof HTMLInputElement) || input.type !== 'password') {
            throw new Error(`Invalid password toggle target: ${id ?? '(missing)'}`);
        }
        toggle.addEventListener('click', () => {
            setPasswordVisible(input, input.type === 'password');
            // Return focus to the input so paste works immediately after revealing it.
            input.focus({ preventScroll: true });
        });
    }
}
function setPasswordVisible(input, visible) {
    input.type = visible ? 'text' : 'password';
    const toggle = document.querySelector(`[data-password-toggle="${input.id}"]`);
    if (toggle) {
        toggle.textContent = visible ? '隠す' : '表示';
        toggle.setAttribute('aria-pressed', String(visible));
        const label = toggle.dataset.passwordLabel ?? 'パスフレーズ';
        toggle.setAttribute('aria-label', `${label}を${visible ? '隠す' : '表示'}`);
    }
}
/** Hide text without changing its value; useful when a dialog opens. */
export function hidePasswordField(id) {
    const input = document.getElementById(id);
    if (!(input instanceof HTMLInputElement))
        throw new Error(`Missing password field #${id}`);
    setPasswordVisible(input, false);
}
/** Remove the secret from the DOM and return the field to a masked state. */
export function clearPasswordField(id) {
    const input = document.getElementById(id);
    if (!(input instanceof HTMLInputElement))
        throw new Error(`Missing password field #${id}`);
    input.value = '';
    setPasswordVisible(input, false);
}
