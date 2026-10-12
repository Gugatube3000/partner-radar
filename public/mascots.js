// Agent crew. Each has a color used for its pulses, lanes and log tags.
const eyes = (y = 27, gap = 10, cx = 24) => `<g class="eyes"><ellipse cx="${cx - gap / 2}" cy="${y}" rx="2.3" ry="3.1" fill="#04121a"/><ellipse cx="${cx + gap / 2}" cy="${y}" rx="2.3" ry="3.1" fill="#04121a"/><circle cx="${cx - gap / 2 + 0.8}" cy="${y - 1.2}" r="0.8" fill="#fff" opacity=".8"/><circle cx="${cx + gap / 2 + 0.8}" cy="${y - 1.2}" r="0.8" fill="#fff" opacity=".8"/></g>`;
const smile = (y = 33) => `<path d="M21 ${y}q3 2.4 6 0" stroke="#04121a" stroke-width="1.7" fill="none" stroke-linecap="round"/>`;

export const AGENTS = {
  scout: {
    name: "ATLAS", role: "scout · map the market", color: "#5aa9ff",
    svg: `<svg viewBox="0 0 48 48"><ellipse cx="24" cy="27" rx="15" ry="14" fill="#5aa9ff"/><ellipse cx="20" cy="21" rx="6" ry="3" fill="#9fd0ff" opacity=".55"/>
      <path d="M9.5 25a14.5 14.5 0 0 1 29 0" fill="none" stroke="#0b1f36" stroke-width="3.2" stroke-linecap="round"/>
      <rect x="6" y="23" width="6.5" height="10" rx="3.2" fill="#0b1f36"/><rect x="35.5" y="23" width="6.5" height="10" rx="3.2" fill="#0b1f36"/>
      ${eyes()}${smile()}</svg>`,
  },
  analyst: {
    name: "SAGE", role: "analyst · read every site", color: "#9be15d",
    svg: `<svg viewBox="0 0 48 48"><path d="M24 12c3.5 0 5 3 5 6 0 2 4 4 6.5 8.5C38 31 36 41 24 41S10 31 12.5 26.5C15 22 19 20 19 18c0-3 1.5-6 5-6z" fill="#9be15d"/>
      <path d="M24 12c0-3 2-5 5-6" stroke="#3d6b1f" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M27 8c3-2 7-1 8 1-3 2-6 2-8-1z" fill="#5fae2e"/>
      <ellipse cx="19" cy="25" rx="4" ry="2" fill="#d4ffb0" opacity=".5"/>${eyes(29)}${smile(35)}</svg>`,
  },
  judge: {
    name: "JEV", role: "judge · score the fit", color: "#b48cff",
    svg: `<svg viewBox="0 0 48 48"><path d="M24 8l15 16-15 16L9 24z" fill="#b48cff"/><path d="M24 8l15 16H9z" fill="#d6c2ff" opacity=".35"/>${eyes(25)}${smile(31)}</svg>`,
  },
  finder: {
    name: "HOUND", role: "finder · person + email", color: "#ffb23f",
    svg: `<svg viewBox="0 0 48 48"><path d="M10 30c0-9 6-16 14-16s14 7 14 16c0 6-6 10-14 10s-14-4-14-10z" fill="#ffb23f"/>
      <path d="M11 22c-3-1-4 5-2 9" fill="#d9821a"/><path d="M37 22c3-1 4 5 2 9" fill="#d9821a"/>
      <ellipse cx="19" cy="23" rx="5" ry="2.4" fill="#ffe0a8" opacity=".55"/>${eyes(29)}${smile(35)}
      <circle cx="37" cy="36" r="5" fill="none" stroke="#2a1606" stroke-width="2"/><path d="M40.5 39.5l4 4" stroke="#2a1606" stroke-width="2.4" stroke-linecap="round"/></svg>`,
  },
  writer: {
    name: "QUILL", role: "writer · native-language draft", color: "#ffd84a",
    svg: `<svg viewBox="0 0 48 48"><path d="M24 6l5.2 11.2 12.3 1.4-9.1 8.4 2.5 12.1L24 33l-10.9 6.1 2.5-12.1-9.1-8.4 12.3-1.4z" fill="#c792ff" stroke="#ffd84a" stroke-width="1.5" stroke-linejoin="round"/>
      ${eyes(23)}${smile(29)}</svg>`,
  },
};
