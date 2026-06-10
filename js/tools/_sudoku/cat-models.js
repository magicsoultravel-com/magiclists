const CAT_SVG = `
  <svg class="cat-sprite" viewBox="0 0 80 42" width="52" height="28" aria-hidden="true">
    <g class="cat-view-side">
      <path class="cf cat-tail" d="M16 28 L13 27 L11 25 L10 22 L11 19 L13 20 L15 25 L16 28 Z"></path>
      <path class="cf cat-body" d="M17 28 L21 24 L32 22 L46 23 L54 25 L56 28 L54 31 L40 32 L24 31 L17 28 Z"></path>
      <g class="cat-head">
        <path class="cf" d="M47 23 L50 19 L57 19 L60 23 L60 27 L57 30 L50 30 L47 27 Z"></path>
        <path class="cf" d="M49 19 L51 15 L53 19 Z"></path>
        <path class="cf" d="M56 19 L58 14 L60 20 Z"></path>
        <rect class="cat-eye" x="52" y="23" width="1.6" height="1.6"></rect>
        <rect class="cat-eye" x="55" y="23" width="1.6" height="1.6"></rect>
        <path class="cf cat-mouth" d="M53 27 L55 28.5 L57 27 Z"></path>
      </g>
      <g class="cat-legs">
        <g class="cat-leg cat-leg-l1"><path class="cf" d="M23 30 L23.4 35 L22.6 41 L24.4 41 L24.9 35 L24.8 30 Z"></path></g>
        <g class="cat-leg cat-leg-l2"><path class="cf" d="M28 30 L28.4 35 L27.6 41 L29.4 41 L29.9 35 L29.8 30 Z"></path></g>
        <g class="cat-leg cat-leg-l3"><path class="cf" d="M40 30 L40.4 35 L39.6 41 L41.4 41 L41.9 35 L41.8 30 Z"></path></g>
        <g class="cat-leg cat-leg-l4"><path class="cf" d="M47 30 L47.4 35 L46.6 41 L48.4 41 L48.9 35 L48.8 30 Z"></path></g>
      </g>
    </g>
    <g class="cat-view-lie">
      <path class="cf cat-tail" d="M12 41 L9 40 L8 38 L9 36 L11 37 L12 41 Z"></path>
      <path class="cf cat-body" d="M14 42 L62 42 L58 40 L38 39 L20 40 L14 42 Z"></path>
      <path class="cf" d="M54 40 L58 38 L62 39 L63 42 L59 42 L54 40 Z"></path>
      <rect class="cat-eye" x="59" y="39" width="1.4" height="1.4"></rect>
    </g>
  </svg>`;

export function mountCatModel(container) {
    if (!container) return;
    container.querySelectorAll('.cat-model-wrap').forEach((el) => el.remove());
    const wrap = document.createElement('div');
    wrap.className = 'cat-model-wrap';
    wrap.innerHTML = CAT_SVG;
    container.appendChild(wrap);
}
