const wrap = (d) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill-rule="evenodd" fill="#000" d="${d}"/></svg>`;

export const SUBJECTS = {
  star: wrap(
    'M50 5 L61 38 L98 38 L68 59 L79 95 L50 73 L21 95 L32 59 L2 38 L39 38 Z'
  ),
  bolt: wrap('M55 2 L20 58 L45 58 L38 98 L80 38 L52 38 Z'),
  heart: wrap(
    'M50 88 C20 64 4 46 4 28 C4 12 16 4 28 4 C38 4 46 10 50 18 C54 10 62 4 72 4 C84 4 96 12 96 28 C96 46 80 64 50 88 Z'
  ),
  arrow: wrap('M2 38 L60 38 L60 16 L98 50 L60 84 L60 62 L2 62 Z'),
  ring: wrap(
    'M50 2 A48 48 0 1 0 50 98 A48 48 0 1 0 50 2 Z M50 26 A24 24 0 1 1 50 74 A24 24 0 1 1 50 26 Z'
  ),
  asterisk: wrap(
    'M43 2 H57 V35 L85 15 L93 27 L64 46 L93 65 L85 77 L57 57 V98 H43 V57 L15 77 L7 65 L36 46 L7 27 L15 15 L43 35 Z'
  ),
  hex: wrap('M50 2 L93 26 L93 74 L50 98 L7 74 L7 26 Z'),
  smile: wrap(
    'M50 2 A48 48 0 1 0 50 98 A48 48 0 1 0 50 2 Z ' +
      'M25 37 A7 7 0 1 0 39 37 A7 7 0 1 0 25 37 Z ' +
      'M61 37 A7 7 0 1 0 75 37 A7 7 0 1 0 61 37 Z ' +
      'M26 60 A24 24 0 0 0 74 60 L64 60 A14 14 0 0 1 36 60 Z'
  ),
  drop: wrap('M50 2 C50 2 14 46 14 66 A36 36 0 0 0 86 66 C86 46 50 2 50 2 Z'),
};
