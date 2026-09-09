import { faVolumeXmark, faVolumeHigh, faUpDown, faBackward, faForward } from '@fortawesome/free-solid-svg-icons';

// Font Awesome Free 7.3.1 by Fonticons, Inc. Icons: CC BY 4.0.
// https://fontawesome.com/license/free — bundled attribution in third-party notices.
function svg(definition: typeof faBackward): string {
  const [width, height, , , paths] = definition.icon;
  return `<svg class="control-icon" aria-hidden="true" focusable="false" viewBox="0 0 ${width} ${height}" fill="currentColor">${(Array.isArray(paths) ? paths : [paths]).map(path => `<path d="${path}"/>`).join('')}</svg>`;
}

export const icons = {
  mute: svg(faVolumeXmark), unmute: svg(faVolumeHigh),
  swap: svg(faUpDown), undo: svg(faBackward), redo: svg(faForward),
};
