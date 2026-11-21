// Source order mirrors the real CSS bundle; HTML intentionally loads only app.css.
import {sourceSheets} from '../../scripts/build-styles.mjs';
export const styleOrder = sourceSheets.map(file => `styles/${file}`).join('\n');
